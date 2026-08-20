package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testToken = "test-service-token"

func TestProtectedRoutesRequireBearerToken(t *testing.T) {
	server := httptest.NewServer(newServiceServer(t.TempDir(), testToken))
	defer server.Close()

	response, err := http.Get(server.URL + "/api/v1/capabilities")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", response.StatusCode)
	}
}

func TestMockTaskStreamsToCompletion(t *testing.T) {
	server := httptest.NewServer(newServiceServer(t.TempDir(), testToken))
	defer server.Close()

	taskID := createMockTask(t, server.URL, map[string]any{
		"taskId":      "stream-task",
		"task":        "draft",
		"mockContent": "第一段候选正文。",
		"mockDelayMs": 0,
	})
	events := readTaskEvents(t, server.URL, taskID)

	if len(events) < 3 || events[0].Type != "started" {
		t.Fatalf("unexpected events: %#v", events)
	}
	var deltas strings.Builder
	for _, event := range events {
		if event.Type == "delta" {
			deltas.WriteString(event.Delta)
		}
	}
	last := events[len(events)-1]
	if last.Type != "completed" || last.Content != "第一段候选正文。" {
		t.Fatalf("unexpected terminal event: %#v", last)
	}
	if deltas.String() != last.Content {
		t.Fatalf("delta content %q does not match %q", deltas.String(), last.Content)
	}
}

func TestTaskCancellationEmitsTerminalEvent(t *testing.T) {
	server := httptest.NewServer(newServiceServer(t.TempDir(), testToken))
	defer server.Close()

	taskID := createMockTask(t, server.URL, map[string]any{
		"taskId":      "cancel-task",
		"task":        "draft",
		"mockContent": strings.Repeat("待取消内容", 100),
		"mockDelayMs": 5,
	})
	time.Sleep(10 * time.Millisecond)
	request, err := http.NewRequest(http.MethodDelete, server.URL+"/api/v1/tasks/"+taskID, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+testToken)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", response.StatusCode)
	}

	events := readTaskEvents(t, server.URL, taskID)
	if events[len(events)-1].Type != "cancelled" {
		t.Fatalf("expected cancelled event, got %#v", events[len(events)-1])
	}
}

func createMockTask(t *testing.T, baseURL string, payload map[string]any) string {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodPost, baseURL+"/api/v1/tasks", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+testToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", response.StatusCode)
	}
	var result struct {
		TaskID string `json:"taskId"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	return result.TaskID
}

func readTaskEvents(t *testing.T, baseURL, taskID string) []taskEvent {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, baseURL+"/api/v1/tasks/"+taskID+"/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+testToken)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.StatusCode)
	}

	var events []taskEvent
	scanner := bufio.NewScanner(response.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var event taskEvent
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &event); err != nil {
			t.Fatal(err)
		}
		events = append(events, event)
		if isTerminalEvent(event.Type) {
			break
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	return events
}

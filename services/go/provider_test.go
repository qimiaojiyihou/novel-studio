package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProviderForwardsOpenAICompatibleStreamingRequest(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/custom/chat" {
			t.Errorf("unexpected path %q", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer provider-key" {
			t.Errorf("unexpected authorization header")
		}
		if request.Header.Get("X-Provider-Version") != "2026-01" {
			t.Errorf("custom request header was not forwarded")
		}
		var payload struct {
			Model           string         `json:"model"`
			Stream          bool           `json:"stream"`
			TopP            float64        `json:"top_p"`
			Thinking        map[string]any `json:"thinking"`
			ReasoningEffort string         `json:"reasoning_effort"`
			MaxTokens       int            `json:"max_tokens"`
			ResponseFormat  map[string]any `json:"response_format"`
			MinP            float64        `json:"min_p"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload.Model != "provider-model" || !payload.Stream {
			t.Errorf("unexpected provider payload: %#v", payload)
		}
		if payload.TopP != 0.8 || payload.Thinking["type"] != "enabled" || payload.ReasoningEffort != "max" || payload.MaxTokens != 8192 || payload.ResponseFormat["type"] != "json_object" || payload.MinP != 0.08 {
			t.Errorf("advanced parameters were not forwarded: %#v", payload)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"候选\"}}]}\n\n")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"正文\"}}]}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer upstream.Close()

	var streamed strings.Builder
	content, err := newProviderClient().generate(context.Background(), taskRequest{
		Endpoint:     upstream.URL + "/v1",
		EndpointPath: "/custom/chat",
		APIKey:       "provider-key",
		Model:        "provider-model",
		Messages:     []chatMessage{{Role: "user", Content: "生成正文"}},
		Parameters: map[string]any{
			"top_p":            0.8,
			"thinking":         map[string]any{"type": "enabled"},
			"reasoning_effort": "max",
			"max_tokens":       8192,
			"response_format":  map[string]any{"type": "json_object"},
			"ignored_field":    "must-not-pass",
			"min_p":            0.08,
			"model":            "must-not-override",
			"stream":           false,
		},
		RequestHeaders: map[string]string{"X-Provider-Version": "2026-01"},
	}, func(delta string) {
		streamed.WriteString(delta)
	})
	if err != nil {
		t.Fatal(err)
	}
	if content != "候选正文" || streamed.String() != content {
		t.Fatalf("unexpected streamed content %q / %q", streamed.String(), content)
	}
}

func TestProviderAcceptsNonStreamingOpenAICompatibleResponse(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		var payload struct {
			Stream bool `json:"stream"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload.Stream {
			t.Errorf("expected non-streaming request")
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"choices":[{"message":{"role":"assistant","content":"完整响应"}}]}`)
	}))
	defer upstream.Close()

	var streamed strings.Builder
	stream := false
	content, err := newProviderClient().generate(context.Background(), taskRequest{
		Endpoint: upstream.URL,
		Model:    "provider-model",
		Messages: []chatMessage{{Role: "user", Content: "生成正文"}},
		Stream:   &stream,
	}, func(delta string) {
		streamed.WriteString(delta)
	})
	if err != nil {
		t.Fatal(err)
	}
	if content != "完整响应" || streamed.String() != content {
		t.Fatalf("unexpected response content %q / %q", streamed.String(), content)
	}
}

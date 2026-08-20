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
		if request.URL.Path != "/v1/chat/completions" {
			t.Errorf("unexpected path %q", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer provider-key" {
			t.Errorf("unexpected authorization header")
		}
		var payload struct {
			Model  string `json:"model"`
			Stream bool   `json:"stream"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload.Model != "provider-model" || !payload.Stream {
			t.Errorf("unexpected provider payload: %#v", payload)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"候选\"}}]}\n\n")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"正文\"}}]}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer upstream.Close()

	var streamed strings.Builder
	content, err := newProviderClient().generate(context.Background(), taskRequest{
		Endpoint: upstream.URL + "/v1",
		APIKey:   "provider-key",
		Model:    "provider-model",
		Messages: []chatMessage{{Role: "user", Content: "生成正文"}},
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
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"choices":[{"message":{"role":"assistant","content":"完整响应"}}]}`)
	}))
	defer upstream.Close()

	var streamed strings.Builder
	content, err := newProviderClient().generate(context.Background(), taskRequest{
		Endpoint: upstream.URL,
		Model:    "provider-model",
		Messages: []chatMessage{{Role: "user", Content: "生成正文"}},
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

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type taskRequest struct {
	TaskID      string         `json:"taskId"`
	Task        string         `json:"task"`
	Endpoint    string         `json:"endpoint"`
	APIKey      string         `json:"apiKey"`
	Model       string         `json:"model"`
	Messages    []chatMessage  `json:"messages"`
	Temperature float64        `json:"temperature"`
	Parameters  map[string]any `json:"parameters"`
	MockContent string         `json:"mockContent"`
	MockDelayMS int            `json:"mockDelayMs"`
}

type providerClient struct {
	httpClient *http.Client
}

func newProviderClient() *providerClient {
	return &providerClient{httpClient: &http.Client{Timeout: 30 * time.Minute}}
}

func (client *providerClient) generate(
	ctx context.Context,
	request taskRequest,
	onDelta func(string),
) (string, error) {
	if request.MockContent != "" {
		return streamMockContent(ctx, request.MockContent, request.MockDelayMS, onDelta)
	}
	if strings.TrimSpace(request.Endpoint) == "" {
		return "", errors.New("模型接口地址为空")
	}
	if strings.TrimSpace(request.Model) == "" {
		return "", errors.New("模型名称为空")
	}

	payload := map[string]any{
		"model":    request.Model,
		"messages": request.Messages,
		"stream":   true,
	}
	for key, value := range request.Parameters {
		switch key {
		case "temperature", "top_p", "thinking", "reasoning_effort", "max_tokens", "response_format", "stream_options", "stop":
			payload[key] = value
		}
	}
	if _, configured := payload["temperature"]; !configured && request.Temperature != 0 {
		payload["temperature"] = request.Temperature
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("编码模型请求: %w", err)
	}

	endpoint := strings.TrimRight(strings.TrimSpace(request.Endpoint), "/")
	if !strings.HasSuffix(endpoint, "/chat/completions") {
		endpoint += "/chat/completions"
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("创建模型请求: %w", err)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	if request.APIKey != "" {
		httpRequest.Header.Set("Authorization", "Bearer "+request.APIKey)
	}

	response, err := client.httpClient.Do(httpRequest)
	if err != nil {
		return "", fmt.Errorf("调用模型接口: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		failureBody, _ := io.ReadAll(io.LimitReader(response.Body, 32*1024))
		return "", fmt.Errorf("模型接口返回 %s: %s", response.Status, strings.TrimSpace(string(failureBody)))
	}
	if !strings.Contains(response.Header.Get("Content-Type"), "text/event-stream") {
		var payload struct {
			Choices []struct {
				Message chatMessage `json:"message"`
			} `json:"choices"`
		}
		if err := json.NewDecoder(io.LimitReader(response.Body, 16*1024*1024)).Decode(&payload); err != nil {
			return "", fmt.Errorf("解析模型响应: %w", err)
		}
		if len(payload.Choices) == 0 || payload.Choices[0].Message.Content == "" {
			return "", errors.New("模型接口没有返回可用内容")
		}
		content := payload.Choices[0].Message.Content
		onDelta(content)
		return content, nil
	}

	content, err := readOpenAIStream(ctx, response.Body, onDelta)
	if err == nil && content == "" {
		return "", errors.New("模型接口没有返回可用内容")
	}
	return content, err
}

func readOpenAIStream(ctx context.Context, reader io.Reader, onDelta func(string)) (string, error) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), 2*1024*1024)
	var content strings.Builder
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return content.String(), ctx.Err()
		default:
		}
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			return content.String(), nil
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return content.String(), fmt.Errorf("解析模型流: %w", err)
		}
		for _, choice := range chunk.Choices {
			if choice.Delta.Content == "" {
				continue
			}
			content.WriteString(choice.Delta.Content)
			onDelta(choice.Delta.Content)
		}
	}
	if err := scanner.Err(); err != nil {
		return content.String(), fmt.Errorf("读取模型流: %w", err)
	}
	return content.String(), nil
}

func streamMockContent(
	ctx context.Context,
	content string,
	delayMilliseconds int,
	onDelta func(string),
) (string, error) {
	if delayMilliseconds < 0 {
		delayMilliseconds = 0
	}
	runes := []rune(content)
	for start := 0; start < len(runes); start += 4 {
		end := start + 4
		if end > len(runes) {
			end = len(runes)
		}
		if delayMilliseconds > 0 {
			timer := time.NewTimer(time.Duration(delayMilliseconds) * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return string(runes[:start]), ctx.Err()
			case <-timer.C:
			}
		} else {
			select {
			case <-ctx.Done():
				return string(runes[:start]), ctx.Err()
			default:
			}
		}
		onDelta(string(runes[start:end]))
	}
	return content, nil
}

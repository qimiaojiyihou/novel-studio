package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

var errTaskAlreadyExists = errors.New("task already exists")

type runtimeResponse struct {
	Status    string `json:"status"`
	Service   string `json:"service"`
	Version   string `json:"version"`
	DataDir   string `json:"dataDir"`
	Timestamp string `json:"timestamp"`
}

type serviceServer struct {
	dataDir   string
	authToken string
	tasks     *taskRegistry
	provider  *providerClient
	mux       *http.ServeMux
}

func newServiceServer(dataDir, authToken string) *serviceServer {
	server := &serviceServer{
		dataDir:   dataDir,
		authToken: authToken,
		tasks:     newTaskRegistry(),
		provider:  newProviderClient(),
		mux:       http.NewServeMux(),
	}
	server.routes()
	return server
}

func (server *serviceServer) ServeHTTP(w http.ResponseWriter, request *http.Request) {
	server.mux.ServeHTTP(w, request)
}

func (server *serviceServer) routes() {
	server.mux.HandleFunc("GET /health", server.handleHealth)
	server.mux.HandleFunc("GET /api/status", server.handleStatus)
	server.mux.Handle("GET /api/v1/capabilities", server.requireAuth(http.HandlerFunc(server.handleCapabilities)))
	server.mux.Handle("POST /api/v1/tasks", server.requireAuth(http.HandlerFunc(server.handleCreateTask)))
	server.mux.Handle("GET /api/v1/tasks/", server.requireAuth(http.HandlerFunc(server.handleTaskRoute)))
	server.mux.Handle("DELETE /api/v1/tasks/", server.requireAuth(http.HandlerFunc(server.handleTaskRoute)))
}

func (server *serviceServer) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, server.runtime("ok"))
}

func (server *serviceServer) handleStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, server.runtime("ready"))
}

func (server *serviceServer) runtime(status string) runtimeResponse {
	return runtimeResponse{
		Status:    status,
		Service:   "novel-studio-service",
		Version:   "0.2.0",
		DataDir:   server.dataDir,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
}

func (server *serviceServer) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if server.authToken == "" {
			writeAPIError(w, http.StatusServiceUnavailable, "service_auth_not_configured")
			return
		}
		expected := []byte("Bearer " + server.authToken)
		provided := []byte(request.Header.Get("Authorization"))
		if len(expected) != len(provided) || subtle.ConstantTimeCompare(expected, provided) != 1 {
			writeAPIError(w, http.StatusUnauthorized, "invalid_bearer_token")
			return
		}
		next.ServeHTTP(w, request)
	})
}

func (server *serviceServer) handleCapabilities(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"streaming":        true,
		"cancellation":     true,
		"providerProtocol": "openai-compatible",
		"taskEvents":       []string{"started", "delta", "completed", "failed", "cancelled"},
	})
}

func (server *serviceServer) handleCreateTask(w http.ResponseWriter, request *http.Request) {
	defer request.Body.Close()
	decoder := json.NewDecoder(http.MaxBytesReader(w, request.Body, 2*1024*1024))
	decoder.DisallowUnknownFields()
	var input taskRequest
	if err := decoder.Decode(&input); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid_task_request")
		return
	}
	if strings.TrimSpace(input.TaskID) == "" {
		input.TaskID = createTaskID()
	}
	task, ctx, err := server.tasks.create(input.TaskID)
	if errors.Is(err, errTaskAlreadyExists) {
		writeAPIError(w, http.StatusConflict, "task_already_exists")
		return
	}

	go server.runTask(ctx, task, input)
	writeJSON(w, http.StatusAccepted, map[string]string{
		"taskId": input.TaskID,
		"status": "accepted",
	})
}

func (server *serviceServer) runTask(ctx context.Context, task *modelTask, input taskRequest) {
	task.publish(newTaskEvent(task.id, "started"))
	content, err := server.provider.generate(ctx, input, func(delta string) {
		event := newTaskEvent(task.id, "delta")
		event.Delta = delta
		task.publish(event)
	})
	if errors.Is(err, context.Canceled) {
		task.publish(newTaskEvent(task.id, "cancelled"))
		return
	}
	if err != nil {
		event := newTaskEvent(task.id, "failed")
		event.Error = err.Error()
		task.publish(event)
		return
	}
	event := newTaskEvent(task.id, "completed")
	event.Content = content
	task.publish(event)
}

func (server *serviceServer) handleTaskRoute(w http.ResponseWriter, request *http.Request) {
	remainder := strings.TrimPrefix(request.URL.Path, "/api/v1/tasks/")
	parts := strings.Split(strings.Trim(remainder, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeAPIError(w, http.StatusNotFound, "task_not_found")
		return
	}
	taskID := parts[0]
	if request.Method == http.MethodDelete && len(parts) == 1 {
		server.handleCancelTask(w, taskID)
		return
	}
	if request.Method == http.MethodGet && len(parts) == 2 && parts[1] == "events" {
		server.handleTaskEvents(w, request, taskID)
		return
	}
	writeAPIError(w, http.StatusNotFound, "route_not_found")
}

func (server *serviceServer) handleCancelTask(w http.ResponseWriter, taskID string) {
	if !server.tasks.cancel(taskID) {
		writeAPIError(w, http.StatusNotFound, "task_not_found")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{
		"taskId": taskID,
		"status": "cancelling",
	})
}

func (server *serviceServer) handleTaskEvents(w http.ResponseWriter, request *http.Request, taskID string) {
	task, exists := server.tasks.get(taskID)
	if !exists {
		writeAPIError(w, http.StatusNotFound, "task_not_found")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeAPIError(w, http.StatusInternalServerError, "streaming_not_supported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	history, updates, unsubscribe := task.subscribe()
	defer unsubscribe()
	for _, event := range history {
		if !writeSSEEvent(w, flusher, event) || isTerminalEvent(event.Type) {
			return
		}
	}
	for {
		select {
		case <-request.Context().Done():
			return
		case event := <-updates:
			if !writeSSEEvent(w, flusher, event) || isTerminalEvent(event.Type) {
				return
			}
		}
	}
}

func writeSSEEvent(w http.ResponseWriter, flusher http.Flusher, event taskEvent) bool {
	payload, err := json.Marshal(event)
	if err != nil {
		return false
	}
	if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, payload); err != nil {
		return false
	}
	flusher.Flush()
	return true
}

func createTaskID() string {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("task-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buffer)
}

func writeAPIError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

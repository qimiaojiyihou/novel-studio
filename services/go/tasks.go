package main

import (
	"context"
	"sync"
	"time"
)

const taskEventBuffer = 128

type taskEvent struct {
	TaskID    string `json:"taskId"`
	Type      string `json:"type"`
	Delta     string `json:"delta,omitempty"`
	Content   string `json:"content,omitempty"`
	Error     string `json:"error,omitempty"`
	CreatedAt string `json:"createdAt"`
}

func newTaskEvent(taskID, eventType string) taskEvent {
	return taskEvent{
		TaskID:    taskID,
		Type:      eventType,
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
}

func isTerminalEvent(eventType string) bool {
	return eventType == "completed" || eventType == "failed" || eventType == "cancelled"
}

type modelTask struct {
	id          string
	cancel      context.CancelFunc
	mu          sync.Mutex
	events      []taskEvent
	subscribers map[chan taskEvent]struct{}
	done        bool
}

func (task *modelTask) publish(event taskEvent) {
	task.mu.Lock()
	if task.done {
		task.mu.Unlock()
		return
	}
	task.events = append(task.events, event)
	if isTerminalEvent(event.Type) {
		task.done = true
	}
	subscribers := make([]chan taskEvent, 0, len(task.subscribers))
	for subscriber := range task.subscribers {
		subscribers = append(subscribers, subscriber)
	}
	task.mu.Unlock()

	for _, subscriber := range subscribers {
		subscriber <- event
	}
}

func (task *modelTask) subscribe() ([]taskEvent, <-chan taskEvent, func()) {
	updates := make(chan taskEvent, taskEventBuffer)
	task.mu.Lock()
	history := append([]taskEvent(nil), task.events...)
	if !task.done {
		task.subscribers[updates] = struct{}{}
	}
	task.mu.Unlock()

	unsubscribe := func() {
		task.mu.Lock()
		delete(task.subscribers, updates)
		task.mu.Unlock()
	}
	return history, updates, unsubscribe
}

type taskRegistry struct {
	mu    sync.RWMutex
	tasks map[string]*modelTask
}

func newTaskRegistry() *taskRegistry {
	return &taskRegistry{tasks: make(map[string]*modelTask)}
}

func (registry *taskRegistry) create(taskID string) (*modelTask, context.Context, error) {
	registry.mu.Lock()
	defer registry.mu.Unlock()
	if _, exists := registry.tasks[taskID]; exists {
		return nil, nil, errTaskAlreadyExists
	}
	ctx, cancel := context.WithCancel(context.Background())
	task := &modelTask{
		id:          taskID,
		cancel:      cancel,
		subscribers: make(map[chan taskEvent]struct{}),
	}
	registry.tasks[taskID] = task
	return task, ctx, nil
}

func (registry *taskRegistry) get(taskID string) (*modelTask, bool) {
	registry.mu.RLock()
	defer registry.mu.RUnlock()
	task, exists := registry.tasks[taskID]
	return task, exists
}

func (registry *taskRegistry) cancel(taskID string) bool {
	task, exists := registry.get(taskID)
	if !exists {
		return false
	}
	task.cancel()
	return true
}

func (registry *taskRegistry) cancelAll() {
	registry.mu.RLock()
	tasks := make([]*modelTask, 0, len(registry.tasks))
	for _, task := range registry.tasks {
		tasks = append(tasks, task)
	}
	registry.mu.RUnlock()
	for _, task := range tasks {
		task.cancel()
	}
}

package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func main() {
	port := flag.Int("port", 0, "HTTP port; 0 selects a free port")
	dataDir := flag.String("data-dir", ".", "service data directory")
	authToken := flag.String("auth-token", os.Getenv("NOVEL_STUDIO_SERVICE_TOKEN"), "bearer token required by protected API routes")
	flag.Parse()

	if err := os.MkdirAll(*dataDir, 0o755); err != nil {
		log.Fatal(err)
	}

	service := newServiceServer(filepath.Clean(*dataDir), *authToken)

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		log.Fatal(err)
	}
	defer listener.Close()

	address := listener.Addr().(*net.TCPAddr)
	fmt.Printf("novel-studio-service ready port=%d data_dir=%s\n", address.Port, filepath.Clean(*dataDir))

	httpServer := &http.Server{
		Handler:           service,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       90 * time.Second,
	}
	shutdownContext, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()
	go func() {
		<-shutdownContext.Done()
		service.tasks.cancelAll()
		deadline, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(deadline)
	}()

	if err := httpServer.Serve(listener); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

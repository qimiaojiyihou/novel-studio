package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

type runtimeResponse struct {
	Status    string `json:"status"`
	Service   string `json:"service"`
	Version   string `json:"version"`
	DataDir   string `json:"data_dir"`
	Timestamp string `json:"timestamp"`
}

func main() {
	port := flag.Int("port", 0, "HTTP port; 0 selects a free port")
	dataDir := flag.String("data-dir", ".", "service data directory")
	flag.Parse()

	if err := os.MkdirAll(*dataDir, 0o755); err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, runtimeResponse{
			Status:    "ok",
			Service:   "novel-studio-service",
			Version:   "0.1.0",
			DataDir:   filepath.Clean(*dataDir),
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		})
	})
	mux.HandleFunc("/api/status", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, runtimeResponse{
			Status:    "ready",
			Service:   "novel-studio-service",
			Version:   "0.1.0",
			DataDir:   filepath.Clean(*dataDir),
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		})
	})

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		log.Fatal(err)
	}
	defer listener.Close()

	address := listener.Addr().(*net.TCPAddr)
	fmt.Printf("novel-studio-service ready port=%d data_dir=%s\n", address.Port, filepath.Clean(*dataDir))
	log.Fatal(http.Serve(listener, mux))
}

func writeJSON(w http.ResponseWriter, value runtimeResponse) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}

package main

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/GabrielKenji28/Web-Calculator/backend/internal/calc"
	"github.com/GabrielKenji28/Web-Calculator/backend/internal/httpapi"
)

func TestParseConfig(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		args     []string
		env      map[string]string
		want     config
		wantErr  bool
		wantHelp bool
	}{
		{
			name: "defaults",
			want: config{port: defaultPort, shutdownTimeout: defaultShutdownTimeout},
		},
		{
			name: "environment sets the port",
			env:  map[string]string{envPort: "9090"},
			want: config{port: 9090, shutdownTimeout: defaultShutdownTimeout},
		},
		{
			name: "flag overrides the environment",
			args: []string{"-port", "7000"},
			env:  map[string]string{envPort: "9090"},
			want: config{port: 7000, shutdownTimeout: defaultShutdownTimeout},
		},
		{
			name: "shutdown timeout is configurable",
			args: []string{"-shutdown-timeout", "3s"},
			want: config{port: defaultPort, shutdownTimeout: 3 * time.Second},
		},
		{
			name: "port zero asks for a free port",
			args: []string{"-port", "0"},
			want: config{port: 0, shutdownTimeout: defaultShutdownTimeout},
		},
		{
			name: "environment enables static files",
			env:  map[string]string{envStaticDir: "/app/static"},
			want: config{port: defaultPort, staticDir: "/app/static", shutdownTimeout: defaultShutdownTimeout},
		},
		{
			name: "static flag overrides environment",
			args: []string{"-static-dir", "../frontend/dist"},
			env:  map[string]string{envStaticDir: "/app/static"},
			want: config{port: defaultPort, staticDir: "../frontend/dist", shutdownTimeout: defaultShutdownTimeout},
		},
		{
			name: "empty static flag disables environment directory",
			args: []string{"-static-dir="},
			env:  map[string]string{envStaticDir: "/app/static"},
			want: config{port: defaultPort, shutdownTimeout: defaultShutdownTimeout},
		},
		{name: "non-numeric environment port", env: map[string]string{envPort: "http"}, wantErr: true},
		{name: "out-of-range environment port", env: map[string]string{envPort: "70000"}, wantErr: true},
		{name: "negative flag port", args: []string{"-port", "-1"}, wantErr: true},
		{name: "out-of-range flag port", args: []string{"-port", "70000"}, wantErr: true},
		{name: "zero shutdown timeout", args: []string{"-shutdown-timeout", "0s"}, wantErr: true},
		{name: "unknown flag", args: []string{"-nope"}, wantErr: true},
		{name: "help", args: []string{"-h"}, wantErr: true, wantHelp: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			getenv := func(key string) string { return tt.env[key] }
			got, err := parseConfig(tt.args, getenv, io.Discard)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("parseConfig(%v) = %+v, want an error", tt.args, got)
				}
				if tt.wantHelp && !errors.Is(err, flag.ErrHelp) {
					t.Errorf("parseConfig(%v) error = %v, want %v", tt.args, err, flag.ErrHelp)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseConfig(%v) error = %v", tt.args, err)
			}
			if got != tt.want {
				t.Errorf("parseConfig(%v) = %+v, want %+v", tt.args, got, tt.want)
			}
		})
	}
}

func TestRunHelpExitsCleanly(t *testing.T) {
	t.Parallel()

	var out strings.Builder
	if err := run(context.Background(), []string{"-h"}, func(string) string { return "" }, &out); err != nil {
		t.Fatalf("run(-h) error = %v", err)
	}
	if !strings.Contains(out.String(), "-port") {
		t.Errorf("usage output = %q, want it to mention -port", out.String())
	}
}

func TestRunRejectsInvalidConfig(t *testing.T) {
	t.Parallel()

	err := run(context.Background(), nil, func(string) string { return "not-a-port" }, io.Discard)
	if err == nil {
		t.Fatal("run with an invalid PORT = nil, want an error")
	}
}

func TestRunRejectsMissingStaticBuild(t *testing.T) {
	t.Parallel()

	err := run(t.Context(), []string{"-port", "0", "-static-dir", t.TempDir()}, func(string) string { return "" }, io.Discard)
	if err == nil || !strings.Contains(err.Error(), "configure static files") {
		t.Fatalf("run without a frontend index error = %v, want a static configuration error", err)
	}
}

func TestNewHTTPServerSetsTimeouts(t *testing.T) {
	t.Parallel()

	srv := newHTTPServer(http.NotFoundHandler())
	if srv.ReadHeaderTimeout != readHeaderTimeout {
		t.Errorf("ReadHeaderTimeout = %v, want %v", srv.ReadHeaderTimeout, readHeaderTimeout)
	}
	if srv.ReadTimeout != readTimeout {
		t.Errorf("ReadTimeout = %v, want %v", srv.ReadTimeout, readTimeout)
	}
	if srv.WriteTimeout != writeTimeout {
		t.Errorf("WriteTimeout = %v, want %v", srv.WriteTimeout, writeTimeout)
	}
	if srv.IdleTimeout != idleTimeout {
		t.Errorf("IdleTimeout = %v, want %v", srv.IdleTimeout, idleTimeout)
	}
}

func TestServeShutsDownGracefully(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	logger := slog.New(slog.DiscardHandler)
	srv := newHTTPServer(httpapi.NewRouter(calc.New(), logger))

	done := make(chan error, 1)
	go func() { done <- serve(ctx, srv, listener, time.Second, logger) }()

	resp, err := http.Get("http://" + listener.Addr().String() + "/health")
	if err != nil {
		t.Fatalf("GET /health: %v", err)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read /health body: %v", err)
	}
	if err := resp.Body.Close(); err != nil {
		t.Errorf("close /health body: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Errorf("GET /health status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	if got, want := string(body), `{"status":"ok"}`; got != want {
		t.Errorf("GET /health body = %s, want %s", got, want)
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Errorf("serve returned %v, want nil after a graceful shutdown", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("serve did not return within 5s of the context being cancelled")
	}
}

func TestRunServesUntilCancelled(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Cancels on the "listening" log line rather than sleeping or guessing the
	// ephemeral port.
	out := &cancelOnListening{cancel: cancel}
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "index.html"), []byte("<title>Calculator</title>"), 0o644); err != nil {
		t.Fatalf("write frontend index: %v", err)
	}

	done := make(chan error, 1)
	go func() {
		done <- run(ctx, []string{"-port", "0", "-shutdown-timeout", "1s", "-static-dir", directory}, func(string) string { return "" }, out)
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run error = %v; log: %s", err, out.String())
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("run did not return within 10s; log: %s", out.String())
	}

	if !strings.Contains(out.String(), "shutdown complete") {
		t.Errorf("log = %s, want it to report a completed shutdown", out.String())
	}
}

type cancelOnListening struct {
	cancel context.CancelFunc

	mu  sync.Mutex
	log bytes.Buffer
}

func (c *cancelOnListening) Write(p []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	n, err := c.log.Write(p)
	if bytes.Contains(p, []byte("listening")) {
		c.cancel()
	}
	return n, err
}

func (c *cancelOnListening) String() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.log.String()
}

func TestServeReportsListenerFailure(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	if err := listener.Close(); err != nil {
		t.Fatalf("close listener: %v", err)
	}

	logger := slog.New(slog.DiscardHandler)
	err = serve(context.Background(), newHTTPServer(http.NotFoundHandler()), listener, time.Second, logger)
	if err == nil {
		t.Fatal("serve on a closed listener = nil, want an error")
	}
}

// Command server runs the calculator HTTP service.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/GabrielKenji28/Web-Calculator/backend/internal/calc"
	"github.com/GabrielKenji28/Web-Calculator/backend/internal/httpapi"
)

const (
	envPort                = "PORT"
	envStaticDir           = "STATIC_DIR"
	defaultPort            = 8080
	defaultShutdownTimeout = 10 * time.Second

	readHeaderTimeout = 5 * time.Second
	readTimeout       = 10 * time.Second
	writeTimeout      = 10 * time.Second
	idleTimeout       = 60 * time.Second
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, os.Args[1:], os.Getenv, os.Stdout); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

type config struct {
	port            int
	staticDir       string
	shutdownTimeout time.Duration
}

func run(ctx context.Context, args []string, getenv func(string) string, out io.Writer) error {
	cfg, err := parseConfig(args, getenv, out)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}

	logger := slog.New(slog.NewJSONHandler(out, &slog.HandlerOptions{Level: slog.LevelInfo}))
	router := httpapi.NewRouter(calc.New(), logger)
	if cfg.staticDir != "" {
		router, err = httpapi.WithStaticFiles(router, cfg.staticDir)
		if err != nil {
			return fmt.Errorf("configure static files: %w", err)
		}
	}

	listener, err := net.Listen("tcp", net.JoinHostPort("", strconv.Itoa(cfg.port)))
	if err != nil {
		return fmt.Errorf("listen on port %d: %w", cfg.port, err)
	}
	logger.Info("calculator service listening", "addr", listener.Addr().String())

	return serve(ctx, newHTTPServer(router), listener, cfg.shutdownTimeout, logger)
}

func parseConfig(args []string, getenv func(string) string, out io.Writer) (config, error) {
	port := defaultPort
	if raw := getenv(envPort); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || !validPort(parsed) {
			return config{}, fmt.Errorf("invalid %s value %q: want an integer between 0 and 65535", envPort, raw)
		}
		port = parsed
	}

	fs := flag.NewFlagSet("server", flag.ContinueOnError)
	fs.SetOutput(out)
	portFlag := fs.Int("port", port, "TCP port to listen on (overrides $"+envPort+"; 0 picks a free port)")
	staticDirFlag := fs.String("static-dir", getenv(envStaticDir), "built frontend directory (overrides $"+envStaticDir+"; empty disables static serving)")
	shutdownFlag := fs.Duration("shutdown-timeout", defaultShutdownTimeout, "how long in-flight requests may finish during shutdown")
	if err := fs.Parse(args); err != nil {
		return config{}, err
	}
	if !validPort(*portFlag) {
		return config{}, fmt.Errorf("invalid -port value %d: want an integer between 0 and 65535", *portFlag)
	}
	if *shutdownFlag <= 0 {
		return config{}, fmt.Errorf("invalid -shutdown-timeout value %s: want a positive duration", *shutdownFlag)
	}
	return config{port: *portFlag, staticDir: *staticDirFlag, shutdownTimeout: *shutdownFlag}, nil
}

func validPort(port int) bool {
	return port >= 0 && port <= 65535
}

func newHTTPServer(h http.Handler) *http.Server {
	return &http.Server{
		Handler:           h,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
	}
}

func serve(ctx context.Context, srv *http.Server, listener net.Listener, shutdownTimeout time.Duration, logger *slog.Logger) error {
	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.Serve(listener) }()

	select {
	case err := <-serveErr:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serve: %w", err)
		}
		return nil
	case <-ctx.Done():
	}

	logger.Info("shutting down", "timeout", shutdownTimeout.String())
	// context.WithoutCancel: ctx is already done here, so deriving the shutdown
	// deadline directly from it would expire immediately.
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	<-serveErr
	logger.Info("shutdown complete")
	return nil
}

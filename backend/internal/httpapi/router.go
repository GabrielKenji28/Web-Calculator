package httpapi

import (
	"log/slog"
	"net/http"
)

const (
	healthPattern    = "GET /health"
	calculatePattern = "POST /api/v1/calculate"
)

func NewRouter(c Calculator, logger *slog.Logger) http.Handler {
	h := newHandler(c, logger)

	mux := http.NewServeMux()
	mux.HandleFunc(healthPattern, h.health)
	mux.HandleFunc(calculatePattern, h.calculate)
	return mux
}

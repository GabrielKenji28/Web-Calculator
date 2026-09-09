package httpapi

import (
	"log/slog"
	"net/http"
)

// Routes of the service. The health check sits outside the versioned prefix so
// that it survives a future /api/v2.
const (
	healthPattern    = "GET /health"
	calculatePattern = "POST /api/v1/calculate"
)

// NewRouter wires the calculator endpoints and returns the service handler.
//
// Method-scoped patterns let net/http answer a wrong method with 405 and an
// Allow header, and an unknown path with 404. Those two responses are the only
// ones that are not JSON: the contract freezes no code for them, and inventing
// one would put a payload on the wire that the frontend has never agreed to.
func NewRouter(c Calculator, logger *slog.Logger) http.Handler {
	h := newHandler(c, logger)

	mux := http.NewServeMux()
	mux.HandleFunc(healthPattern, h.health)
	mux.HandleFunc(calculatePattern, h.calculate)
	return mux
}

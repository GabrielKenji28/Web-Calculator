// Package httpapi exposes the calculator over HTTP.
package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math"
	"net/http"
	"strconv"

	"github.com/GabrielKenji28/Web-Calculator/backend/internal/calc"
)

const contentTypeJSON = "application/json"

const maxRequestBytes = 64 << 10

// Calculator is declared at the consumer so tests can inject one that fails in
// ways no real request can trigger.
type Calculator interface {
	Calculate(ctx context.Context, operation string, operands []float64) (float64, error)
}

type handler struct {
	calc   Calculator
	logger *slog.Logger
}

func newHandler(c Calculator, logger *slog.Logger) *handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &handler{calc: c, logger: logger}
}

type healthResponse struct {
	Status string `json:"status"`
}

type resultResponse struct {
	Result float64 `json:"result"`
}

type errorResponse struct {
	Error errorBody `json:"error"`
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// A *string and raw operand messages preserve the missing/null distinctions
// that a plain string/[]float64 pair would erase.
type calculateRequest struct {
	Operation *string           `json:"operation"`
	Operands  []json.RawMessage `json:"operands"`
}

func (h *handler) health(w http.ResponseWriter, r *http.Request) {
	h.respond(w, r, http.StatusOK, healthResponse{Status: "ok"})
}

func (h *handler) calculate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	operation, operands, err := decodeCalculateRequest(r.Body)
	if err != nil {
		h.respondError(w, r, err)
		return
	}

	result, err := h.calc.Calculate(ctx, operation, operands)
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	if math.IsInf(result, 0) || math.IsNaN(result) {
		h.respondError(w, r, calc.ErrNonFiniteResult)
		return
	}

	h.respond(w, r, http.StatusOK, resultResponse{Result: normalizeZero(result)})
}

func decodeCalculateRequest(body io.Reader) (string, []float64, error) {
	dec := json.NewDecoder(body)
	dec.DisallowUnknownFields()

	var req calculateRequest
	if err := dec.Decode(&req); err != nil {
		return "", nil, errInvalidRequest
	}
	// A second value would only exist if the body carried trailing data.
	if err := dec.Decode(new(json.RawMessage)); !errors.Is(err, io.EOF) {
		return "", nil, errInvalidRequest
	}

	if req.Operation == nil || *req.Operation == "" {
		return "", nil, errInvalidRequest
	}

	operands := make([]float64, 0, len(req.Operands))
	for _, raw := range req.Operands {
		operand, ok := decodeOperand(raw)
		if !ok {
			return "", nil, errInvalidRequest
		}
		operands = append(operands, operand)
	}
	return *req.Operation, operands, nil
}

func decodeOperand(raw json.RawMessage) (float64, bool) {
	literal := bytes.TrimSpace(raw)
	if len(literal) == 0 {
		return 0, false
	}
	if first := literal[0]; first != '-' && (first < '0' || first > '9') {
		return 0, false
	}
	value, err := strconv.ParseFloat(string(literal), 64)
	if err != nil && !errors.Is(err, strconv.ErrRange) {
		return 0, false
	}
	if math.IsInf(value, 0) || math.IsNaN(value) {
		return 0, false
	}
	return value, true
}

func normalizeZero(value float64) float64 {
	if value == 0 {
		return 0
	}
	return value
}

func (h *handler) respond(w http.ResponseWriter, r *http.Request, status int, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		h.logger.ErrorContext(r.Context(), "encode response body", "error", err, "path", r.URL.Path)
		body = staticInternalErrorBody()
		status = http.StatusInternalServerError
	}

	w.Header().Set("Content-Type", contentTypeJSON)
	w.WriteHeader(status)
	if _, err := w.Write(body); err != nil {
		h.logger.ErrorContext(r.Context(), "write response body", "error", err, "path", r.URL.Path)
	}
}

func (h *handler) respondError(w http.ResponseWriter, r *http.Request, err error) {
	status, code := responseForError(err)
	if status == http.StatusInternalServerError {
		h.logger.ErrorContext(r.Context(), "calculation failed unexpectedly", "error", err, "path", r.URL.Path)
	}
	h.respond(w, r, status, errorResponse{Error: errorBody{Code: code, Message: messageForCode(code)}})
}

func staticInternalErrorBody() []byte {
	return []byte(`{"error":{"code":"` + codeInternalError + `","message":"` + msgInternalError + `"}}`)
}

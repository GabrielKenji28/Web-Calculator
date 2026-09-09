// Package httpapi exposes the calculator over HTTP. It owns every transport
// concern: decoding, request validation, status codes, and the JSON envelope.
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

// contentTypeJSON is the exact Content-Type of every response this package
// writes. The contract pins it without a charset parameter, which is also why
// http.Error is never used here: it would write text/plain.
const contentTypeJSON = "application/json"

// maxRequestBytes caps the request body. A calculate request is well under a
// hundred bytes, so anything larger is a mistake or an attack.
const maxRequestBytes = 64 << 10

// Calculator is the arithmetic the handler needs. It is declared here, at the
// consumer, so that tests can inject a calculator that fails in ways no real
// request can trigger.
type Calculator interface {
	Calculate(ctx context.Context, operation string, operands []float64) (float64, error)
}

// handler serves the calculator endpoints.
type handler struct {
	calc   Calculator
	logger *slog.Logger
}

// newHandler returns a handler. A nil logger falls back to slog.Default.
func newHandler(c Calculator, logger *slog.Logger) *handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &handler{calc: c, logger: logger}
}

// healthResponse is the body of GET /health.
type healthResponse struct {
	Status string `json:"status"`
}

// resultResponse is the body of a successful calculation.
type resultResponse struct {
	Result float64 `json:"result"`
}

// errorResponse is the frozen error envelope.
type errorResponse struct {
	Error errorBody `json:"error"`
}

// errorBody carries the machine-readable code and the user-facing message.
type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// calculateRequest mirrors the wire shape of a calculate request.
//
// Both fields keep JSON's distinctions that a plain string/[]float64 pair would
// erase: a *string separates a missing or null operation from an empty one, and
// raw operand messages separate null and "1" from the number 1.
type calculateRequest struct {
	Operation *string           `json:"operation"`
	Operands  []json.RawMessage `json:"operands"`
}

// health reports that the service is up.
func (h *handler) health(w http.ResponseWriter, r *http.Request) {
	h.respond(w, r, http.StatusOK, healthResponse{Status: "ok"})
}

// calculate decodes, validates, evaluates, and encodes one calculation.
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
		// Unreachable through calc.Service, which already rejects non-finite
		// results. Guarded anyway because encoding/json cannot represent them.
		h.respondError(w, r, calc.ErrNonFiniteResult)
		return
	}

	h.respond(w, r, http.StatusOK, resultResponse{Result: normalizeZero(result)})
}

// decodeCalculateRequest reads exactly one JSON object from body and returns the
// operation name and the decoded operands.
//
// Every failure is errInvalidRequest: the contract answers all of them with the
// same envelope, and a more specific message would leak parser internals.
func decodeCalculateRequest(body io.Reader) (string, []float64, error) {
	dec := json.NewDecoder(body)
	dec.DisallowUnknownFields()

	var req calculateRequest
	if err := dec.Decode(&req); err != nil {
		return "", nil, errInvalidRequest
	}
	// One object and nothing else: a second value, or trailing garbage, is a
	// malformed request rather than an ignorable suffix.
	if err := dec.Decode(new(json.RawMessage)); !errors.Is(err, io.EOF) {
		return "", nil, errInvalidRequest
	}

	// A null or absent operation decodes to a nil pointer; an empty name is
	// never a registered operation, so it is a malformed request too.
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
	// The operand count is checked against the operation's arity by the
	// calculator, which is what defines it.
	return *req.Operation, operands, nil
}

// decodeOperand converts one raw operand to a finite float64.
//
// It reports false for anything that is not a JSON number — null, a string
// (including a numeric one such as "1"), a boolean, an object, an array — and
// for numeric literals outside the finite binary64 range such as 1e309.
// Literals that merely underflow, such as 1e-400, are accepted as zero.
func decodeOperand(raw json.RawMessage) (float64, bool) {
	literal := bytes.TrimSpace(raw)
	if len(literal) == 0 {
		return 0, false
	}
	// JSON numbers are the only values that start with a minus sign or a digit.
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

// normalizeZero maps negative zero onto positive zero so that the response body
// reads 0 rather than -0. The two compare equal, so this is purely about how the
// result is written.
func normalizeZero(value float64) float64 {
	if value == 0 {
		return 0
	}
	return value
}

// respond writes a JSON body with the given status.
func (h *handler) respond(w http.ResponseWriter, r *http.Request, status int, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		// Only the fixed payload types of this package reach here, and all of
		// them marshal, so this is a programming error rather than a request
		// failure. Report it without recursing through respondError.
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

// respondError writes the contract error envelope for err.
func (h *handler) respondError(w http.ResponseWriter, r *http.Request, err error) {
	status, code := responseForError(err)
	if status == http.StatusInternalServerError {
		// The client is told nothing beyond INTERNAL_ERROR, so the detail has
		// to survive here.
		h.logger.ErrorContext(r.Context(), "calculation failed unexpectedly", "error", err, "path", r.URL.Path)
	}
	h.respond(w, r, status, errorResponse{Error: errorBody{Code: code, Message: messageForCode(code)}})
}

// staticInternalErrorBody is the last-resort body used when marshalling fails.
func staticInternalErrorBody() []byte {
	return []byte(`{"error":{"code":"` + codeInternalError + `","message":"` + msgInternalError + `"}}`)
}

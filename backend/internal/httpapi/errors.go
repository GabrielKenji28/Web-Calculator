package httpapi

import (
	"errors"
	"net/http"

	"github.com/GabrielKenji28/Web-Calculator/backend/internal/calc"
)

// Error codes of the frozen contract envelope.
const (
	codeInvalidRequest   = "INVALID_REQUEST"
	codeUnknownOperation = "UNKNOWN_OPERATION"
	codeDivisionByZero   = "DIVISION_BY_ZERO"
	codeNegativeSqrt     = "NEGATIVE_SQRT"
	codeInvalidPower     = "INVALID_POWER"
	codeNonFiniteResult  = "NON_FINITE_RESULT"
	codeInternalError    = "INTERNAL_ERROR"
)

// Error messages of the frozen contract envelope. They are user-facing copy and
// must match contract/fixtures.json character for character, trailing period
// included; TestErrorCatalogMatchesContract asserts that they do.
const (
	msgInvalidRequest   = "Provide one JSON object with an operation and the required finite numeric operands."
	msgUnknownOperation = "Operation is not supported."
	msgDivisionByZero   = "Cannot divide by zero."
	msgNegativeSqrt     = "Cannot take the square root of a negative number."
	msgInvalidPower     = "Zero cannot have a negative exponent, and negative bases require an integer exponent."
	msgNonFiniteResult  = "Calculation result is outside the finite number range."
	msgInternalError    = "An unexpected server error occurred."
)

// errInvalidRequest marks a request that failed validation at the HTTP
// boundary, before any arithmetic was attempted.
var errInvalidRequest = errors.New("invalid request")

// errorCodes returns every code of the contract envelope. It builds a fresh
// slice on each call so that the package holds no mutable global state.
func errorCodes() []string {
	return []string{
		codeInvalidRequest,
		codeUnknownOperation,
		codeDivisionByZero,
		codeNegativeSqrt,
		codeInvalidPower,
		codeNonFiniteResult,
		codeInternalError,
	}
}

// messageForCode returns the user-facing message of an error code.
func messageForCode(code string) string {
	switch code {
	case codeInvalidRequest:
		return msgInvalidRequest
	case codeUnknownOperation:
		return msgUnknownOperation
	case codeDivisionByZero:
		return msgDivisionByZero
	case codeNegativeSqrt:
		return msgNegativeSqrt
	case codeInvalidPower:
		return msgInvalidPower
	case codeNonFiniteResult:
		return msgNonFiniteResult
	case codeInternalError:
		return msgInternalError
	default:
		return msgInternalError
	}
}

// responseForError maps an error to the single place where status codes and
// error codes are decided.
//
// Every failure the caller can correct — malformed JSON, an unknown operation,
// division by zero, an overflowing result — is a 400. A 500 is reserved for
// faults that are genuinely the server's, and no request content can produce
// one: the default branch is reachable only if the calculator returns an error
// this package does not know about.
func responseForError(err error) (status int, code string) {
	switch {
	case errors.Is(err, errInvalidRequest),
		errors.Is(err, calc.ErrInvalidOperandCount):
		return http.StatusBadRequest, codeInvalidRequest
	case errors.Is(err, calc.ErrUnknownOperation):
		return http.StatusBadRequest, codeUnknownOperation
	case errors.Is(err, calc.ErrDivisionByZero):
		return http.StatusBadRequest, codeDivisionByZero
	case errors.Is(err, calc.ErrNegativeSqrt):
		return http.StatusBadRequest, codeNegativeSqrt
	case errors.Is(err, calc.ErrInvalidPower):
		return http.StatusBadRequest, codeInvalidPower
	case errors.Is(err, calc.ErrNonFiniteResult):
		return http.StatusBadRequest, codeNonFiniteResult
	default:
		return http.StatusInternalServerError, codeInternalError
	}
}

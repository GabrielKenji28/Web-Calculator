package httpapi

import (
	"errors"
	"net/http"

	"github.com/GabrielKenji28/Web-Calculator/backend/internal/calc"
)

const (
	codeInvalidRequest   = "INVALID_REQUEST"
	codeUnknownOperation = "UNKNOWN_OPERATION"
	codeDivisionByZero   = "DIVISION_BY_ZERO"
	codeNegativeSqrt     = "NEGATIVE_SQRT"
	codeInvalidPower     = "INVALID_POWER"
	codeNonFiniteResult  = "NON_FINITE_RESULT"
	codeInternalError    = "INTERNAL_ERROR"
)

// Must match contract/fixtures.json character for character;
// TestErrorCatalogMatchesContract asserts that they do.
const (
	msgInvalidRequest   = "Provide one JSON object with an operation and the required finite numeric operands."
	msgUnknownOperation = "Operation is not supported."
	msgDivisionByZero   = "Cannot divide by zero."
	msgNegativeSqrt     = "Cannot take the square root of a negative number."
	msgInvalidPower     = "Zero cannot have a negative exponent, and negative bases require an integer exponent."
	msgNonFiniteResult  = "Calculation result is outside the finite number range."
	msgInternalError    = "An unexpected server error occurred."
)

var errInvalidRequest = errors.New("invalid request")

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

package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/GabrielKenji28/Web-Calculator/backend/internal/calc"
	"github.com/GabrielKenji28/Web-Calculator/backend/internal/contracttest"
)

const (
	wantCoreCases     = 52
	wantAdvancedCases = 28
	wantInjectedCases = 1
)

const faultCaseID = "unexpected-server-error"

func TestContractFixtures(t *testing.T) {
	t.Parallel()

	fixtures := contracttest.Load(t)
	router := newTestRouter(t, calc.New())

	milestones := []struct {
		name      string
		wantCases int
	}{
		{name: contracttest.MilestoneCore, wantCases: wantCoreCases},
		{name: contracttest.MilestoneAdvanced, wantCases: wantAdvancedCases},
	}

	var replayed, injected int
	for _, milestone := range milestones {
		cases := fixtures.CasesForMilestone(milestone.name)
		if len(cases) != milestone.wantCases {
			t.Fatalf("%s contract cases = %d, want %d; update the expected count deliberately if the contract changed", milestone.name, len(cases), milestone.wantCases)
		}

		for _, tc := range cases {
			if tc.TestFault != "" {
				injected++
				continue
			}
			replayed++

			t.Run(milestone.name+"/"+tc.ID, func(t *testing.T) {
				t.Parallel()

				rec := httptest.NewRecorder()
				router.ServeHTTP(rec, fixtureRequest(tc))
				assertResponse(t, rec, tc.Expected)
			})
		}
	}

	if replayed+injected != len(fixtures.Cases) {
		t.Fatalf("replayed %d + injected %d cases, want all %d contract cases; a milestone is unaccounted for", replayed, injected, len(fixtures.Cases))
	}
	if injected != wantInjectedCases {
		t.Errorf("cases needing an injected fault = %d, want %d", injected, wantInjectedCases)
	}
	t.Logf("replayed %d contract cases across %d milestones, %d covered by fault injection", replayed, len(milestones), injected)
}

func TestInjectedServerFault(t *testing.T) {
	t.Parallel()

	fixtures := contracttest.Load(t)
	tc := fixtures.CaseByID(t, faultCaseID)
	if tc.TestFault == "" {
		t.Fatalf("fixture %q no longer carries a testFault", faultCaseID)
	}

	if success := fixtures.CaseByID(t, "add-positive"); success.Request.Body != tc.Request.Body {
		t.Fatalf("fixture %q body = %q, want the same bytes as add-positive %q", tc.ID, tc.Request.Body, success.Request.Body)
	}

	router := newTestRouter(t, failingCalculator{err: errors.New("calculator exploded")})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, fixtureRequest(tc))
	assertResponse(t, rec, tc.Expected)
}

func TestFaultMetadataIsNotTransported(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, calc.New())

	tests := []struct {
		name       string
		target     string
		body       string
		header     string
		wantStatus int
		wantBody   string
	}{
		{
			name:       "body field",
			target:     "/api/v1/calculate",
			body:       `{"operation":"add","operands":[10,2],"testFault":"unexpected_error"}`,
			wantStatus: http.StatusBadRequest,
			wantBody:   `{"error":{"code":"INVALID_REQUEST","message":"` + msgInvalidRequest + `"}}`,
		},
		{
			name:       "query parameter",
			target:     "/api/v1/calculate?testFault=unexpected_error",
			body:       `{"operation":"add","operands":[10,2]}`,
			wantStatus: http.StatusOK,
			wantBody:   `{"result":12}`,
		},
		{
			name:       "header",
			target:     "/api/v1/calculate",
			body:       `{"operation":"add","operands":[10,2]}`,
			header:     "unexpected_error",
			wantStatus: http.StatusOK,
			wantBody:   `{"result":12}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(http.MethodPost, tt.target, strings.NewReader(tt.body))
			req.Header.Set("Content-Type", contentTypeJSON)
			if tt.header != "" {
				req.Header.Set("X-Test-Fault", tt.header)
			}
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d (body %s)", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if got := rec.Body.String(); got != tt.wantBody {
				t.Errorf("body = %s, want %s", got, tt.wantBody)
			}
		})
	}
}

func TestNegativeZeroIsWrittenAsPositiveZero(t *testing.T) {
	t.Parallel()

	// -0 and 0 are equal floats, so only the raw encoded body catches this.
	caseIDs := []string{"normalize-negative-zero", "sqrt-negative-zero"}

	fixtures := contracttest.Load(t)
	router := newTestRouter(t, calc.New())

	for _, id := range caseIDs {
		t.Run(id, func(t *testing.T) {
			t.Parallel()

			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, fixtureRequest(fixtures.CaseByID(t, id)))

			if got, want := rec.Body.String(), `{"result":0}`; got != want {
				t.Errorf("body = %s, want %s", got, want)
			}
		})
	}
}

func TestCalculatorContractViolations(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		calculator Calculator
		wantStatus int
		wantBody   string
	}{
		{
			name:       "unrecognised error becomes an internal error",
			calculator: failingCalculator{err: errors.New("boom")},
			wantStatus: http.StatusInternalServerError,
			wantBody:   `{"error":{"code":"INTERNAL_ERROR","message":"` + msgInternalError + `"}}`,
		},
		{
			name:       "positive infinity is refused",
			calculator: fixedCalculator{result: math.Inf(1)},
			wantStatus: http.StatusBadRequest,
			wantBody:   `{"error":{"code":"NON_FINITE_RESULT","message":"` + msgNonFiniteResult + `"}}`,
		},
		{
			name:       "negative infinity is refused",
			calculator: fixedCalculator{result: math.Inf(-1)},
			wantStatus: http.StatusBadRequest,
			wantBody:   `{"error":{"code":"NON_FINITE_RESULT","message":"` + msgNonFiniteResult + `"}}`,
		},
		{
			name:       "NaN is refused",
			calculator: fixedCalculator{result: math.NaN()},
			wantStatus: http.StatusBadRequest,
			wantBody:   `{"error":{"code":"NON_FINITE_RESULT","message":"` + msgNonFiniteResult + `"}}`,
		},
		{
			name:       "negative zero is normalised",
			calculator: fixedCalculator{result: math.Copysign(0, -1)},
			wantStatus: http.StatusOK,
			wantBody:   `{"result":0}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			router := newTestRouter(t, tt.calculator)
			req := httptest.NewRequest(http.MethodPost, "/api/v1/calculate", strings.NewReader(`{"operation":"add","operands":[10,2]}`))
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if got := rec.Body.String(); got != tt.wantBody {
				t.Errorf("body = %s, want %s", got, tt.wantBody)
			}
			if got := rec.Header().Get("Content-Type"); got != contentTypeJSON {
				t.Errorf("Content-Type = %q, want %q", got, contentTypeJSON)
			}
		})
	}
}

func TestOversizedBodyIsRejected(t *testing.T) {
	t.Parallel()

	body := `{"operation":"add","operands":[1,` + strings.Repeat("1", maxRequestBytes) + `]}`
	router := newTestRouter(t, calc.New())
	req := httptest.NewRequest(http.MethodPost, "/api/v1/calculate", strings.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if got, want := rec.Body.String(), `{"error":{"code":"INVALID_REQUEST","message":"`+msgInvalidRequest+`"}}`; got != want {
		t.Errorf("body = %s, want %s", got, want)
	}
}

func TestRoutingRejectsUnknownRoutes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		method     string
		target     string
		wantStatus int
		wantAllow  string
	}{
		{name: "GET on calculate", method: http.MethodGet, target: "/api/v1/calculate", wantStatus: http.StatusMethodNotAllowed, wantAllow: "POST"},
		{name: "PUT on calculate", method: http.MethodPut, target: "/api/v1/calculate", wantStatus: http.StatusMethodNotAllowed, wantAllow: "POST"},
		{name: "POST on health", method: http.MethodPost, target: "/health", wantStatus: http.StatusMethodNotAllowed, wantAllow: "GET, HEAD"},
		{name: "unknown path", method: http.MethodGet, target: "/api/v1/nope", wantStatus: http.StatusNotFound},
		{name: "unversioned calculate", method: http.MethodPost, target: "/calculate", wantStatus: http.StatusNotFound},
		{name: "health under the version prefix", method: http.MethodGet, target: "/api/v1/health", wantStatus: http.StatusNotFound},
	}

	router := newTestRouter(t, calc.New())
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, httptest.NewRequest(tt.method, tt.target, nil))

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if got := rec.Header().Get("Allow"); got != tt.wantAllow {
				t.Errorf("Allow = %q, want %q", got, tt.wantAllow)
			}
		})
	}
}

func TestHeadHealth(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, calc.New())
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodHead, "/health", nil))

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("Content-Type"); got != contentTypeJSON {
		t.Errorf("Content-Type = %q, want %q", got, contentTypeJSON)
	}
}

func TestErrorCatalogMatchesContract(t *testing.T) {
	t.Parallel()

	fixtures := contracttest.Load(t)
	codes := errorCodes()

	if len(codes) != len(fixtures.Errors) {
		t.Errorf("error codes = %d (%v), want %d (%v)", len(codes), codes, len(fixtures.Errors), fixtures.Errors)
	}
	for _, code := range codes {
		want, ok := fixtures.Errors[code]
		if !ok {
			t.Errorf("code %q is not in the contract", code)
			continue
		}
		if got := messageForCode(code); got != want {
			t.Errorf("messageForCode(%q) = %q, want %q", code, got, want)
		}
	}
}

func TestResponseForError(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{name: "invalid request", err: errInvalidRequest, wantStatus: http.StatusBadRequest, wantCode: codeInvalidRequest},
		{name: "invalid operand count", err: calc.ErrInvalidOperandCount, wantStatus: http.StatusBadRequest, wantCode: codeInvalidRequest},
		{name: "wrapped invalid operand count", err: fmtWrap(calc.ErrInvalidOperandCount), wantStatus: http.StatusBadRequest, wantCode: codeInvalidRequest},
		{name: "unknown operation", err: calc.ErrUnknownOperation, wantStatus: http.StatusBadRequest, wantCode: codeUnknownOperation},
		{name: "division by zero", err: calc.ErrDivisionByZero, wantStatus: http.StatusBadRequest, wantCode: codeDivisionByZero},
		{name: "negative square root", err: calc.ErrNegativeSqrt, wantStatus: http.StatusBadRequest, wantCode: codeNegativeSqrt},
		{name: "invalid power", err: calc.ErrInvalidPower, wantStatus: http.StatusBadRequest, wantCode: codeInvalidPower},
		{name: "non-finite result", err: calc.ErrNonFiniteResult, wantStatus: http.StatusBadRequest, wantCode: codeNonFiniteResult},
		{name: "unrecognised error", err: errors.New("boom"), wantStatus: http.StatusInternalServerError, wantCode: codeInternalError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			status, code := responseForError(tt.err)
			if status != tt.wantStatus || code != tt.wantCode {
				t.Errorf("responseForError(%v) = (%d, %q), want (%d, %q)", tt.err, status, code, tt.wantStatus, tt.wantCode)
			}
		})
	}
}

func TestMessageForUnknownCode(t *testing.T) {
	t.Parallel()

	if got := messageForCode("NOT_A_CODE"); got != msgInternalError {
		t.Errorf("messageForCode(unknown) = %q, want %q", got, msgInternalError)
	}
}

func TestDecodeOperand(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		literal string
		want    float64
		wantOK  bool
	}{
		{name: "integer", literal: `12`, want: 12, wantOK: true},
		{name: "decimal", literal: `1.25`, want: 1.25, wantOK: true},
		{name: "negative", literal: `-3`, want: -3, wantOK: true},
		{name: "exponent", literal: `1e308`, want: 1e308, wantOK: true},
		{name: "negative zero stays negative", literal: `-0`, want: math.Copysign(0, -1), wantOK: true},
		{name: "underflow becomes zero", literal: `1e-400`, want: 0, wantOK: true},
		{name: "surrounding space", literal: " 7 ", want: 7, wantOK: true},

		{name: "null", literal: `null`, wantOK: false},
		{name: "numeric string", literal: `"1"`, wantOK: false},
		{name: "non-numeric string", literal: `"hello"`, wantOK: false},
		{name: "boolean", literal: `true`, wantOK: false},
		{name: "object", literal: `{}`, wantOK: false},
		{name: "array", literal: `[]`, wantOK: false},
		{name: "empty", literal: ``, wantOK: false},
		{name: "lone minus sign", literal: `-`, wantOK: false},
		{name: "malformed number", literal: `1.2.3`, wantOK: false},
		{name: "positive overflow", literal: `1e309`, wantOK: false},
		{name: "negative overflow", literal: `-1e309`, wantOK: false},
		{name: "infinity literal", literal: `Infinity`, wantOK: false},
		{name: "NaN literal", literal: `NaN`, wantOK: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, ok := decodeOperand(json.RawMessage(tt.literal))
			if ok != tt.wantOK {
				t.Fatalf("decodeOperand(%q) ok = %v, want %v", tt.literal, ok, tt.wantOK)
			}
			if !tt.wantOK {
				return
			}
			if got != tt.want || math.Signbit(got) != math.Signbit(tt.want) {
				t.Errorf("decodeOperand(%q) = %v, want %v", tt.literal, got, tt.want)
			}
		})
	}
}

func TestNewRouterAcceptsNilLogger(t *testing.T) {
	t.Parallel()

	router := NewRouter(calc.New(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got, want := rec.Body.String(), `{"status":"ok"}`; got != want {
		t.Errorf("body = %s, want %s", got, want)
	}
}

func TestRespondFallsBackWhenEncodingFails(t *testing.T) {
	t.Parallel()

	h := newHandler(calc.New(), slog.New(slog.DiscardHandler))
	rec := httptest.NewRecorder()
	// A channel is the simplest value encoding/json refuses to marshal.
	h.respond(rec, httptest.NewRequest(http.MethodPost, "/api/v1/calculate", nil), http.StatusOK, make(chan int))

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	if got, want := rec.Header().Get("Content-Type"), contentTypeJSON; got != want {
		t.Errorf("Content-Type = %q, want %q", got, want)
	}
	want := `{"error":{"code":"INTERNAL_ERROR","message":"` + msgInternalError + `"}}`
	if got := rec.Body.String(); got != want {
		t.Errorf("body = %s, want %s", got, want)
	}
}

func newTestRouter(tb testing.TB, c Calculator) http.Handler {
	tb.Helper()
	return NewRouter(c, slog.New(slog.DiscardHandler))
}

func fixtureRequest(tc contracttest.Case) *http.Request {
	req := httptest.NewRequest(tc.Request.Method, tc.Request.Path, strings.NewReader(tc.Request.Body))
	for name, value := range tc.Request.Headers {
		req.Header.Set(name, value)
	}
	return req
}

func assertResponse(tb testing.TB, rec *httptest.ResponseRecorder, want contracttest.Expected) {
	tb.Helper()

	if rec.Code != want.Status {
		tb.Errorf("status = %d, want %d (body %s)", rec.Code, want.Status, rec.Body.String())
	}
	if len(want.Headers) == 0 {
		tb.Error("contract case pins no response headers")
	}
	for name, value := range want.Headers {
		if got := rec.Header().Get(name); got != value {
			tb.Errorf("header %s = %q, want %q", name, got, value)
		}
	}
	if got, wantBody := parseJSON(tb, rec.Body.Bytes()), parseJSON(tb, want.Body); !reflect.DeepEqual(got, wantBody) {
		tb.Errorf("body = %s, want %s", rec.Body.String(), want.Body)
	}
}

func parseJSON(tb testing.TB, data []byte) any {
	tb.Helper()

	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		tb.Fatalf("parse JSON %q: %v", data, err)
	}
	return value
}

func fmtWrap(err error) error {
	return errors.Join(errors.New("context"), err)
}

type failingCalculator struct {
	err error
}

func (c failingCalculator) Calculate(context.Context, string, []float64) (float64, error) {
	return 0, c.err
}

type fixedCalculator struct {
	result float64
}

func (c fixedCalculator) Calculate(context.Context, string, []float64) (float64, error) {
	return c.result, nil
}

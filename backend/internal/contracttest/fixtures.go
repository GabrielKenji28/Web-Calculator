// Package contracttest loads the shared golden fixtures in contract/fixtures.json.
//
// It is test-only support code: no production package imports it. The file it
// reads is the single source of truth shared with the frontend, so the structs
// below model it exhaustively and decoding rejects unknown fields — a schema
// change that nobody told the backend about fails a test instead of silently
// being ignored.
package contracttest

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// SchemaVersion is the fixture schema this loader understands.
const SchemaVersion = 1

// Milestone values used by the fixture file.
const (
	MilestoneCore     = "core"
	MilestoneAdvanced = "advanced"
)

// Fixtures is the whole contract file.
type Fixtures struct {
	SchemaVersion int               `json:"schemaVersion"`
	Operations    []Operation       `json:"operations"`
	RequestPolicy RequestPolicy     `json:"requestPolicy"`
	NumberPolicy  NumberPolicy      `json:"numberPolicy"`
	Errors        map[string]string `json:"errors"`
	Cases         []Case            `json:"cases"`
}

// Operation is the published metadata for one calculator operation.
type Operation struct {
	Name          string   `json:"name"`
	Arity         int      `json:"arity"`
	Milestone     string   `json:"milestone"`
	OperandLabels []string `json:"operandLabels"`
}

// RequestPolicy records how strictly requests are parsed.
type RequestPolicy struct {
	RejectUnknownFields         bool   `json:"rejectUnknownFields"`
	RequireSingleJSONObject     bool   `json:"requireSingleJSONObject"`
	OperationNamesCaseSensitive bool   `json:"operationNamesCaseSensitive"`
	OperandType                 string `json:"operandType"`
}

// NumberPolicy records how numbers are represented and presented.
type NumberPolicy struct {
	Representation                      string  `json:"representation"`
	DisplaySignificantDigits            int     `json:"displaySignificantDigits"`
	NormalizeNegativeZero               bool    `json:"normalizeNegativeZero"`
	PercentageFormula                   string  `json:"percentageFormula"`
	ZeroToZeroPower                     float64 `json:"zeroToZeroPower"`
	NegativeBaseRequiresIntegerExponent bool    `json:"negativeBaseRequiresIntegerExponent"`
}

// Case is one golden request/response pair.
type Case struct {
	ID        string   `json:"id"`
	Milestone string   `json:"milestone"`
	Preview   bool     `json:"preview"`
	Request   Request  `json:"request"`
	Expected  Expected `json:"expected"`
	// TestFault names a fault that a test must inject to reach the expected
	// response. It is test-only metadata and must never travel over HTTP.
	TestFault string `json:"testFault"`
	// ExpectedDisplay is the frontend's formatted rendering of the result. The
	// backend never rounds, so it is unused here and modelled only so that
	// strict decoding keeps working.
	ExpectedDisplay string `json:"expectedDisplay"`
}

// Request is the literal wire request of a case.
type Request struct {
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Headers map[string]string `json:"headers"`
	// Body is the exact request body. Six cases are deliberately invalid JSON,
	// so it must be sent verbatim and never re-marshalled.
	Body string `json:"body"`
}

// Expected is the response a case pins.
type Expected struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	// Body is parsed JSON. Compare it against a parsed response body, not
	// against raw bytes: the fixture file is pretty-printed.
	Body json.RawMessage `json:"body"`
}

// Load reads and validates the shared fixture file.
func Load(tb testing.TB) *Fixtures {
	tb.Helper()

	path := Path(tb)
	data, err := os.ReadFile(path)
	if err != nil {
		tb.Fatalf("read contract fixtures at %s: %v", path, err)
	}

	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var f Fixtures
	if err := dec.Decode(&f); err != nil {
		tb.Fatalf("decode contract fixtures at %s: %v", path, err)
	}
	if f.SchemaVersion != SchemaVersion {
		tb.Fatalf("contract fixtures schemaVersion = %d, want %d", f.SchemaVersion, SchemaVersion)
	}
	if len(f.Cases) == 0 {
		tb.Fatalf("contract fixtures at %s contain no cases", path)
	}
	return &f
}

// Path returns the absolute path of the shared fixture file.
//
// It is resolved from this source file's own location so that it does not
// depend on which package's tests are running.
func Path(tb testing.TB) string {
	tb.Helper()

	_, self, _, ok := runtime.Caller(0)
	if !ok {
		tb.Fatal("cannot resolve the contracttest source location")
	}
	// self is <repo>/backend/internal/contracttest/fixtures.go.
	repoRoot := filepath.Join(filepath.Dir(self), "..", "..", "..")
	path := filepath.Clean(filepath.Join(repoRoot, "contract", "fixtures.json"))
	if _, err := os.Stat(path); err != nil {
		tb.Fatalf("contract fixtures not found at %s: %v", path, err)
	}
	return path
}

// CasesForMilestone returns the cases of one milestone, in file order.
func (f *Fixtures) CasesForMilestone(milestone string) []Case {
	cases := make([]Case, 0, len(f.Cases))
	for _, c := range f.Cases {
		if c.Milestone == milestone {
			cases = append(cases, c)
		}
	}
	return cases
}

// CaseByID returns the case with the given id and fails the test if it is absent.
func (f *Fixtures) CaseByID(tb testing.TB, id string) Case {
	tb.Helper()

	for _, c := range f.Cases {
		if c.ID == id {
			return c
		}
	}
	tb.Fatalf("no contract fixture with id %q", id)
	return Case{}
}

// OperationNamesForMilestone returns the operation names of one milestone, in
// file order.
func (f *Fixtures) OperationNamesForMilestone(milestone string) []string {
	names := make([]string, 0, len(f.Operations))
	for _, op := range f.Operations {
		if op.Milestone == milestone {
			names = append(names, op.Name)
		}
	}
	return names
}

// OperationByName returns the published metadata for one operation.
func (f *Fixtures) OperationByName(tb testing.TB, name string) Operation {
	tb.Helper()

	for _, op := range f.Operations {
		if op.Name == name {
			return op
		}
	}
	tb.Fatalf("no contract operation named %q", name)
	return Operation{}
}

// String renders a case for test failure messages.
func (c Case) String() string {
	return fmt.Sprintf("%s (%s %s)", c.ID, c.Request.Method, c.Request.Path)
}

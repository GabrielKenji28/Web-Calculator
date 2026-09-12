// Package contracttest loads the shared golden fixtures in contract/fixtures.json.
// Test-only: no production package imports it.
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

const SchemaVersion = 1

const (
	MilestoneCore     = "core"
	MilestoneAdvanced = "advanced"
)

type Fixtures struct {
	SchemaVersion int               `json:"schemaVersion"`
	Operations    []Operation       `json:"operations"`
	RequestPolicy RequestPolicy     `json:"requestPolicy"`
	NumberPolicy  NumberPolicy      `json:"numberPolicy"`
	Errors        map[string]string `json:"errors"`
	Cases         []Case            `json:"cases"`
}

type Operation struct {
	Name          string   `json:"name"`
	Arity         int      `json:"arity"`
	Milestone     string   `json:"milestone"`
	OperandLabels []string `json:"operandLabels"`
}

type RequestPolicy struct {
	RejectUnknownFields         bool   `json:"rejectUnknownFields"`
	RequireSingleJSONObject     bool   `json:"requireSingleJSONObject"`
	OperationNamesCaseSensitive bool   `json:"operationNamesCaseSensitive"`
	OperandType                 string `json:"operandType"`
}

type NumberPolicy struct {
	Representation                      string  `json:"representation"`
	DisplaySignificantDigits            int     `json:"displaySignificantDigits"`
	NormalizeNegativeZero               bool    `json:"normalizeNegativeZero"`
	PercentageFormula                   string  `json:"percentageFormula"`
	ZeroToZeroPower                     float64 `json:"zeroToZeroPower"`
	NegativeBaseRequiresIntegerExponent bool    `json:"negativeBaseRequiresIntegerExponent"`
}

type Case struct {
	ID        string   `json:"id"`
	Milestone string   `json:"milestone"`
	Preview   bool     `json:"preview"`
	Request   Request  `json:"request"`
	Expected  Expected `json:"expected"`
	// TestFault names a fault a test must inject to reach the expected
	// response; it must never travel over HTTP.
	TestFault string `json:"testFault"`
	// ExpectedDisplay is the frontend's rendering; the backend never rounds, so
	// this field only exists to keep strict decoding from rejecting it.
	ExpectedDisplay string `json:"expectedDisplay"`
}

type Request struct {
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Headers map[string]string `json:"headers"`
	// Some cases are deliberately invalid JSON; send this verbatim, never
	// re-marshalled.
	Body string `json:"body"`
}

type Expected struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    json.RawMessage   `json:"body"`
}

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

func Path(tb testing.TB) string {
	tb.Helper()

	_, self, _, ok := runtime.Caller(0)
	if !ok {
		tb.Fatal("cannot resolve the contracttest source location")
	}
	repoRoot := filepath.Join(filepath.Dir(self), "..", "..", "..")
	path := filepath.Clean(filepath.Join(repoRoot, "contract", "fixtures.json"))
	if _, err := os.Stat(path); err != nil {
		tb.Fatalf("contract fixtures not found at %s: %v", path, err)
	}
	return path
}

func (f *Fixtures) CasesForMilestone(milestone string) []Case {
	cases := make([]Case, 0, len(f.Cases))
	for _, c := range f.Cases {
		if c.Milestone == milestone {
			cases = append(cases, c)
		}
	}
	return cases
}

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

func (f *Fixtures) OperationNamesForMilestone(milestone string) []string {
	names := make([]string, 0, len(f.Operations))
	for _, op := range f.Operations {
		if op.Milestone == milestone {
			names = append(names, op.Name)
		}
	}
	return names
}

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

func (c Case) String() string {
	return fmt.Sprintf("%s (%s %s)", c.ID, c.Request.Method, c.Request.Path)
}

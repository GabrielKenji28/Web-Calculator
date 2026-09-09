package calc_test

import (
	"context"
	"errors"
	"math"
	"slices"
	"testing"

	"github.com/GabrielKenji28/Web-Calculator/backend/internal/calc"
	"github.com/GabrielKenji28/Web-Calculator/backend/internal/contracttest"
)

// negativeZero is the operand several contract cases depend on. The Go literal
// -0 is a constant expression that evaluates to positive zero, so the sign has
// to be set explicitly.
var negativeZero = math.Copysign(0, -1)

func TestCalculate(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		operation string
		operands  []float64
		want      float64
		wantErr   error
	}{
		{name: "add", operation: "add", operands: []float64{10, 2}, want: 12},
		{name: "add negatives", operation: "add", operands: []float64{-10, -2}, want: -12},
		{name: "add decimals", operation: "add", operands: []float64{1.25, 2.5}, want: 3.75},
		{name: "add keeps binary64 error", operation: "add", operands: []float64{0.1, 0.2}, want: 0.30000000000000004},
		{name: "subtract", operation: "subtract", operands: []float64{10, 2}, want: 8},
		{name: "subtract to negative", operation: "subtract", operands: []float64{2, 10}, want: -8},
		{name: "multiply", operation: "multiply", operands: []float64{10, 2}, want: 20},
		{name: "multiply negative", operation: "multiply", operands: []float64{-6, 2}, want: -12},
		{name: "multiply zero", operation: "multiply", operands: []float64{0, 123}, want: 0},
		{name: "divide", operation: "divide", operands: []float64{10, 2}, want: 5},
		{name: "divide two negatives", operation: "divide", operands: []float64{-10, -2}, want: 5},
		{name: "divide repeating", operation: "divide", operands: []float64{1, 3}, want: 0.3333333333333333},

		{name: "divide by zero", operation: "divide", operands: []float64{10, 0}, wantErr: calc.ErrDivisionByZero},
		{name: "divide by negative zero", operation: "divide", operands: []float64{10, negativeZero}, wantErr: calc.ErrDivisionByZero},
		{name: "zero divided by zero", operation: "divide", operands: []float64{0, 0}, wantErr: calc.ErrDivisionByZero},

		{name: "addition overflow", operation: "add", operands: []float64{1e308, 1e308}, wantErr: calc.ErrNonFiniteResult},
		{name: "subtraction overflow", operation: "subtract", operands: []float64{-1e308, 1e308}, wantErr: calc.ErrNonFiniteResult},
		{name: "multiplication overflow", operation: "multiply", operands: []float64{1e308, 2}, wantErr: calc.ErrNonFiniteResult},
		{name: "division overflow", operation: "divide", operands: []float64{1e308, 1e-308}, wantErr: calc.ErrNonFiniteResult},

		{name: "power", operation: "power", operands: []float64{2, 3}, want: 8},
		{name: "power of zero to zero is one", operation: "power", operands: []float64{0, 0}, want: 1},
		{name: "power of negative zero to zero is one", operation: "power", operands: []float64{negativeZero, 0}, want: 1},
		{name: "power of a zero base", operation: "power", operands: []float64{0, 3}, want: 0},
		{name: "power with a negative exponent", operation: "power", operands: []float64{2, -3}, want: 0.125},
		{name: "power with a fractional exponent", operation: "power", operands: []float64{9, 0.5}, want: 3},
		{name: "power of a negative base to an odd exponent", operation: "power", operands: []float64{-2, 3}, want: -8},
		{name: "power of a negative base to an even exponent", operation: "power", operands: []float64{-2, 2}, want: 4},
		{name: "power of a negative base to a negative integer exponent", operation: "power", operands: []float64{-2, -3}, want: -0.125},
		{name: "power of a negative base to a whole-numbered float exponent", operation: "power", operands: []float64{-2, 3.0}, want: -8},

		{name: "power of zero to a negative exponent", operation: "power", operands: []float64{0, -1}, wantErr: calc.ErrInvalidPower},
		{name: "power of negative zero to a negative exponent", operation: "power", operands: []float64{negativeZero, -1}, wantErr: calc.ErrInvalidPower},
		{name: "power of a negative base to a fractional exponent", operation: "power", operands: []float64{-8, 0.3333333333333333}, wantErr: calc.ErrInvalidPower},
		{name: "power of a negative base just off an integer exponent", operation: "power", operands: []float64{-2, 3.0000000000000004}, wantErr: calc.ErrInvalidPower},
		{name: "power of a negative base to a half exponent", operation: "power", operands: []float64{-4, 0.5}, wantErr: calc.ErrInvalidPower},
		{name: "power overflow", operation: "power", operands: []float64{1e308, 2}, wantErr: calc.ErrNonFiniteResult},
		{name: "power of a negative base to a huge integer exponent overflows", operation: "power", operands: []float64{-2, 1e300}, wantErr: calc.ErrNonFiniteResult},

		{name: "square root", operation: "sqrt", operands: []float64{9}, want: 3},
		{name: "square root of zero", operation: "sqrt", operands: []float64{0}, want: 0},
		{name: "square root of negative zero", operation: "sqrt", operands: []float64{negativeZero}, want: 0},
		{name: "square root of two", operation: "sqrt", operands: []float64{2}, want: 1.4142135623730951},
		{name: "square root of a large finite number", operation: "sqrt", operands: []float64{1e308}, want: 1e154},

		{name: "square root of a negative number", operation: "sqrt", operands: []float64{-1}, wantErr: calc.ErrNegativeSqrt},
		{name: "square root of a tiny negative number", operation: "sqrt", operands: []float64{-5e-324}, wantErr: calc.ErrNegativeSqrt},

		{name: "percentage of a value", operation: "percentage", operands: []float64{15, 200}, want: 30},
		{name: "percentage of zero percent", operation: "percentage", operands: []float64{0, 200}, want: 0},
		{name: "percentage of a negative percentage", operation: "percentage", operands: []float64{-10, 200}, want: -20},
		{name: "percentage with a fractional percentage", operation: "percentage", operands: []float64{12.5, 80}, want: 10},
		{name: "percentage above one hundred", operation: "percentage", operands: []float64{200, 50}, want: 100},
		{name: "percentage divides before multiplying", operation: "percentage", operands: []float64{50, 1e308}, want: 5e307},
		{name: "percentage of a large negative base", operation: "percentage", operands: []float64{50, -1e308}, want: -5e307},

		{name: "percentage overflow", operation: "percentage", operands: []float64{1000, 1e308}, wantErr: calc.ErrNonFiniteResult},

		{name: "unknown operation", operation: "modulo", operands: []float64{10, 2}, wantErr: calc.ErrUnknownOperation},
		{name: "operation names are case sensitive", operation: "ADD", operands: []float64{10, 2}, wantErr: calc.ErrUnknownOperation},
		{name: "empty operation", operation: "", operands: []float64{10, 2}, wantErr: calc.ErrUnknownOperation},

		{name: "no operands", operation: "add", operands: nil, wantErr: calc.ErrInvalidOperandCount},
		{name: "too few operands", operation: "add", operands: []float64{1}, wantErr: calc.ErrInvalidOperandCount},
		{name: "too many operands", operation: "add", operands: []float64{1, 2, 3}, wantErr: calc.ErrInvalidOperandCount},
		{name: "square root takes exactly one operand", operation: "sqrt", operands: []float64{9, 4}, wantErr: calc.ErrInvalidOperandCount},
		{name: "square root of nothing", operation: "sqrt", operands: nil, wantErr: calc.ErrInvalidOperandCount},
		{name: "power without an exponent", operation: "power", operands: []float64{2}, wantErr: calc.ErrInvalidOperandCount},
		{name: "percentage without a base", operation: "percentage", operands: []float64{15}, wantErr: calc.ErrInvalidOperandCount},
	}

	service := calc.New()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, err := service.Calculate(context.Background(), tt.operation, tt.operands)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Calculate(%q, %v) error = %v, want %v", tt.operation, tt.operands, err, tt.wantErr)
			}
			if tt.wantErr != nil {
				return
			}
			if got != tt.want {
				t.Errorf("Calculate(%q, %v) = %v, want %v", tt.operation, tt.operands, got, tt.want)
			}
		})
	}
}

// TestSquareRootOfNegativeZeroKeepsItsSign documents the division of labour
// behind the sqrt-negative-zero fixture: IEEE 754 says sqrt(-0) is -0, so calc
// returns it unchanged and the HTTP layer normalises it for presentation.
func TestSquareRootOfNegativeZeroKeepsItsSign(t *testing.T) {
	t.Parallel()

	got, err := calc.New().Calculate(context.Background(), "sqrt", []float64{negativeZero})
	if err != nil {
		t.Fatalf("Calculate(sqrt, -0) error = %v", err)
	}
	if got != 0 || !math.Signbit(got) {
		t.Errorf("Calculate(sqrt, -0) = %v (signbit %v), want negative zero", got, math.Signbit(got))
	}
}

// TestCalculateNeverReturnsNonFiniteResults pins the invariant the HTTP layer
// depends on: a nil error means the value can be encoded as JSON. It sweeps
// every registered operation over extreme operands instead of naming the
// combinations, so an operation added later is covered without a new test.
func TestCalculateNeverReturnsNonFiniteResults(t *testing.T) {
	t.Parallel()

	extremes := []float64{
		0, negativeZero, 1, -1, 2, -2, 0.5, -0.5, 100, -100,
		1e-308, -1e-308, 1e308, -1e308,
		math.MaxFloat64, -math.MaxFloat64, math.SmallestNonzeroFloat64,
	}

	service := calc.New()
	for _, name := range service.Names() {
		for _, first := range extremes {
			for _, second := range extremes {
				for _, operands := range [][]float64{{first}, {first, second}} {
					got, err := service.Calculate(context.Background(), name, operands)
					if err != nil {
						continue
					}
					if math.IsInf(got, 0) || math.IsNaN(got) {
						t.Errorf("Calculate(%q, %v) = %v with nil error, want a finite result", name, operands, got)
					}
				}
			}
		}
	}
}

// TestRegisteredOperationsMatchContract keeps the registry and the shared
// contract in step in both directions: an operation the contract publishes but
// nobody registered, and one registered that the contract never described, both
// fail here.
func TestRegisteredOperationsMatchContract(t *testing.T) {
	t.Parallel()

	fixtures := contracttest.Load(t)
	want := slices.Concat(
		fixtures.OperationNamesForMilestone(contracttest.MilestoneCore),
		fixtures.OperationNamesForMilestone(contracttest.MilestoneAdvanced),
	)
	slices.Sort(want)
	if len(want) != len(fixtures.Operations) {
		t.Fatalf("contract operations by milestone = %d, want all %d; a milestone is unaccounted for", len(want), len(fixtures.Operations))
	}

	if got := calc.New().Names(); !slices.Equal(got, want) {
		t.Errorf("registered operations = %v, want the contract operations %v", got, want)
	}
}

// TestOperationArityMatchesContract checks each registered operation against the
// arity the contract publishes, without exposing the internals of the registry.
func TestOperationArityMatchesContract(t *testing.T) {
	t.Parallel()

	fixtures := contracttest.Load(t)
	service := calc.New()

	for _, name := range service.Names() {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			arity := fixtures.OperationByName(t, name).Arity
			if _, err := service.Calculate(context.Background(), name, onesSlice(arity)); errors.Is(err, calc.ErrInvalidOperandCount) {
				t.Errorf("Calculate(%q) with %d operands = %v, want the contract arity to be accepted", name, arity, err)
			}
			for _, count := range []int{arity - 1, arity + 1} {
				if count < 0 {
					continue
				}
				if _, err := service.Calculate(context.Background(), name, onesSlice(count)); !errors.Is(err, calc.ErrInvalidOperandCount) {
					t.Errorf("Calculate(%q) with %d operands error = %v, want %v", name, count, err, calc.ErrInvalidOperandCount)
				}
			}
		})
	}
}

// onesSlice returns count operands of value one, which every operation accepts
// without an arithmetic error.
func onesSlice(count int) []float64 {
	operands := make([]float64, count)
	for i := range operands {
		operands[i] = 1
	}
	return operands
}

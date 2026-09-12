// Package calc evaluates calculator operations, independent of any transport.
package calc

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"math"
	"slices"
)

var (
	ErrUnknownOperation    = errors.New("unknown operation")
	ErrInvalidOperandCount = errors.New("invalid operand count")
	ErrDivisionByZero      = errors.New("division by zero")
	ErrNegativeSqrt        = errors.New("square root of a negative number")
	ErrInvalidPower        = errors.New("invalid power operands")
	ErrNonFiniteResult     = errors.New("non-finite result")
)

type Operation struct {
	Name  string
	Arity int
	apply func(operands []float64) (float64, error)
}

type Service struct {
	ops map[string]Operation
}

func New() *Service {
	return newService(slices.Concat(coreOperations(), advancedOperations()))
}

func newService(ops []Operation) *Service {
	byName := make(map[string]Operation, len(ops))
	for _, op := range ops {
		byName[op.Name] = op
	}
	return &Service{ops: byName}
}

func coreOperations() []Operation {
	return []Operation{
		{Name: "add", Arity: 2, apply: func(o []float64) (float64, error) { return o[0] + o[1], nil }},
		{Name: "subtract", Arity: 2, apply: func(o []float64) (float64, error) { return o[0] - o[1], nil }},
		{Name: "multiply", Arity: 2, apply: func(o []float64) (float64, error) { return o[0] * o[1], nil }},
		{Name: "divide", Arity: 2, apply: divide},
	}
}

func advancedOperations() []Operation {
	return []Operation{
		{Name: "power", Arity: 2, apply: power},
		{Name: "sqrt", Arity: 1, apply: squareRoot},
		{Name: "percentage", Arity: 2, apply: percentageOf},
	}
}

func divide(o []float64) (float64, error) {
	if o[1] == 0 {
		return 0, ErrDivisionByZero
	}
	return o[0] / o[1], nil
}

func power(o []float64) (float64, error) {
	base, exponent := o[0], o[1]
	// 0^negative and a negative base with a fractional exponent have no real
	// result; everything else, including 0^0 = 1, is left to math.Pow.
	if base == 0 && exponent < 0 {
		return 0, ErrInvalidPower
	}
	if base < 0 && exponent != math.Trunc(exponent) {
		return 0, ErrInvalidPower
	}
	return math.Pow(base, exponent), nil
}

func squareRoot(o []float64) (float64, error) {
	if o[0] < 0 {
		return 0, ErrNegativeSqrt
	}
	return math.Sqrt(o[0]), nil
}

func percentageOf(o []float64) (float64, error) {
	percentage, base := o[0], o[1]
	// Dividing before multiplying avoids overflow on a large base.
	return (percentage / 100) * base, nil
}

func (s *Service) Names() []string {
	return slices.Sorted(maps.Keys(s.ops))
}

func (s *Service) Calculate(ctx context.Context, operation string, operands []float64) (float64, error) {
	_ = ctx

	op, ok := s.ops[operation]
	if !ok {
		return 0, ErrUnknownOperation
	}
	if len(operands) != op.Arity {
		return 0, fmt.Errorf("%s wants %d operands, got %d: %w", op.Name, op.Arity, len(operands), ErrInvalidOperandCount)
	}
	result, err := op.apply(operands)
	if err != nil {
		return 0, err
	}
	if math.IsInf(result, 0) || math.IsNaN(result) {
		return 0, ErrNonFiniteResult
	}
	return result, nil
}

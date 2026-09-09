// Package calc evaluates calculator operations.
//
// It is deliberately free of transport concerns: it imports no net/http, takes
// operands that the caller has already decoded into finite float64 values, and
// reports every failure as a sentinel error that the caller maps to a response.
package calc

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"math"
	"slices"
)

// Sentinel errors returned by [Service.Calculate]. Callers compare with
// errors.Is; the strings are for logs, never for end users.
var (
	// ErrUnknownOperation reports an operation name that is not registered.
	ErrUnknownOperation = errors.New("unknown operation")
	// ErrInvalidOperandCount reports an operand count that does not match the
	// operation's arity.
	ErrInvalidOperandCount = errors.New("invalid operand count")
	// ErrDivisionByZero reports a division whose divisor is zero.
	ErrDivisionByZero = errors.New("division by zero")
	// ErrNegativeSqrt reports a square root of a negative number.
	ErrNegativeSqrt = errors.New("square root of a negative number")
	// ErrInvalidPower reports an exponentiation that has no real result.
	ErrInvalidPower = errors.New("invalid power operands")
	// ErrNonFiniteResult reports a calculation that overflowed the finite
	// binary64 range or produced NaN.
	ErrNonFiniteResult = errors.New("non-finite result")
)

// Operation is a single registered calculation.
type Operation struct {
	// Name is the wire name of the operation. Lookups are case-sensitive.
	Name string
	// Arity is the exact number of operands the operation requires.
	Arity int
	// apply computes the result. It is called only with exactly Arity operands,
	// each of them finite, so implementations may index without bounds checks.
	apply func(operands []float64) (float64, error)
}

// Service is an immutable registry of operations. The zero value is not
// usable; construct one with [New].
type Service struct {
	ops map[string]Operation
}

// New returns a Service with every operation of the contract registered.
//
// Registering an operation is one entry in [coreOperations] or
// [advancedOperations]; neither the handler, the error mapping, nor Calculate
// itself has to know that the set grew.
func New() *Service {
	return newService(slices.Concat(coreOperations(), advancedOperations()))
}

// newService indexes operations by name.
func newService(ops []Operation) *Service {
	byName := make(map[string]Operation, len(ops))
	for _, op := range ops {
		byName[op.Name] = op
	}
	return &Service{ops: byName}
}

// coreOperations returns the four core arithmetic operations.
func coreOperations() []Operation {
	return []Operation{
		{Name: "add", Arity: 2, apply: func(o []float64) (float64, error) { return o[0] + o[1], nil }},
		{Name: "subtract", Arity: 2, apply: func(o []float64) (float64, error) { return o[0] - o[1], nil }},
		{Name: "multiply", Arity: 2, apply: func(o []float64) (float64, error) { return o[0] * o[1], nil }},
		{Name: "divide", Arity: 2, apply: divide},
	}
}

// advancedOperations returns the operations added after the core milestone.
func advancedOperations() []Operation {
	return []Operation{
		{Name: "power", Arity: 2, apply: power},
		{Name: "sqrt", Arity: 1, apply: squareRoot},
		{Name: "percentage", Arity: 2, apply: percentageOf},
	}
}

// divide reports ErrDivisionByZero for any zero divisor, including negative
// zero, which compares equal to zero.
func divide(o []float64) (float64, error) {
	if o[1] == 0 {
		return 0, ErrDivisionByZero
	}
	return o[0] / o[1], nil
}

// power raises a base to an exponent.
//
// Two cases have no real result and are rejected rather than returned as
// infinity or NaN: a zero base with a negative exponent, which is a division by
// zero in disguise, and a negative base with a non-integer exponent, which is a
// root of a negative number. Everything else is left to math.Pow, including
// 0^0, which is 1 by the contract and by IEEE 754.
func power(o []float64) (float64, error) {
	base, exponent := o[0], o[1]
	// Negative zero compares equal to zero, so it is covered here too.
	if base == 0 && exponent < 0 {
		return 0, ErrInvalidPower
	}
	if base < 0 && exponent != math.Trunc(exponent) {
		return 0, ErrInvalidPower
	}
	return math.Pow(base, exponent), nil
}

// squareRoot returns the principal square root.
//
// Negative zero is not negative, so sqrt(-0) is allowed and yields -0 as IEEE
// 754 requires. Presenting that as 0 is the transport layer's job.
func squareRoot(o []float64) (float64, error) {
	if o[0] < 0 {
		return 0, ErrNegativeSqrt
	}
	return math.Sqrt(o[0]), nil
}

// percentageOf returns percentage percent of base, the "X% of Y" reading of the
// contract's formula.
//
// The division comes first on purpose: scaling the percentage down before
// multiplying keeps 50% of 1e308 inside the finite range, where multiplying
// first would overflow and lose a result the contract expects.
func percentageOf(o []float64) (float64, error) {
	percentage, base := o[0], o[1]
	return (percentage / 100) * base, nil
}

// Names returns the registered operation names in sorted order.
func (s *Service) Names() []string {
	return slices.Sorted(maps.Keys(s.ops))
}

// Calculate applies the named operation to operands.
//
// It returns ErrUnknownOperation for an unregistered name, ErrInvalidOperandCount
// when the operand count does not match the operation's arity, the operation's
// own error for an impossible calculation, and ErrNonFiniteResult when the
// result leaves the finite binary64 range. The returned value is always finite
// when err is nil.
//
// ctx is accepted so that handlers can thread request scope through the whole
// call chain; no current operation observes cancellation.
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

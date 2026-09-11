import type { CalculationFailure } from '../hooks/useCalculator';
import { ErrorMessage } from './ErrorMessage';

// The live region is never keyed or unmounted — one that remounts stops announcing.

interface DisplayProps {
  readonly expression: string;
  readonly exactNote: string | null;
  readonly value: string;
  readonly failure: CalculationFailure | null;
  readonly busy: boolean;
}

function valueSizeClass(value: string): string {
  if (value.length > 9) return ' display__value--sm';
  if (value.length > 6) return ' display__value--md';
  return '';
}

export function Display({
  expression,
  exactNote,
  value,
  failure,
  busy,
}: DisplayProps): React.JSX.Element {
  const upperLine = failure !== null ? '' : (exactNote ?? expression);

  return (
    <section className="display">
      <h2 className="visually-hidden" id="display-heading">
        Calculator display
      </h2>
      <div
        className="display__live"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-labelledby="display-heading"
        aria-busy={busy}
      >
        <p
          className={
            'display__expression' + (exactNote === null ? '' : ' display__expression--note')
          }
        >
          {upperLine}
        </p>
        {failure === null ? (
          <p
            className={
              'display__value' + valueSizeClass(value) + (busy ? ' display__value--busy' : '')
            }
          >
            {value}
          </p>
        ) : (
          <ErrorMessage failure={failure} />
        )}
      </div>
    </section>
  );
}

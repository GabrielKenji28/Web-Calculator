import type { CalculationFailure } from '../hooks/useCalculator';
import { ErrorMessage } from './ErrorMessage';

/**
 * The two-line display: a muted expression line above a large value line.
 *
 * The live region is never keyed or unmounted — one that remounts stops
 * announcing. `aria-atomic` makes the expression and value read as one message
 * rather than a diff, and `aria-labelledby` gives the region an accessible name.
 * `aria-busy` covers loading, since the design dims the value line instead of
 * showing a spinner and a screen reader cannot perceive dimming.
 *
 * The value's font size steps down with length: the column is a fixed 352px with
 * no wrapping budget, so a long answer shrinks rather than reflowing the keypad.
 */

interface DisplayProps {
  /** The pending operation, e.g. `12 ×`. Empty when nothing is armed. */
  readonly expression: string;
  /**
   * Replaces the expression line after a rounded result, to disclose the exact
   * binary64 value the display had to round.
   */
  readonly exactNote: string | null;
  readonly value: string;
  readonly failure: CalculationFailure | null;
  readonly busy: boolean;
}

/** 66px / 54px / 42px, keyed on length exactly as the design specifies. */
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
  // The expression line is empty while an error is shown, per the design.
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

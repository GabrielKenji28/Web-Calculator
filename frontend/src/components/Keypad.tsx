import { useEffect, useRef, type KeyboardEvent } from 'react';
import { isArmable, KEYPAD_KEYS, type CalculatorKey } from '../keypad/keys';
import { Key } from './Key';

/**
 * The 4-column grid, generated from the key table.
 *
 * The grid hosts the keyboard handler: a named `role="group"`, focusable
 * programmatically so typing works the moment the page loads, with every key
 * inside it so a keypress bubbles here wherever focus sits.
 *
 * Which keys are live is not this component's judgement — it asks `isDisabled`.
 */

interface KeypadProps {
  /** Whether a given key refuses to act right now. */
  readonly isDisabled: (key: CalculatorKey) => boolean;
  /** Id of the armed operator key, or null. */
  readonly armedKeyId: string | null;
  /** Glyph for the clear key: `AC` when pristine, `C` once there is something to clear. */
  readonly clearGlyph: string;
  readonly onPress: (key: CalculatorKey) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export function Keypad({
  isDisabled,
  armedKeyId,
  clearGlyph,
  onPress,
  onKeyDown,
}: KeypadProps): React.JSX.Element {
  const gridRef = useRef<HTMLDivElement>(null);

  // Focus the group once on mount so the physical keyboard works without the
  // user having to click or tab into the calculator first. Tab still moves from
  // here to the first key, so nothing is skipped.
  useEffect(() => {
    gridRef.current?.focus();
  }, []);

  return (
    <div
      className="keypad"
      role="group"
      aria-label="Calculator keypad"
      tabIndex={-1}
      ref={gridRef}
      onKeyDown={onKeyDown}
    >
      {KEYPAD_KEYS.map((key) => (
        <Key
          key={key.id}
          glyph={key.kind === 'clear' ? clearGlyph : key.glyph}
          ariaLabel={key.ariaLabel}
          variant={key.variant}
          span={key.span}
          align={key.align}
          pressed={
            key.kind === 'operation' && isArmable(key) ? key.id === armedKeyId : undefined
          }
          disabled={isDisabled(key)}
          onPress={() => {
            onPress(key);
          }}
        />
      ))}
    </div>
  );
}

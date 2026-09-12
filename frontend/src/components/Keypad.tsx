import { useEffect, useRef, type KeyboardEvent } from 'react';
import { isArmable, KEYPAD_KEYS, type CalculatorKey } from '../keypad/keys';
import { Key } from './Key';

interface KeypadProps {
  readonly isDisabled: (key: CalculatorKey) => boolean;
  readonly armedKeyId: string | null;
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

  // Focus the group on mount so physical-keyboard entry works without a click.
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

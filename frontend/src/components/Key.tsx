import type { KeyVariant } from '../keypad/keys';

/**
 * One key. A real `<button>`, always.
 *
 * Symbol glyphs carry an `aria-label` so `÷` is announced as "Divide"; digits
 * pass null because the glyph already reads correctly. `aria-pressed` is set
 * only on keys that can be armed, so it means "waiting for its second operand"
 * and nothing else — the immediate-fire keys are not toggles.
 */

interface KeyProps {
  readonly glyph: string;
  readonly ariaLabel: string | null;
  readonly variant: KeyVariant;
  readonly span: 1 | 2;
  readonly align: 'center' | 'start';
  /** `undefined` for keys that are not toggles. */
  readonly pressed: boolean | undefined;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

export function Key({
  glyph,
  ariaLabel,
  variant,
  span,
  align,
  pressed,
  disabled,
  onPress,
}: KeyProps): React.JSX.Element {
  const className = [
    'key',
    'key--' + variant,
    span === 2 ? 'key--wide' : null,
    align === 'start' ? 'key--start' : null,
    pressed === true ? 'key--armed' : null,
  ]
    .filter((entry): entry is string => entry !== null)
    .join(' ');

  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel ?? undefined}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onPress}
    >
      {glyph}
    </button>
  );
}

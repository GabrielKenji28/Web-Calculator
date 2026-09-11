import type { KeyVariant } from '../keypad/keys';

interface KeyProps {
  readonly glyph: string;
  readonly ariaLabel: string | null;
  readonly variant: KeyVariant;
  readonly span: 1 | 2;
  readonly align: 'center' | 'start';
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

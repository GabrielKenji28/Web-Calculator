import { errorCopyFor } from '../format/errorCopy';
import type { CalculationFailure } from '../hooks/useCalculator';

/**
 * The single line that renders every failure, 400 and 500 alike.
 *
 * The old panel spelled out a heading, the server's message, a note and
 * `HTTP 400 · CODE`. The keypad display has room for one line, so the code now
 * *chooses* the line instead of being printed beside it (see `format/errorCopy`),
 * and the 400/500/preview distinction it used to carry in prose is kept two ways:
 * in the copy itself — a 500 says the fault is ours and a 400 says what to fix —
 * and in a tone modifier, so the three cases stay distinguishable in the DOM.
 */

interface ErrorMessageProps {
  readonly failure: CalculationFailure;
}

export type ErrorTone = 'user' | 'server' | 'preview';

export interface ErrorPresentation {
  readonly line: string;
  readonly tone: ErrorTone;
}

export function presentationFor(failure: CalculationFailure): ErrorPresentation {
  switch (failure.kind) {
    case 'api': {
      const isServerFault = failure.status >= 500 || failure.code === 'INTERNAL_ERROR';
      return {
        line: errorCopyFor(failure.code, failure.message),
        tone: isServerFault ? 'server' : 'user',
      };
    }
    case 'transport':
      // Not a contract code at all: the client already words these for a reader,
      // and its text carries the underlying cause, which is worth keeping.
      return { line: failure.message, tone: 'server' };
    case 'previewGap':
      return { line: failure.message, tone: 'preview' };
  }
}

export function ErrorMessage({ failure }: ErrorMessageProps): React.JSX.Element {
  const { line, tone } = presentationFor(failure);
  return <p className={'display__error display__error--' + tone}>{line}</p>;
}

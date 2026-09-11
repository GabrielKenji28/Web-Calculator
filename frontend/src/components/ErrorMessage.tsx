import { errorCopyFor } from '../format/errorCopy';
import type { CalculationFailure } from '../hooks/useCalculator';

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
      return { line: failure.message, tone: 'server' };
    case 'previewGap':
      return { line: failure.message, tone: 'preview' };
  }
}

export function ErrorMessage({ failure }: ErrorMessageProps): React.JSX.Element {
  const { line, tone } = presentationFor(failure);
  return <p className={'display__error display__error--' + tone}>{line}</p>;
}

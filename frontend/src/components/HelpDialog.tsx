import { useEffect, useRef } from 'react';
import { helpFailures, helpRows } from '../help/examples';

const ROWS = helpRows();
const FAILURES = helpFailures();

interface HelpDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function HelpDialog({ open, onClose }: HelpDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (open) {
      if (!dialog.open) {
        const active = document.activeElement;
        returnFocusRef.current = active instanceof HTMLElement ? active : null;
        dialog.showModal();
      }
      return;
    }

    if (dialog.open) dialog.close();
    returnFocusRef.current?.focus();
    returnFocusRef.current = null;
  }, [open]);

  return (
    <dialog
      className="help"
      ref={dialogRef}
      aria-labelledby="help-title"
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="help__panel">
        <div className="help__header">
          <h2 className="help__title" id="help-title">
            How the keys work
          </h2>
          <button type="button" className="help__close" onClick={onClose}>
            Close
          </button>
        </div>

        <dl className="help__rows">
          {ROWS.map((row) => (
            <div className="help__row" key={row.keyId}>
              <dt className="help__term">
                <span className="help__glyph">{row.glyph}</span>
                <span className="help__label">{row.label}</span>
              </dt>
              <dd className="help__detail">
                <code className="help__example">{row.example}</code>
                <span className="help__operands">{row.operandLabels.join(' · ')}</span>
              </dd>
            </div>
          ))}
        </dl>

        <h3 className="help__subtitle">When it will not compute</h3>
        <ul className="help__failures">
          {FAILURES.map((failure) => (
            <li className="help__failure" key={failure.code}>
              <code className="help__example">{failure.example}</code>
              <span className="help__copy">{failure.copy}</span>
            </li>
          ))}
        </ul>

        <p className="help__note">
          Every example above is taken from the frozen API contract, not written by hand.
        </p>
      </div>
    </dialog>
  );
}

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { createPreviewClient } from '../test/previewClient';
import { HelpDialog } from '../components/HelpDialog';
import { helpFailures, helpRows } from '../help/examples';
import {
  caseById,
  errorEnvelopeOf,
  operationsFor,
  parseCalculateBody,
  successResultOf,
} from '../contract/fixtures';
import { ERROR_COPY } from '../format/errorCopy';
import { formatResult } from '../format/display';
import { arityOf, MINUS, operationKeys } from '../keypad/keys';

const rows = helpRows();
const failures = helpFailures();

function renderApp(): void {
  render(<App client={createPreviewClient()} />);
}

const openHelp = async (): Promise<HTMLElement> => {
  const user = userEvent.setup();
  const trigger = screen.getByRole('button', { name: 'Help' });
  await user.click(trigger);
  return trigger;
};

describe('help content derived from the contract', () => {
  it('resolves a row for every operation key, in keypad order', () => {
    expect(rows.map((row) => row.keyId)).toEqual(operationKeys().map((key) => key.id));
  });

  it('covers all seven contract operations', () => {
    const covered = new Set(
      rows.map((row) => {
        const call = parseCalculateBody(caseById(row.caseId).request.body);
        if (call === undefined) throw new Error('row ' + row.keyId + ' cites a non-calculate case');
        return call.operation;
      }),
    );

    for (const spec of operationsFor()) {
      expect(covered, spec.name).toContain(spec.name);
    }
    expect(operationsFor()).toHaveLength(7);
  });

  it('cites a real preview fixture whose result the example repeats', () => {
    for (const row of rows) {
      const entry = caseById(row.caseId);
      expect(entry.preview, row.caseId).toBe(true);
      expect(entry.testFault, row.caseId).toBeUndefined();
      expect(entry.expected.status, row.caseId).toBe(200);

      const result = successResultOf(entry);
      expect(result, row.caseId).toBeDefined();
      expect(row.example, row.caseId).toContain('= ' + formatResult(result ?? Number.NaN));
    }
  });

  it('gives every example the operands its own fixture sends', () => {
    for (const row of rows) {
      const call = parseCalculateBody(caseById(row.caseId).request.body);
      if (call === undefined) throw new Error('row ' + row.keyId + ' cites a non-calculate case');

      const key = operationKeys().find((entry) => entry.id === row.keyId);
      expect(key, row.keyId).toBeDefined();
      expect(call.operands, row.caseId).toHaveLength(arityOf(call.operation));
      expect(row.operandLabels.length).toBe(call.operands.length - (key?.fixedOperands.length ?? 0));
    }
  });

  it('picks a genuine exponent of 2 for the x² key', () => {
    const square = rows.find((row) => row.keyId === 'square');
    expect(square).toBeDefined();

    const call = parseCalculateBody(caseById(square?.caseId ?? '').request.body);
    expect(call?.operation).toBe('power');
    expect(call?.operands[1]).toBe(2);
    expect(square?.example).toBe('(' + MINUS + '2)² = 4');
  });

  it('writes unary examples around the operand and binary examples between', () => {
    expect(rows.find((row) => row.keyId === 'sqrt')?.example).toBe('√9 = 3');
    expect(rows.find((row) => row.keyId === 'add')?.example).toBe('10 + 2 = 12');
  });

  it('spells out the percentage semantics the README documents', () => {
    const percentage = rows.find((row) => row.keyId === 'percentage');
    expect(percentage?.example).toBe('15 % of 200 = 30');
    expect(percentage?.operandLabels).toEqual(['Percentage', 'Of value']);
  });

  it('lists only the failures a key can actually produce', () => {
    expect(failures.map((failure) => failure.code).sort()).toEqual([
      'DIVISION_BY_ZERO',
      'INVALID_POWER',
      'NEGATIVE_SQRT',
      'NON_FINITE_RESULT',
    ]);
  });

  it('quotes the same copy the display shows, from a real error fixture', () => {
    for (const failure of failures) {
      const entry = caseById(failure.caseId);
      expect(errorEnvelopeOf(entry)?.code, failure.caseId).toBe(failure.code);
      expect(failure.copy).toBe(ERROR_COPY[failure.code as keyof typeof ERROR_COPY]);
    }

    expect(failures.find((failure) => failure.code === 'DIVISION_BY_ZERO')?.example).toBe('10 ÷ 0');
    expect(failures.find((failure) => failure.code === 'NEGATIVE_SQRT')?.example).toBe(
      '√(' + MINUS + '1)',
    );
  });

  it('refuses to render a keypad the contract cannot illustrate', () => {
    expect(() => helpRows([])).toThrow(/no preview example for keypad key/);
    expect(() => helpFailures([])).toThrow(/no reachable preview error cases/);
  });
});

describe('help dialog', () => {
  it('stays closed until the Help button is pressed', () => {
    renderApp();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens as a modal listing every key and failure', async () => {
    renderApp();
    await openHelp();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('How the keys work');

    for (const row of rows) {
      expect(dialog).toHaveTextContent(row.example);
      expect(dialog).toHaveTextContent(row.label);
    }
    for (const failure of failures) {
      expect(dialog).toHaveTextContent(failure.copy);
    }
  });

  it('closes on the close button and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderApp();
    const trigger = await openHelp();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes when the browser cancels it, as Escape does', async () => {
    renderApp();
    await openHelp();

    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('help dialog open and close guards', () => {
  it('opens once and closes once, however often it is re-rendered', () => {
    const onClose = vi.fn();
    const { rerender } = render(<HelpDialog open={false} onClose={onClose} />);
    const dialog = (): HTMLDialogElement => {
      const found = document.querySelector('dialog');
      if (found === null) throw new Error('no dialog rendered');
      return found;
    };

    expect(dialog().open).toBe(false);

    rerender(<HelpDialog open onClose={onClose} />);
    expect(dialog().open).toBe(true);

    rerender(<HelpDialog open onClose={onClose} />);
    expect(dialog().open).toBe(true);

    rerender(<HelpDialog open={false} onClose={onClose} />);
    expect(dialog().open).toBe(false);

    onClose.mockClear();
    rerender(<HelpDialog open={false} onClose={onClose} />);
    expect(dialog().open).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  // The browser can open or close a <dialog> without telling React — Escape and
  // the close event both do. The effect must not then call showModal on an open
  // dialog, which throws InvalidStateError.
  it('tolerates the DOM and the prop disagreeing in either direction', () => {
    const onClose = vi.fn();
    const { rerender } = render(<HelpDialog open={false} onClose={onClose} />);
    const dialog = (): HTMLDialogElement => {
      const found = document.querySelector('dialog');
      if (found === null) throw new Error('no dialog rendered');
      return found;
    };

    dialog().showModal();
    expect(() => {
      rerender(<HelpDialog open onClose={onClose} />);
    }).not.toThrow();
    expect(dialog().open).toBe(true);

    dialog().close();
    expect(() => {
      rerender(<HelpDialog open={false} onClose={onClose} />);
    }).not.toThrow();
    expect(dialog().open).toBe(false);
  });
});

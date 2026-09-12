import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom 30 ships HTMLDialogElement as an empty class: `open` reflects, but
// showModal/show/close do not exist at all, so calling one throws rather than
// no-opping. Supply the minimum the dialog needs; the guards make this vanish
// the day jsdom implements them. Esc is still the browser's job, so tests that
// need it dispatch `cancel` themselves.
const dialog = globalThis.HTMLDialogElement?.prototype;

if (dialog !== undefined && typeof dialog.showModal !== 'function') {
  dialog.showModal = function showModal(this: HTMLDialogElement): void {
    this.open = true;
  };
}

if (dialog !== undefined && typeof dialog.show !== 'function') {
  dialog.show = function show(this: HTMLDialogElement): void {
    this.open = true;
  };
}

if (dialog !== undefined && typeof dialog.close !== 'function') {
  dialog.close = function close(this: HTMLDialogElement, returnValue?: string): void {
    if (!this.open) return;
    this.open = false;
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.dispatchEvent(new Event('close'));
  };
}

afterEach(() => {
  cleanup();
});

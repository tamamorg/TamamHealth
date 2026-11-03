/**
 * The whole loop in a real popup: typing makes a sealed draft and makes a
 * refresh ask; a refresh or a dismissal brings the text back with a notice;
 * saving (closing without dismissing) clears it. Secrets are never kept.
 */
jest.mock('@/lib/context', () => ({
  useOptionalAuth: () => ({ currentUser: { _id: 'u1', orgId: 'org-a' } }),
}));
jest.mock('@/lib/org-data-cipher', () => ({
  encryptForOrg: async (plain: string) => `SEALED:${Buffer.from(plain).toString('base64')}`,
  decryptForOrg: async (value: string) => Buffer.from(value.slice(7), 'base64').toString(),
  isOrgEncrypted: (value: string) => value.startsWith('SEALED:'),
}));

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Modal from '@/components/Modal';
import { ToastProvider } from '@/components/Toast';
import { __resetUnsavedRegistryForTests } from '@/lib/unsaved/unsaved-registry';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const notes = () => document.querySelector('output')?.textContent ?? '';

function VitalsForm({ onSave }: { onSave: () => void }) {
  const [value, setValue] = useState('');
  return (
    <>
      <h2 id="vitals-title">Record vitals</h2>
      <output>{value}</output>
      <textarea aria-label="Notes" value={value} onChange={e => setValue(e.target.value)} />
      <input type="password" aria-label="Password" defaultValue="" />
      <button type="button" onClick={onSave}>Save</button>
    </>
  );
}

function Page({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ToastProvider>
      {open && (
        <Modal variant="slider" labelledBy="vitals-title" onClose={onClose}>
          <VitalsForm onSave={onClose} />
        </Modal>
      )}
    </ToastProvider>
  );
}

const wait = (ms: number) => act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
const drafts = () => Object.keys(localStorage).filter(k => k.startsWith('tamam.draft.v1.'));
const textarea = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Notes"]')!;

function type(el: HTMLTextAreaElement | HTMLInputElement, text: string) {
  act(() => {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function open() {
  act(() => root.render(<Page open onClose={() => act(() => root.render(<Page open={false} onClose={() => {}} />))} />));
  await wait(20);
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  __resetUnsavedRegistryForTests();
});

it('keeps typed text sealed, asks before a refresh, and gives it back after one', async () => {
  await open();
  type(textarea(), 'Fever for two days');
  type(document.querySelector<HTMLInputElement>('input[type="password"]')!, 'hunter2');
  await wait(600);

  const [key] = drafts();
  expect(key).toBeDefined();
  expect(localStorage.getItem(key)).not.toContain('Fever');
  const sealed = JSON.parse(localStorage.getItem(key)!).sealed as string;
  expect(Buffer.from(sealed.slice(7), 'base64').toString()).not.toContain('hunter2');

  const refresh = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(refresh);
  expect(refresh.defaultPrevented).toBe(true);

  // A refresh: the page goes without running any cleanup. Simulated by
  // keeping the stored draft through an unmount and mounting afresh.
  const stored = localStorage.getItem(key)!;
  act(() => root.unmount());
  await wait(10);
  localStorage.setItem(key, stored);
  root = createRoot(container);
  await open();
  await wait(400);

  expect(textarea().value).toBe('Fever for two days');
  expect(notes()).toBe('Fever for two days');
  expect(document.body.textContent).toContain('Unsaved text restored');
});

it('keeps the text when the popup is dismissed, and clears it when the form saves', async () => {
  await open();
  type(textarea(), 'Cough at night');
  await wait(50);
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  await wait(50);
  expect(drafts()).toHaveLength(1);

  await open();
  await wait(400);
  expect(textarea().value).toBe('Cough at night');

  act(() => { document.querySelector<HTMLButtonElement>('button:not([aria-label])')!.click(); });
  await wait(50);
  expect(drafts()).toHaveLength(0);
});

it('Discard puts the form back as it was and forgets the draft', async () => {
  await open();
  type(textarea(), 'Wrong patient');
  await wait(50);
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  await wait(50);
  await open();
  await wait(400);
  expect(textarea().value).toBe('Wrong patient');

  const discard = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Discard')!;
  act(() => discard.click());
  expect(textarea().value).toBe('');
  expect(drafts()).toHaveLength(0);
});

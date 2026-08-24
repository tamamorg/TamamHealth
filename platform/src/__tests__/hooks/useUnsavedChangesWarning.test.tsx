import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import Link from 'next/link';
import { useUnsavedChangesWarning } from '@/lib/hooks/useUnsavedChangesWarning';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ dirty }: { dirty: boolean }) {
  useUnsavedChangesWarning(dirty);
  return <Link href="/patients/next">Next patient</Link>;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.restoreAllMocks();
});

it('blocks reload while a clinical edit is pending', () => {
  act(() => root.render(<Harness dirty />));
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});

it('cancels in-app link navigation when the clinician declines', () => {
  jest.spyOn(window, 'confirm').mockReturnValue(false);
  act(() => root.render(<Harness dirty />));
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  container.querySelector('a')!.dispatchEvent(event);
  expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(event.defaultPrevented).toBe(true);
});

it('does not interfere after the edit is saved', () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  act(() => root.render(<Harness dirty={false} />));
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(confirm).not.toHaveBeenCalled();
});

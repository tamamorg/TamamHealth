/**
 * The shared confirm on the dialog kit, including typed confirmation, and the
 * toast's four tones.
 */
import { act } from 'react';
import { mount, setValue } from '../clinical-notes/test-utils';
import { ConfirmProvider, useConfirm } from '@/components/ConfirmDialog';
import { ToastProvider, useToast } from '@/components/Toast';

jest.mock('@/lib/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => { document.body.innerHTML = ''; });

function Asker({ onResult, typeToConfirm }: { onResult: (ok: boolean) => void; typeToConfirm?: string }) {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={() => { void confirm({ title: 'Delete Mary?', message: 'Gone for good.', tone: 'danger', typeToConfirm }).then(onResult); }}
    >
      ask
    </button>
  );
}

describe('ConfirmDialog on the kit', () => {
  it('renders a danger-toned kit dialog, focuses Cancel, and resolves', async () => {
    const onResult = jest.fn();
    const { container, unmount } = mount(<ConfirmProvider><Asker onResult={onResult} /></ConfirmProvider>);
    act(() => container.querySelector('button')!.click());
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-labelledby')).toBe('confirm-dialog-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('confirm-dialog-desc');
    expect(dialog.querySelector('.tm-dialog__head--danger')).not.toBeNull();
    expect(dialog.querySelector('.btn-danger-solid')?.textContent).toBe('action.confirm');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect((document.activeElement as HTMLElement).textContent).toBe('common.cancel');
    act(() => dialog.querySelector<HTMLButtonElement>('.btn-danger-solid')!.click());
    await act(async () => { await Promise.resolve(); });
    expect(onResult).toHaveBeenCalledWith(true);
    unmount();
  });

  it('keeps the action disabled until the record name is typed', async () => {
    const onResult = jest.fn();
    const { container, unmount } = mount(<ConfirmProvider><Asker onResult={onResult} typeToConfirm="Mary" /></ConfirmProvider>);
    act(() => container.querySelector('button')!.click());
    const dialog = document.body.querySelector('[role="dialog"]')!;
    const action = dialog.querySelector<HTMLButtonElement>('.btn-danger-solid')!;
    expect(action.disabled).toBe(true);
    const field = dialog.querySelector<HTMLInputElement>('#confirm-dialog-typed')!;
    setValue(field, 'mar');
    expect(action.disabled).toBe(true);
    setValue(field, ' mary ');
    expect(action.disabled).toBe(false);
    unmount();
  });
});

function Toaster() {
  const { showToast } = useToast();
  return (
    <>
      <button type="button" data-k="info" onClick={() => showToast('Saved offline')}>i</button>
      <button type="button" data-k="warn" onClick={() => showToast('Sync is behind', 'warning', { title: 'Heads up', durationMs: 10000 })}>w</button>
    </>
  );
}

describe('Toast tones', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('defaults to a polite info toast and makes warning an alert with a title', () => {
    const { container, unmount } = mount(<ToastProvider><Toaster /></ToastProvider>);
    act(() => container.querySelector<HTMLButtonElement>('[data-k="info"]')!.click());
    act(() => container.querySelector<HTMLButtonElement>('[data-k="warn"]')!.click());
    const toasts = Array.from(container.querySelectorAll('.ehr-toast'));
    expect(toasts[0].className).toContain('ehr-toast--info');
    expect(toasts[0].getAttribute('role')).toBe('status');
    expect(toasts[1].className).toContain('ehr-toast--warning');
    expect(toasts[1].getAttribute('role')).toBe('alert');
    expect(toasts[1].querySelector('.ehr-toast-title')?.textContent).toBe('Heads up');

    act(() => { jest.advanceTimersByTime(4000); });
    expect(toasts[0].className).toContain('is-leaving');   // leaves, then goes
    act(() => { jest.advanceTimersByTime(200); });
    expect(container.querySelectorAll('.ehr-toast')).toHaveLength(1);
    unmount();
  });
});

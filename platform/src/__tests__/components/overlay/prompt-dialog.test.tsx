/**
 * The awaitable reason prompt (`useConfirmPrompt`): resolves the trimmed text
 * on confirm and null ONLY on cancel/Escape/close, so a caller can tell a
 * cancelled prompt from an empty optional reason.
 */
import { act } from 'react';
import { mount, setValue } from '../clinical-notes/test-utils';
import { ConfirmProvider, useConfirmPrompt } from '@/components/ConfirmDialog';

jest.mock('@/lib/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => { document.body.innerHTML = ''; });

function Asker({ onResult, required }: { onResult: (r: string | null) => void; required?: boolean }) {
  const prompt = useConfirmPrompt();
  return (
    <button
      type="button"
      onClick={() => { void prompt({ title: 'Why?', inputLabel: 'Reason', inputRequired: required }).then(onResult); }}
    >
      ask
    </button>
  );
}

const flush = () => act(async () => { await Promise.resolve(); });

function open(required?: boolean) {
  const onResult = jest.fn();
  const m = mount(<ConfirmProvider><Asker onResult={onResult} required={required} /></ConfirmProvider>);
  act(() => m.container.querySelector('button')!.click());
  const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
  return { ...m, onResult, dialog };
}

const field = (d: HTMLElement) => d.querySelector<HTMLTextAreaElement>('#confirm-dialog-reason')!;
const primary = (d: HTMLElement) => d.querySelector<HTMLButtonElement>('.btn-primary')!;

describe('useConfirmPrompt', () => {
  it('resolves the trimmed text on confirm', async () => {
    const { dialog, onResult, unmount } = open();
    setValue(field(dialog), '  stock ran out ');
    act(() => primary(dialog).click());
    await flush();
    expect(onResult).toHaveBeenCalledWith('stock ran out');
    unmount();
  });

  it('resolves an empty string (not null) when an optional reason is confirmed blank', async () => {
    const { dialog, onResult, unmount } = open();
    act(() => primary(dialog).click());
    await flush();
    expect(onResult).toHaveBeenCalledWith('');
    unmount();
  });

  it('resolves null on Cancel', async () => {
    const { dialog, onResult, unmount } = open();
    act(() => dialog.querySelector<HTMLButtonElement>('.btn-secondary')!.click());
    await flush();
    expect(onResult).toHaveBeenCalledWith(null);
    unmount();
  });

  it('resolves null on Escape', async () => {
    const { onResult, unmount } = open();
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await flush();
    expect(onResult).toHaveBeenCalledWith(null);
    unmount();
  });

  it('blocks an empty submit when the reason is required', async () => {
    const { dialog, onResult, unmount } = open(true);
    expect(primary(dialog).disabled).toBe(true);
    setValue(field(dialog), '   ');
    expect(primary(dialog).disabled).toBe(true);
    setValue(field(dialog), 'because');
    expect(primary(dialog).disabled).toBe(false);
    expect(onResult).not.toHaveBeenCalled();
    unmount();
  });
});

/**
 * Stacked modals and the keyboard.
 *
 * Every Modal listens for Escape on the window, and each one used to answer
 * it. With a dialog opened from a dialog — a confirm over an editor, or the
 * text-to-patient composer over the prescription handover over the prescribing
 * dialog — one Escape closed the whole stack, which in the prescribing flow
 * dropped a saved script before the patient had been given it.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Modal from '@/components/Modal';
import CodedSearchField from '@/components/CodedSearchField';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function pressEscape() {
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
}

describe('stacked modals', () => {
  it('Escape closes only the modal on top', () => {
    const closeLower = jest.fn();
    const closeUpper = jest.fn();
    act(() => {
      root.render(
        <>
          <Modal onClose={closeLower}><p>prescribe</p></Modal>
          <Modal onClose={closeUpper}><p>handover</p></Modal>
        </>,
      );
    });
    pressEscape();
    expect(closeUpper).toHaveBeenCalledTimes(1);
    expect(closeLower).not.toHaveBeenCalled();
  });

  it('a modal opened later is on top, whatever its place in the tree', () => {
    const closeFirst = jest.fn();
    const closeLater = jest.fn();
    const tree = (later: boolean) => (
      <>
        {later && <Modal onClose={closeLater}><p>opened second, rendered first</p></Modal>}
        <Modal onClose={closeFirst}><p>opened first</p></Modal>
      </>
    );
    act(() => { root.render(tree(false)); });
    act(() => { root.render(tree(true)); });
    pressEscape();
    expect(closeLater).toHaveBeenCalledTimes(1);
    expect(closeFirst).not.toHaveBeenCalled();
  });

  it('a modal nested inside another modal, mounted together, is still the one on top', () => {
    const closeOuter = jest.fn();
    const closeInner = jest.fn();
    act(() => {
      root.render(
        <Modal onClose={closeOuter}>
          <p>outer</p>
          <Modal onClose={closeInner}><p>inner</p></Modal>
        </Modal>,
      );
    });
    pressEscape();
    expect(closeInner).toHaveBeenCalledTimes(1);
    expect(closeOuter).not.toHaveBeenCalled();
  });

  it('once the top modal closes, the one beneath answers again', () => {
    const closeLower = jest.fn();
    const closeUpper = jest.fn();
    const tree = (upper: boolean) => (
      <>
        <Modal onClose={closeLower}><p>lower</p></Modal>
        {upper && <Modal onClose={closeUpper}><p>upper</p></Modal>}
      </>
    );
    act(() => { root.render(tree(true)); });
    act(() => { root.render(tree(false)); });
    pressEscape();
    expect(closeLower).toHaveBeenCalledTimes(1);
    expect(closeUpper).not.toHaveBeenCalled();
  });

  it('a lone modal still closes on Escape', () => {
    const onClose = jest.fn();
    act(() => { root.render(<Modal onClose={onClose}><p>only</p></Modal>); });
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('background scroll lock', () => {
  it('is released when stacked modals close lower-first', () => {
    // Each modal used to restore the overflow value it saw on mount: the upper
    // one had seen 'hidden', so closing the lower one first left the page
    // locked with nothing open.
    document.body.style.overflow = '';
    const stack = (lower: boolean, upper: boolean) => act(() => {
      root.render(
        <>
          {lower && <Modal key="lower" onClose={() => {}}><p>prescribe</p></Modal>}
          {upper && <Modal key="upper" onClose={() => {}}><p>handover</p></Modal>}
        </>,
      );
    });
    stack(true, true);
    expect(document.body.style.overflow).toBe('hidden');
    stack(false, true);
    expect(document.body.style.overflow).toBe('hidden');
    stack(false, false);
    expect(document.body.style.overflow).toBe('');
  });

  it('puts back whatever the page had before the first modal opened', () => {
    document.body.style.overflow = 'clip';
    act(() => { root.render(<Modal onClose={() => {}}><p>one</p></Modal>); });
    expect(document.body.style.overflow).toBe('hidden');
    act(() => { root.render(<></>); });
    expect(document.body.style.overflow).toBe('clip');
    document.body.style.overflow = '';
  });
});

describe('Escape inside a search field in a modal', () => {
  const options = [{ code: 'MG26', name: 'Fever of unknown origin' }, { code: 'MD12', name: 'Cough' }];

  function Field() {
    return (
      <CodedSearchField
        label="Reason" placeholder="Search…" options={options}
        value="fev" onChange={() => {}} onSelect={() => {}}
      />
    );
  }

  it('closes the open suggestion list and leaves the dialog — and its unsaved work — alone', () => {
    const closeDialog = jest.fn();
    act(() => { root.render(<Modal onClose={closeDialog}><Field /></Modal>); });
    const input = document.querySelector('input[placeholder="Search…"]') as HTMLInputElement;
    act(() => { input.focus(); input.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
    act(() => { input.click(); });
    const listOpen = () => document.body.textContent?.includes('Fever of unknown origin');
    expect(listOpen()).toBeTruthy();

    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(closeDialog).not.toHaveBeenCalled();
    expect(listOpen()).toBeFalsy();

    // With the list closed, Escape is the dialog's again.
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(closeDialog).toHaveBeenCalledTimes(1);
  });
});

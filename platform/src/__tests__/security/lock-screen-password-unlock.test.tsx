/**
 * A tablet locked out of its PIN (5 wrong tries) or without one must be able to
 * unlock with the same user's password, without logout / wipe of the offline
 * credential.
 */
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import LockScreen from '@/components/LockScreen';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/lib/i18n/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

function render(over: Partial<React.ComponentProps<typeof LockScreen>>) {
  const props = {
    userName: 'Dr X', hasPin: true, lockedOut: true,
    onVerifyPin: jest.fn(async () => false), onUnlock: jest.fn(), onLogout: jest.fn(),
    ...over,
  };
  act(() => { root.render(<LockScreen {...props} />); });
  return props;
}

async function submit(password: string) {
  const input = container.querySelector('input[type=password]') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, password); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}

describe('lock screen password unlock', () => {
  it('shows the password form when PIN unlock is locked out, with Switch User kept separate', () => {
    render({ onPasswordUnlock: jest.fn(async () => null) });
    expect(container.querySelector('[data-lock-password-form]')).not.toBeNull();
    expect(container.textContent).toContain('auth.switchUser');
  });

  it('shows it when no PIN is registered', () => {
    render({ hasPin: false, lockedOut: false, onPasswordUnlock: jest.fn(async () => null) });
    expect(container.querySelector('[data-lock-password-form]')).not.toBeNull();
  });

  it('a correct password unlocks and never logs out', async () => {
    const onPasswordUnlock = jest.fn(async () => null);
    const props = render({ onPasswordUnlock });
    await submit('right');
    expect(onPasswordUnlock).toHaveBeenCalledWith('right');
    expect(props.onUnlock).toHaveBeenCalledTimes(1);
    expect(props.onLogout).not.toHaveBeenCalled();
  });

  it('a wrong password stays locked and shows the failure', async () => {
    const props = render({ onPasswordUnlock: jest.fn(async () => 'login.errorOfflineBadPassword') });
    await submit('wrong');
    expect(props.onUnlock).not.toHaveBeenCalled();
    expect(props.onLogout).not.toHaveBeenCalled();
    expect(container.textContent).toContain('login.errorOfflineBadPassword');
  });
});

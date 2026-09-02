/**
 * LockScreen's branch logic (S1 — the newly-enabled auto-lock accepting ANY
 * input when no PIN is stored).
 *
 * `LockScreen` used to start in a self-serve `mode === 'setup'` whenever
 * `hasPin` was false: type any 4 digits twice, and `onSetPin` + `onUnlock`
 * fired with no authentication at all. Since auto-lock is now on by default,
 * the very first time a shared device locked, this was the only path
 * available — anyone standing at the device could mint a PIN and walk in.
 *
 * The fix removes that path entirely. PIN registration lives in Settings
 * (`RoleSettingsView`), reached only once already authenticated. This
 * component now has a digit pad only when it can verify an EXISTING PIN.
 * Password re-authentication and switching users remain available without a
 * PIN; the unauthenticated PIN-creation shortcut never is.
 *
 * There is no React Testing Library in this repo, so the decision is tested
 * directly via the exported pure helper rather than by rendering the
 * component and inspecting the DOM — the same approach `useAutoLock.test.tsx`
 * documents for hook logic.
 */
import { canOfferPinEntry, shouldPromptPinSetup } from '@/components/LockScreen';

describe('canOfferPinEntry', () => {
  it('offers the PIN pad only when a PIN exists AND this context can hash one', () => {
    expect(canOfferPinEntry(true, true)).toBe(true);
  });

  it('THE REGRESSION: refuses PIN entry — falls back to re-auth only — when no PIN is stored', () => {
    // This is the exact bug: hasPin:false used to mean "show the setup flow
    // and let it unlock on success". It must now mean "no digit pad at all".
    expect(canOfferPinEntry(false, true)).toBe(false);
  });

  it('refuses PIN entry when this context cannot hash one, even if a PIN was registered elsewhere', () => {
    expect(canOfferPinEntry(true, false)).toBe(false);
  });

  it('refuses PIN entry when both a PIN is missing and hashing is unsupported', () => {
    expect(canOfferPinEntry(false, false)).toBe(false);
  });
});

/**
 * The authenticated first-run PIN prompt (LockScreen's 'setup' variant,
 * mounted by the dashboard layout right after sign-in). This is the
 * production-safe counterpart to the regression above: PIN creation is offered
 * only to someone who has just proven who they are — never on the lock
 * overlay itself.
 */
describe('shouldPromptPinSetup', () => {
  const base = {
    isAuthenticated: true,
    isLocked: false,
    lockEnabled: true,
    hasPin: false,
    pinSupported: true,
    dismissed: false,
    lockOverlayOffersSetup: false,
  };

  it('prompts a just-signed-in user when the session will lock and no PIN exists', () => {
    expect(shouldPromptPinSetup(base)).toBe(true);
  });

  it('never prompts an unauthenticated session — PIN creation requires proven identity', () => {
    expect(shouldPromptPinSetup({ ...base, isAuthenticated: false })).toBe(false);
  });

  it('yields to the lock overlay while the session is locked', () => {
    expect(shouldPromptPinSetup({ ...base, isLocked: true })).toBe(false);
  });

  it('does not ask for a PIN nothing will ever request (lock disabled)', () => {
    expect(shouldPromptPinSetup({ ...base, lockEnabled: false })).toBe(false);
  });

  it('does not prompt when a PIN is already registered', () => {
    expect(shouldPromptPinSetup({ ...base, hasPin: true })).toBe(false);
  });

  it('does not prompt on a context that cannot hash a PIN (insecure origin)', () => {
    expect(shouldPromptPinSetup({ ...base, pinSupported: false })).toBe(false);
  });

  it('respects an earlier "Skip for now" on this device', () => {
    expect(shouldPromptPinSetup({ ...base, dismissed: true })).toBe(false);
  });

  it('stays out of demo/dev, where the lock overlay offers first-lock setup itself', () => {
    expect(shouldPromptPinSetup({ ...base, lockOverlayOffersSetup: true })).toBe(false);
  });
});

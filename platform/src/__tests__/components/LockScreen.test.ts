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
 * component now has exactly two states: a digit pad that verifies against an
 * EXISTING PIN, or a re-auth-only screen (the "Switch User" button, which
 * signs out into a fresh sign-in) — never both.
 *
 * There is no React Testing Library in this repo, so the decision is tested
 * directly via the exported pure helper rather than by rendering the
 * component and inspecting the DOM — the same approach `useAutoLock.test.tsx`
 * documents for hook logic.
 */
import { canOfferPinEntry } from '@/components/LockScreen';

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

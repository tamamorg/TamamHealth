'use client';

import { useState, useRef, useCallback } from 'react';
import { Lock, LogOut } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface LockScreenProps {
  userName: string;
  hasPin: boolean;
  /**
   * 'lock' (default): the locked-session overlay — PIN entry only when a PIN
   * already exists (plus the demo/dev `allowSetup` exception).
   *
   * 'setup': the authenticated first-run PIN prompt. Same keypad UI, but shown
   * right after a successful sign-in (see the dashboard layout), which is what
   * makes offering PIN *creation* safe here: the person at the keyboard just
   * proved who they are. The security rule this component documents is about
   * the UNauthenticated lock overlay, not about PIN setup as such. The bottom
   * button becomes "Skip for now" (`onDismiss`) instead of "Switch User".
   */
  variant?: 'lock' | 'setup';
  /** Whether this device can hash a PIN at all right now (useAutoLock's
   *  `pinSupported` — false on a non-secure context, e.g. plain HTTP on a
   *  LAN). Defaults true so any other caller keeps today's behaviour. When
   *  false, the PIN pad is never offered — signing in again is the only way
   *  to unlock, rather than falling back to a weaker check. */
  pinSupported?: boolean;
  /**
   * Allow creating a PIN from THIS screen when none is registered yet, then
   * unlocking with it — the "first-lock setup" convenience.
   *
   * OFF by default, and the caller only turns it on in demo/dev mode
   * (`NEXT_PUBLIC_DEMO_MODE`). In a real deployment this stays false, so the
   * secure rule still holds: a PIN is registered from Settings while
   * authenticated, never from an overlay shown to someone who has not proven
   * who they are. See `canOfferPinSetup`.
   */
  allowSetup?: boolean;
  onVerifyPin: (pin: string) => Promise<boolean>;
  /** Registers a new PIN (demo/dev first-lock setup only). Required for the
   *  setup path to render. */
  onSetPin?: (pin: string) => Promise<void>;
  onUnlock: () => void;
  onLogout: () => void;
  /** 'setup' variant only: dismiss the prompt without setting a PIN. */
  onDismiss?: () => void;
}

/**
 * Whether the lock screen may offer PIN entry to UNLOCK an existing PIN, or
 * must fall back to re-authentication only (the "Switch User" button, which
 * signs the session out and returns to a full sign-in).
 *
 * This is the whole fix for the auto-lock-accepts-anything regression: PIN
 * *registration* happens from Settings (`RoleSettingsView`), reached only
 * once the user is already authenticated — never from this overlay, which by
 * definition is shown to someone who has NOT proven who they are yet. The one
 * exception is the demo/dev first-lock setup path (`canOfferPinSetup`), gated
 * on `allowSetup`, which callers only enable in demo mode. In production the
 * two ways past this screen are still a correct PRE-EXISTING PIN
 * (`onVerifyPin`, which itself refuses when none is registered — see
 * `useAutoLock.verifyPin`) or `onLogout` into a fresh sign-in.
 *
 * Extracted as pure functions — this repo has no React Testing Library, so
 * asserting the branch logic is done by testing these decisions directly
 * rather than rendering the component.
 */
export function canOfferPinEntry(hasPin: boolean, pinSupported: boolean): boolean {
  return hasPin && pinSupported;
}

/**
 * Whether the lock screen may let the user CREATE a PIN here and unlock with
 * it. Only when there is no PIN yet, the device can hash one, and the caller
 * has explicitly opted in (demo/dev). Never a fallback for a missing PIN in
 * production — that would let anyone at a locked, PIN-less device set a PIN
 * and walk in, which is the exact regression `canOfferPinEntry` guards.
 */
export function canOfferPinSetup(hasPin: boolean, pinSupported: boolean, allowSetup: boolean): boolean {
  return !hasPin && pinSupported && allowSetup;
}

/** localStorage flag: the user saw the first-run PIN prompt and skipped it.
 *  Device-scoped, like the PIN itself — survives logout on purpose so a
 *  returning user is not re-nagged; setting a PIN (here or in Settings) makes
 *  the flag moot. */
export const PIN_SETUP_DISMISSED_KEY = 'tamamhealth-pin-setup-dismissed';

/**
 * Whether to show the authenticated first-run PIN prompt (the 'setup' variant)
 * after sign-in.
 *
 * This is the production path to a lock screen that can actually offer the
 * digit pad: PIN registration must happen while authenticated (the lock
 * overlay refuses it — see `canOfferPinEntry`), and burying it in Settings
 * meant real deployments locked into a screen with no keypad at all. Only
 * when the lock overlay does NOT already offer setup itself
 * (`lockOverlayOffersSetup`, the demo/dev `allowSetup` case) — there the
 * prompt would be a redundant second interstitial and would break every
 * fresh-profile login flow the demo automation drives.
 */
export function shouldPromptPinSetup(opts: {
  isAuthenticated: boolean;
  isLocked: boolean;
  /** Some layer (policy or the user's own switch) will actually lock this
   *  session — no point prompting for a PIN that nothing ever asks for. */
  lockEnabled: boolean;
  hasPin: boolean;
  pinSupported: boolean;
  dismissed: boolean;
  lockOverlayOffersSetup: boolean;
}): boolean {
  return opts.isAuthenticated && !opts.isLocked && opts.lockEnabled
    && opts.pinSupported && !opts.hasPin && !opts.dismissed && !opts.lockOverlayOffersSetup;
}

export default function LockScreen({ userName, hasPin, variant = 'lock', pinSupported = true, allowSetup = false, onVerifyPin, onSetPin, onUnlock, onLogout, onDismiss }: LockScreenProps) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Setup path only: the first PIN entered, held while the user re-enters it
   *  to confirm. `null` = still on the first entry. */
  const [setupFirst, setSetupFirst] = useState<string | null>(null);
  const autoRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The 'setup' variant is rendered to a just-authenticated user, so it
  // authorizes PIN creation the way `allowSetup` does for demo/dev — still
  // through `canOfferPinSetup`, which keeps the pinSupported/hasPin guards.
  const setupMode = canOfferPinSetup(hasPin, pinSupported, variant === 'setup' || allowSetup) && !!onSetPin;

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  const handleDigit = useCallback((digit: string) => {
    if (busy) return;
    setError('');

    setPin(prev => {
      if (prev.length >= 4) return prev; // max 4 digits
      const next = prev + digit;

      if (next.length === 4) {
        if (autoRef.current) clearTimeout(autoRef.current);
        autoRef.current = setTimeout(async () => {
          if (setupMode) {
            // First-lock setup: capture, then confirm, then register + unlock.
            if (setupFirst === null) {
              setSetupFirst(next);
              setPin('');
              return;
            }
            if (next !== setupFirst) {
              setError(t('lock.pinsDoNotMatch'));
              setSetupFirst(null);
              setPin('');
              triggerShake();
              return;
            }
            setBusy(true);
            try {
              await onSetPin!(next);
              onUnlock();
            } catch {
              setError(t('lock.pinSetupFailed'));
              setSetupFirst(null);
              setPin('');
              triggerShake();
            }
            setBusy(false);
            return;
          }

          // Verify path: check against the existing PIN.
          setBusy(true);
          const valid = await onVerifyPin(next);
          if (valid) {
            onUnlock();
          } else {
            setError(t('lock.incorrectPin'));
            setPin('');
            triggerShake();
          }
          setBusy(false);
        }, 250);
      }

      return next;
    });
  }, [busy, setupMode, setupFirst, onSetPin, onVerifyPin, onUnlock, t]);

  const handleBackspace = useCallback(() => {
    setPin(prev => prev.slice(0, -1));
    setError('');
  }, []);

  // No usable PIN to check against and no setup offered (never registered and
  // not demo/dev, or this context can't hash one — see `pinSupported`). The
  // ONLY way through is a fresh sign-in: no digit pad, and no "set up a PIN"
  // prompt on an unauthenticated screen. See `canOfferPinEntry` /
  // `canOfferPinSetup`.
  if (!canOfferPinEntry(hasPin, pinSupported) && !setupMode) {
    return (
      <div className="fixed inset-0 z-[10000] flex flex-col items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <div className="flex flex-col items-center gap-4 w-full max-w-xs px-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/tamamhealth-logo.svg" alt="TamamHealth" className="w-16 h-16" />
          <div>
            <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{userName}</p>
            <div className="flex items-center gap-1.5 justify-center mt-1" style={{ color: 'var(--text-muted)' }}>
              <Lock className="w-3.5 h-3.5" />
              <span className="text-xs">{t('auth.sessionLocked')}</span>
            </div>
            {/* Only the insecure-context reason has copy of its own — a
                simply PIN-less device needs no extra explanation beyond the
                sign-in button below, and inventing one risks implying the
                setup flow this component no longer offers. */}
            {!pinSupported && (
              <p className="text-[11px] mt-2 max-w-[240px]" style={{ color: 'var(--text-muted)' }}>
                {t('lock.pinUnavailableInsecure')}
              </p>
            )}
          </div>
          <button
            onClick={onLogout}
            className="flex items-center gap-2 text-xs font-bold mt-1 px-4 py-2.5 rounded-lg transition-colors"
            style={{ color: 'var(--accent-on)', background: 'var(--tamamhealth-blue)' }}
          >
            <LogOut className="w-3.5 h-3.5" />
            {t('auth.switchUser')}
          </button>
        </div>
      </div>
    );
  }

  // Instruction under the name: create → confirm → (or) enter existing PIN.
  const prompt = setupMode
    ? (setupFirst === null ? t('lock.choosePin') : t('lock.confirmPin'))
    : t('lock.enterYourPin');

  return (
    <div className="fixed inset-0 z-[10000] flex flex-col items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <div className="flex flex-col items-center gap-4 w-full max-w-xs px-6">
        {/* TamamHealth logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/tamamhealth-logo.svg" alt="TamamHealth" className="w-16 h-16" />

        {/* Name & status */}
        <div className="text-center">
          <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{userName}</p>
          <div className="flex items-center gap-1.5 justify-center mt-1" style={{ color: 'var(--text-muted)' }}>
            <Lock className="w-3.5 h-3.5" />
            <span className="text-xs">{variant === 'setup' ? t('lock.setPin') : t('auth.sessionLocked')}</span>
          </div>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{prompt}</p>
        </div>

        {/* PIN dots */}
        <div className={`flex gap-3 my-1 ${shake ? 'animate-shake' : ''}`}>
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className="w-3.5 h-3.5 rounded-full transition-all duration-150"
              style={{
                background: i < pin.length ? (error ? 'var(--color-danger)' : 'var(--tamamhealth-blue)') : 'transparent',
                border: `2px solid ${i < pin.length ? (error ? 'var(--color-danger)' : 'var(--tamamhealth-blue)') : 'var(--border-medium)'}`,
                transform: i < pin.length ? 'scale(1.1)' : 'scale(1)',
              }}
            />
          ))}
        </div>

        {error && (
          <p className="text-xs text-center" style={{ color: 'var(--color-danger-text)' }}>{error}</p>
        )}

        {/* Number pad */}
        <div className="w-full">
          <div className="grid grid-cols-3 gap-2.5 keep-cols">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map(key => (
              <button
                key={key || 'empty'}
                type="button"
                disabled={!key || busy}
                onClick={() => {
                  if (key === 'del') handleBackspace();
                  else if (key) handleDigit(key);
                }}
                className="h-14 rounded-xl text-lg font-semibold transition-all duration-100 flex items-center justify-center"
                style={{
                  background: !key ? 'transparent' : 'var(--overlay-subtle)',
                  color: key === 'del' ? 'var(--text-muted)' : 'var(--text-primary)',
                  border: !key ? 'none' : '1px solid var(--border-light)',
                  cursor: !key ? 'default' : 'pointer',
                  minWidth: 48,
                  minHeight: 48,
                  opacity: busy ? 0.5 : 1,
                }}
              >
                {key === 'del' ? '⌫' : key}
              </button>
            ))}
          </div>
        </div>

        {/* Locked: switch user (full re-auth). Setup prompt: skip without a PIN. */}
        <button
          onClick={variant === 'setup' ? (onDismiss ?? onLogout) : onLogout}
          className="flex items-center gap-2 text-xs font-bold mt-1 px-4 py-2.5 rounded-lg transition-colors"
          style={{ color: 'var(--text-muted)', background: 'var(--overlay-subtle)' }}
        >
          {variant === 'setup' ? t('lock.skipForNow') : (
            <>
              <LogOut className="w-3.5 h-3.5" />
              {t('auth.switchUser')}
            </>
          )}
        </button>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
        .animate-shake { animation: shake 0.4s ease-in-out; }
      `}</style>
    </div>
  );
}

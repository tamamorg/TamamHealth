'use client';

import { useState, useRef, useCallback } from 'react';
import { Lock, LogOut } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface LockScreenProps {
  userName: string;
  hasPin: boolean;
  /** Whether this device can hash a PIN at all right now (useAutoLock's
   *  `pinSupported` — false on a non-secure context, e.g. plain HTTP on a
   *  LAN). Defaults true so any other caller keeps today's behaviour. When
   *  false, the PIN pad is never offered — signing in again is the only way
   *  to unlock, rather than falling back to a weaker check. */
  pinSupported?: boolean;
  onVerifyPin: (pin: string) => Promise<boolean>;
  onUnlock: () => void;
  onLogout: () => void;
}

/**
 * Whether the lock screen may offer PIN entry at all, or must fall back to
 * re-authentication only (the "Switch User" button, which signs the session
 * out and returns to a full sign-in).
 *
 * This is the whole fix for the auto-lock-accepts-anything regression: PIN
 * *registration* happens from Settings (`RoleSettingsView`), reached only
 * once the user is already authenticated — never from this overlay, which by
 * definition is shown to someone who has NOT proven who they are yet. There
 * used to be a `mode === 'setup'` path here that let anyone standing in front
 * of a locked, PIN-less device pick a fresh PIN and walk straight in
 * (`onSetPin` immediately followed by `onUnlock`); that path is gone. The
 * only two ways past this screen now are a correct PRE-EXISTING PIN
 * (`onVerifyPin`, which itself refuses when none is registered — see
 * `useAutoLock.verifyPin`) or `onLogout` into a fresh sign-in.
 *
 * Extracted as a pure function — this repo has no React Testing Library, so
 * asserting "no PIN means only the re-auth branch renders" is done by testing
 * this decision directly rather than rendering the component.
 */
export function canOfferPinEntry(hasPin: boolean, pinSupported: boolean): boolean {
  return hasPin && pinSupported;
}

export default function LockScreen({ userName, hasPin, pinSupported = true, onVerifyPin, onUnlock, onLogout }: LockScreenProps) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const autoRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      // Auto-submit when 4th digit entered — verify against the existing
      // PIN. There is no setup/confirm branch here any more: a lock screen
      // is only ever rendered with a digit pad when `canOfferPinEntry` is
      // true, i.e. a PIN already exists to check against.
      if (next.length === 4) {
        if (autoRef.current) clearTimeout(autoRef.current);
        autoRef.current = setTimeout(async () => {
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
  }, [busy, onVerifyPin, onUnlock, t]);

  const handleBackspace = useCallback(() => {
    setPin(prev => prev.slice(0, -1));
    setError('');
  }, []);

  // No usable PIN to check against (never registered, or this context can't
  // hash one — see `pinSupported`'s doc comment). Either way the ONLY way
  // through is a fresh sign-in: no digit pad, and no "set up a PIN" prompt
  // that would otherwise let whoever is standing at the device register one
  // and walk straight in. Falling through to the pad instead would mean
  // either verifying against nothing (any 4 digits "work") or minting a new
  // PIN from an unauthenticated screen — both are the exact regression this
  // guards against. See `canOfferPinEntry`.
  if (!canOfferPinEntry(hasPin, pinSupported)) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
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

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <div className="flex flex-col items-center gap-4 w-full max-w-xs px-6">
        {/* TamamHealth logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/tamamhealth-logo.svg" alt="TamamHealth" className="w-16 h-16" />

        {/* Name & status */}
        <div className="text-center">
          <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{userName}</p>
          <div className="flex items-center gap-1.5 justify-center mt-1" style={{ color: 'var(--text-muted)' }}>
            <Lock className="w-3.5 h-3.5" />
            <span className="text-xs">{t('auth.sessionLocked')}</span>
          </div>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{t('lock.enterYourPin')}</p>
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

        {/* Switch user */}
        <button
          onClick={onLogout}
          className="flex items-center gap-2 text-xs font-bold mt-1 px-4 py-2.5 rounded-lg transition-colors"
          style={{ color: 'var(--text-muted)', background: 'var(--overlay-subtle)' }}
        >
          <LogOut className="w-3.5 h-3.5" />
          {t('auth.switchUser')}
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

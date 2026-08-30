'use client';

import { useState, useRef, useCallback } from 'react';
import { Lock, LogOut, ShieldCheck } from '@/components/icons/lucide';
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
  onSetPin: (pin: string) => Promise<void>;
  onUnlock: () => void;
  onLogout: () => void;
}

export default function LockScreen({ userName, hasPin, pinSupported = true, onVerifyPin, onSetPin, onUnlock, onLogout }: LockScreenProps) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [setupPin, setSetupPin] = useState(''); // stores first entry during setup
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [mode, setMode] = useState<'unlock' | 'setup' | 'confirm'>(hasPin ? 'unlock' : 'setup');
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

      // Auto-submit when 4th digit entered
      if (next.length === 4) {
        if (autoRef.current) clearTimeout(autoRef.current);
        autoRef.current = setTimeout(async () => {
          setBusy(true);

          if (mode === 'unlock') {
            // Verify PIN
            const valid = await onVerifyPin(next);
            if (valid) {
              onUnlock();
            } else {
              setError(t('lock.incorrectPin'));
              setPin('');
              triggerShake();
            }
          } else if (mode === 'setup') {
            // Store first entry, move to confirm
            setSetupPin(next);
            setPin('');
            setMode('confirm');
          } else {
            // Confirm mode — check match
            if (next === setupPin) {
              await onSetPin(next);
              onUnlock();
            } else {
              setError(t('lock.pinsDoNotMatch'));
              setPin('');
              setSetupPin('');
              setMode('setup');
              triggerShake();
            }
          }

          setBusy(false);
        }, 250);
      }

      return next;
    });
  }, [busy, mode, setupPin, onVerifyPin, onSetPin, onUnlock]);

  const handleBackspace = useCallback(() => {
    setPin(prev => prev.slice(0, -1));
    setError('');
  }, []);

  const title = mode === 'unlock' ? t('auth.sessionLocked')
    : mode === 'setup' ? t('lock.setPin')
    : t('lock.confirmPin');

  const subtitle = mode === 'unlock' ? t('lock.enterYourPin')
    : mode === 'setup' ? t('lock.choosePin')
    : t('lock.enterSamePin');

  // This device cannot hash a PIN safely right now (no secure context — see
  // `useAutoLock.pinHashingSupported`). The lock still engages, but it offers
  // only the sign-in path: no digit pad, and no "set up a PIN" prompt that
  // would otherwise appear here in `mode === 'setup'` for anyone who has
  // never registered one. Falling through to the pad instead would mean
  // either verifying against nothing (any 4 digits "work") or silently
  // reaching for a weaker hash — both are the exact regression this guards.
  if (!pinSupported) {
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
            <p className="text-[11px] mt-2 max-w-[240px]" style={{ color: 'var(--text-muted)' }}>
              {t('lock.pinUnavailableInsecure')}
            </p>
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
            {mode === 'unlock' ? <Lock className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            <span className="text-xs">{title}</span>
          </div>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>
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

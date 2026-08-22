'use client';

/**
 * Setting up (or removing) the second factor on your own account.
 *
 * Renders in two places from one implementation:
 *   - as a full-screen GATE, when the account's role requires a factor and has
 *     not enrolled one (mirrors `ForcePasswordChange`);
 *   - inside account settings, where enrolling is voluntary.
 *
 * The secret is shown as text to type into an authenticator app rather than as
 * a QR code. Drawing a QR needs either a dependency or a few hundred lines of
 * error-correction maths, every authenticator worth using accepts a manually
 * entered key, and the grouped-in-fours rendering is legible on the cracked
 * screens this runs on. The `otpauth://` URI is offered too, for anyone whose
 * app can take it from the clipboard.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import { Check, Copy, KeyRound, Loader2, ShieldCheck } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface MfaStatus {
  enabled: boolean;
  enabledAt?: string;
  recoveryCodesRemaining: number;
  required: boolean;
  policyEnabled: boolean;
  appliesToRole: boolean;
}

interface Enrolment {
  secret: string;
  secretForDisplay: string;
  otpauthUri: string;
}

export default function MfaEnrolment({
  mode,
  onEnrolled,
  onLogout,
}: {
  /** 'gate' blocks the app until enrolment completes; 'settings' is voluntary. */
  mode: 'gate' | 'settings';
  onEnrolled?: () => void;
  onLogout?: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/auth/mfa');
      if (res.ok) setStatus(await res.json());
    } catch {
      setError('Could not reach the server.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const post = async (payload: Record<string, unknown>) => {
    setError('');
    setBusy(true);
    try {
      const res = await apiFetch('/api/auth/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || 'That did not work. Try again.');
        return null;
      }
      return body;
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const begin = async () => {
    const body = await post({ action: 'begin' });
    if (body) { setEnrolment(body as Enrolment); setCode(''); }
  };

  const confirm = async () => {
    const body = await post({ action: 'confirm', code });
    if (body?.recoveryCodes) {
      setRecoveryCodes(body.recoveryCodes as string[]);
      setEnrolment(null);
      await load();
    }
  };

  const disable = async () => {
    const body = await post({ action: 'disable', password });
    if (body?.ok) { setPassword(''); setRecoveryCodes(null); await load(); }
  };

  const regenerate = async () => {
    const body = await post({ action: 'regenerate_recovery' });
    if (body?.recoveryCodes) setRecoveryCodes(body.recoveryCodes as string[]);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — the value is on screen to read */ }
  };

  // ── Recovery codes: shown once, and the one thing here that cannot be
  // recovered afterwards, so it takes over the panel until acknowledged.
  if (recoveryCodes) {
    return (
      <Shell mode={mode} title={t('mfa.saveRecoveryTitle')}>
        <p className="mfa-lede">
          {t('mfa.saveRecoveryBody')} <strong>{t('mfa.saveRecoveryNever')}</strong>
        </p>
        <ul className="mfa-codes">
          {recoveryCodes.map(c => <li key={c}>{c}</li>)}
        </ul>
        <div className="mfa-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(recoveryCodes.join('\n'))}>
            {copied ? <><Check className="w-4 h-4" /> {t('mfa.copied')}</> : <><Copy className="w-4 h-4" /> {t('mfa.copyCodes')}</>}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => { setRecoveryCodes(null); onEnrolled?.(); }}
          >
            {t('mfa.savedThem')}
          </button>
        </div>
        <MfaStyles />
      </Shell>
    );
  }

  // ── Mid-enrolment: secret issued, waiting for a code that proves it works.
  if (enrolment) {
    return (
      <Shell mode={mode} title={t('mfa.addToAuthenticator')}>
        <ol className="mfa-steps">
          <li>{t('mfa.step1')}</li>
          <li>
            {t('mfa.step2')}
            <code className="mfa-secret">{enrolment.secretForDisplay}</code>
            <button type="button" className="mfa-inline-btn" onClick={() => copy(enrolment.secret)}>
              {copied ? t('mfa.copied') : t('mfa.copyKey')}
            </button>
          </li>
          <li>{t('mfa.step3')}</li>
        </ol>

        <div className="mfa-field">
          <label htmlFor="mfa-code">{t('mfa.codeLabel')}</label>
          <input
            id="mfa-code"
            className="mfa-input mfa-input--code"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
          />
        </div>

        {error && <p className="mfa-error" role="alert">{error}</p>}

        <div className="mfa-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setEnrolment(null); setError(''); }} disabled={busy}>
            {t('mfa.back')}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={confirm} disabled={busy || code.length !== 6}>
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('mfa.checking')}</> : t('mfa.turnOn')}
          </button>
        </div>
        <MfaStyles />
      </Shell>
    );
  }

  // ── Resting state.
  return (
    <Shell
      mode={mode}
      title={status?.enabled ? t('mfa.onTitle') : t('mfa.setupTitle')}
    >
      {!status ? (
        <p className="mfa-lede"><Loader2 className="w-4 h-4 animate-spin" /> {t('mfa.loading')}</p>
      ) : status.enabled ? (
        <>
          <p className="mfa-lede">
            <ShieldCheck className="w-4 h-4" /> {t('mfa.onBody')}
            {' '}
            {status.recoveryCodesRemaining === 0
              ? t('mfa.noCodesLeft')
              : status.recoveryCodesRemaining === 1
                ? t('mfa.codesLeftOne')
                : t('mfa.codesLeft', { count: status.recoveryCodesRemaining })}
          </p>
          <div className="mfa-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={regenerate} disabled={busy}>
              {t('mfa.newRecoveryCodes')}
            </button>
          </div>
          {!status.required && (
            <div className="mfa-danger">
              <p>{t('mfa.disableWarning')}</p>
              <div className="mfa-field">
                <label htmlFor="mfa-pass">{t('mfa.confirmPassword')}</label>
                <input
                  id="mfa-pass"
                  type="password"
                  className="mfa-input"
                  value={password}
                  autoComplete="current-password"
                  onChange={e => setPassword(e.target.value)}
                />
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={disable} disabled={busy || !password}>
                {t('mfa.turnOff')}
              </button>
            </div>
          )}
          {status.required && (
            <p className="mfa-note">
              {t('mfa.requiredNote')}
            </p>
          )}
          {error && <p className="mfa-error" role="alert">{error}</p>}
        </>
      ) : (
        <>
          <p className="mfa-lede">
            {status.required ? t('mfa.pitchRequired') : t('mfa.pitchOptional')}
          </p>
          {error && <p className="mfa-error" role="alert">{error}</p>}
          <div className="mfa-actions">
            {mode === 'gate' && onLogout && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={onLogout} disabled={busy}>
                {t('mfa.signOut')}
              </button>
            )}
            <button type="button" className="btn btn-primary btn-sm" onClick={begin} disabled={busy}>
              {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('mfa.working')}</> : <><KeyRound className="w-4 h-4" /> {t('mfa.startSetup')}</>}
            </button>
          </div>
        </>
      )}
      <MfaStyles />
    </Shell>
  );
}

/** Full-screen when it is a gate, a plain panel when it is a settings section. */
function Shell({ mode, title, children }: { mode: 'gate' | 'settings'; title: string; children: React.ReactNode }) {
  if (mode === 'settings') {
    return (
      <section className="mfa-panel">
        <h3 className="mfa-title">{title}</h3>
        {children}
      </section>
    );
  }
  return (
    <div className="mfa-gate">
      <div className="mfa-panel mfa-panel--gate">
        <h2 className="mfa-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/**
 * Scoped to `mfa-*`. The global `label` rule in globals.css force-uppercases
 * every label and several rules override icon colour with `!important`, so a
 * namespace is the documented way out rather than a specificity fight.
 */
function MfaStyles() {
  return (
    <style jsx global>{`
      .mfa-gate {
        position: fixed; inset: 0; z-index: 1000; display: flex;
        align-items: center; justify-content: center; padding: 16px;
        background: var(--bg-primary);
      }
      .mfa-panel {
        display: flex; flex-direction: column; gap: 14px;
        background: var(--bg-card); border: 1px solid var(--border-light);
        border-radius: 12px; padding: 22px 24px;
      }
      .mfa-panel--gate { width: 100%; max-width: 460px; box-shadow: var(--card-shadow-lg); }
      .mfa-title { margin: 0; font-size: 19px; font-weight: 600; color: var(--text-primary); }
      .mfa-lede { margin: 0; font-size: 14px; line-height: 1.55; color: var(--text-secondary); display: flex; gap: 6px; align-items: flex-start; }
      .mfa-note { margin: 0; font-size: 13px; color: var(--text-muted); }
      .mfa-steps { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 10px; font-size: 14px; color: var(--text-secondary); }
      .mfa-secret {
        display: block; margin: 8px 0 6px; padding: 10px 12px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 16px; letter-spacing: 0.12em; user-select: all;
        background: var(--overlay-subtle); border: 1px solid var(--border-light);
        border-radius: 8px; color: var(--text-primary); word-break: break-all;
      }
      .mfa-inline-btn {
        appearance: none; background: none; border: none; padding: 0;
        font-size: 12.5px; font-weight: 600; color: var(--accent-text); cursor: pointer;
      }
      .mfa-field { display: flex; flex-direction: column; gap: 5px; }
      .mfa-field label {
        text-transform: none; font-weight: 600; letter-spacing: 0;
        font-size: 12.5px; color: var(--text-muted); display: block;
      }
      .mfa-input {
        width: 100%; padding: 10px 12px; font-size: 14px;
        background: var(--overlay-subtle); border: 1px solid var(--border-light);
        border-radius: 6px; color: var(--text-primary); outline: none;
      }
      .mfa-input:focus-visible { border-color: var(--accent-primary); }
      .mfa-input--code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 22px; letter-spacing: 0.34em; text-align: center;
      }
      .mfa-codes {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
        gap: 6px; margin: 0; padding: 12px; list-style: none;
        background: var(--overlay-subtle); border: 1px solid var(--border-light); border-radius: 8px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px;
        color: var(--text-primary); user-select: all;
      }
      .mfa-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
      .mfa-error { margin: 0; font-size: 13px; color: var(--color-danger-text); }
      .mfa-danger {
        display: flex; flex-direction: column; gap: 10px;
        border-top: 1px solid var(--border-light); padding-top: 14px;
      }
      .mfa-danger p { margin: 0; font-size: 13px; color: var(--text-muted); }
    `}</style>
  );
}

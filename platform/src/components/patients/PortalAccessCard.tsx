'use client';

/**
 * Portal access for one patient, on the Demographics tab.
 *
 * Demographics rather than a clinical section because this is an
 * administrative act — issuing somebody a key to their own record — and
 * Demographics is one of the few tabs a front-desk role may open at all (see
 * `ADMIN_TAB_IDS` in PatientDetailPage). The people who enrol patients are the
 * people standing at the registration desk with them.
 *
 * The activation code is shown ONCE, at the moment it is issued, because only
 * its hash is stored. It is displayed large and monospaced: in practice it is
 * copied onto a printed slip or read aloud across a desk.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import { Check, Copy, Loader2, Smartphone, UserX } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface PortalAccess {
  enrolled: boolean;
  username?: string;
  activated: boolean;
  activationPending: boolean;
  activationExpiresAt?: string;
  disabled: boolean;
  lastLoginAt?: string;
}

interface Issued {
  username: string;
  activationCode: string;
  expiresAt: string;
}

export default function PortalAccessCard({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const [access, setAccess] = useState<PortalAccess | null>(null);
  const [suggested, setSuggested] = useState('');
  const [username, setUsername] = useState('');
  const [issued, setIssued] = useState<Issued | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // 403 means this role may not issue portal access. Hide the card rather than
  // offering buttons that always fail.
  const [permitted, setPermitted] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/patients/portal-access?patientId=${encodeURIComponent(patientId)}`);
      if (res.status === 403) { setPermitted(false); return; }
      if (!res.ok) return;
      const body = await res.json();
      setAccess(body.access);
      setSuggested(body.suggestedUsername || '');
      setUsername(prev => prev || body.access?.username || body.suggestedUsername || '');
    } catch {
      setError(t('pac.errUnreachable'));
    }
  }, [patientId, t]);

  useEffect(() => { void load(); }, [load]);

  const post = async (payload: Record<string, unknown>) => {
    setError('');
    setBusy(true);
    try {
      const res = await apiFetch('/api/patients/portal-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId, ...payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || t('pac.errFailed')); return null; }
      return body;
    } catch {
      setError(t('pac.errNetwork'));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const enrol = async () => {
    const body = await post({ action: 'enrol', username });
    if (body?.activationCode) {
      setIssued({ username: body.username, activationCode: body.activationCode, expiresAt: body.expiresAt });
      await load();
    }
  };

  const disable = async () => {
    const body = await post({ action: 'disable' });
    if (body?.ok) { setIssued(null); await load(); }
  };

  if (!permitted) return null;

  const slip = issued
    ? `TamamHealth patient portal\nUsername: ${issued.username}\nActivation code: ${issued.activationCode}\n`
      + `Activate at: ${typeof window !== 'undefined' ? window.location.origin : ''}/patient-portal/activate\n`
      + `The code expires on ${new Date(issued.expiresAt).toLocaleDateString()}.`
    : '';

  return (
    <section className="pac">
      <header className="pac-head">
        <Smartphone className="w-4 h-4" />
        <h3>{t('pac.title')}</h3>
      </header>

      {!access ? (
        <p className="pac-muted"><Loader2 className="w-4 h-4 animate-spin" /> {t('pac.loading')}</p>
      ) : issued ? (
        <div className="pac-issued" role="status">
          <p className="pac-muted">{t('pac.slipNote')}</p>
          <dl className="pac-slip">
            <dt>{t('pac.username')}</dt><dd>{issued.username}</dd>
            <dt>{t('pac.activationCode')}</dt><dd className="pac-code">{issued.activationCode}</dd>
            <dt>{t('pac.expires')}</dt><dd>{new Date(issued.expiresAt).toLocaleDateString()}</dd>
          </dl>
          <div className="pac-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(slip);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch { /* clipboard unavailable — the slip is on screen */ }
              }}
            >
              {copied ? <><Check className="w-4 h-4" /> {t('pac.copied')}</> : <><Copy className="w-4 h-4" /> {t('pac.copySlip')}</>}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setIssued(null)}>
              {t('pac.done')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="pac-muted">
            {!access.enrolled
              ? t('pac.notEnrolled')
              : access.disabled
                ? t('pac.suspended', { username: access.username ?? '' })
                : access.activated
                  ? `${t('pac.activeAs', { username: access.username ?? '' })} ${access.lastLoginAt
                      ? t('pac.lastSignedIn', { date: new Date(access.lastLoginAt).toLocaleDateString() })
                      : t('pac.neverSignedIn')}`
                  : access.activationPending
                    ? t('pac.notActivated', { username: access.username ?? '' })
                    : t('pac.codeExpired', { username: access.username ?? '' })}
          </p>

          {!access.enrolled && (
            <label className="pac-field">
              <span>{t('pac.usernameLabel')}</span>
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder={suggested}
                spellCheck={false}
              />
            </label>
          )}

          {error && <p className="pac-error" role="alert">{error}</p>}

          <div className="pac-actions">
            {access.enrolled && !access.disabled && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={disable} disabled={busy}>
                <UserX className="w-4 h-4" /> {t('pac.suspendAccess')}
              </button>
            )}
            <button type="button" className="btn btn-primary btn-sm" onClick={enrol} disabled={busy || !username.trim()}>
              {busy
                ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('pac.working')}</>
                : access.enrolled ? t('pac.issueNewCode') : t('pac.enrol')}
            </button>
          </div>
        </>
      )}

      <style jsx>{`
        .pac {
          display: flex; flex-direction: column; gap: 12px;
          border: 1px solid var(--border-light); border-radius: 10px;
          background: var(--bg-card); padding: 16px 18px; margin-top: 16px;
        }
        .pac-head { display: flex; align-items: center; gap: 8px; color: var(--text-primary); }
        .pac-head h3 { margin: 0; font-size: 15px; font-weight: 600; }
        .pac-muted { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--text-secondary); }
        .pac-field { display: flex; flex-direction: column; gap: 4px; }
        /* The global bare-label rule uppercases every <label>; this namespace
           opts out rather than fighting its specificity. */
        .pac-field span {
          font-size: 12px; font-weight: 600; letter-spacing: 0;
          text-transform: none; color: var(--text-muted);
        }
        .pac-field input {
          padding: 9px 11px; font-size: 14px; border-radius: 6px;
          border: 1px solid var(--border-light); background: var(--overlay-subtle);
          color: var(--text-primary); outline: none;
        }
        .pac-issued { display: flex; flex-direction: column; gap: 10px; }
        .pac-slip {
          display: grid; grid-template-columns: auto 1fr; gap: 6px 14px;
          margin: 0; padding: 12px 14px; border-radius: 8px;
          background: var(--overlay-subtle); border: 1px solid var(--border-light);
          font-size: 13.5px;
        }
        .pac-slip dt { color: var(--text-muted); font-weight: 600; }
        .pac-slip dd { margin: 0; color: var(--text-primary); }
        .pac-code {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 15px; letter-spacing: 0.04em; word-break: break-all; user-select: all;
        }
        .pac-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
        .pac-error { margin: 0; font-size: 13px; color: var(--color-danger-text); }
      `}</style>
    </section>
  );
}

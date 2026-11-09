'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2 } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { humanizeStatus } from '@/lib/format-utils';
import type { ManagerApproval } from '@/lib/billing/manager-override-policy';
import { FormError } from '@/components/overlay/FormNotices';

const FIELD_STYLE = {
  width: '100%', padding: '10px 12px', borderRadius: 0, border: '1px solid var(--border-medium)',
  fontSize: 14, background: 'var(--bg-secondary)', color: 'var(--text-primary)',
} as const;
const LABEL_STYLE = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' } as const;

/**
 * Manager override on the cashier's device: a second person, never the signed-in
 * user, types their own username and password. The server checks it (see
 * /api/auth/manager-override); the password is not kept. Needs a connection,
 * because this device holds no other staff member's credentials.
 */
export default function ManagerOverrideFields({ purpose, approval, onApproval }: {
  /** What is being approved, for the audit trail ("waiver of 50 SSP"). */
  purpose: string;
  approval: ManagerApproval | null;
  onApproval: (approval: ManagerApproval | null) => void;
}) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

  const verify = async () => {
    if (!username.trim() || !password || busy) return;
    setBusy(true);
    setError('');
    try {
      const { apiFetch } = await import('@/lib/api-fetch');
      const res = await apiFetch('/api/auth/manager-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password, purpose }),
      });
      const body = await res.json().catch(() => ({})) as { approval?: ManagerApproval; error?: string };
      if (res.ok && body.approval) {
        onApproval(body.approval);
        setPassword('');
      } else {
        setError(body.error || t('override.failed'));
      }
    } catch {
      setError(t('override.offline'));
    } finally {
      setBusy(false);
      setPassword('');
    }
  };

  if (approval) {
    return (
      <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', border: '1px solid var(--border-light)', background: 'var(--accent-light)' }}>
        <CheckCircle2 size={18} aria-hidden="true" style={{ color: 'var(--color-success)' }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {t('override.approvedBy', { name: approval.approvedByName, role: humanizeStatus(approval.approvedByRole) })}
        </span>
        <button type="button" className="btn btn-secondary" onClick={() => { onApproval(null); setUsername(''); }}>{t('override.change')}</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="manager-override">
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>{t('override.help')}</p>
      {offline ? <FormError message={t('override.offline')} /> : (
        <>
          <div>
            <label htmlFor="mo-username" style={LABEL_STYLE}>{t('override.username')}</label>
            <input id="mo-username" type="text" autoComplete="off" autoCapitalize="none" value={username} onChange={e => setUsername(e.target.value)} style={FIELD_STYLE} />
          </div>
          <div>
            <label htmlFor="mo-password" style={LABEL_STYLE}>{t('override.password')}</label>
            <input id="mo-password" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void verify(); } }} style={FIELD_STYLE} />
          </div>
          <button type="button" className="btn btn-primary" disabled={busy || !username.trim() || !password} onClick={() => void verify()}>
            {busy ? <><Loader2 size={14} className="animate-spin" /> {t('override.approving')}</> : t('override.approve')}
          </button>
          {error && <FormError message={error} />}
        </>
      )}
    </div>
  );
}

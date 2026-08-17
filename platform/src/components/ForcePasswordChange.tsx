'use client';

/**
 * Full-screen gate shown when the signed-in user must set a new password
 * before using the app (UserDoc.mustChangePassword === true — set when an
 * admin creates the account or resets the password). Blocks all app content
 * until the user replaces the temporary credential. Mirrors the LockScreen
 * overlay pattern used by the dashboard layout.
 */
import { useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import { KeyRound, Eye, EyeOff, Loader2, ShieldCheck } from '@/components/icons/lucide';

const MIN_LENGTH = 8;

export default function ForcePasswordChange({
  userName,
  onLogout,
}: {
  userName: string;
  onLogout: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError('');
    if (!currentPassword || !newPassword) {
      setError('Enter your temporary password and a new password.');
      return;
    }
    if (newPassword.length < MIN_LENGTH) {
      setError(`New password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('New password must be different from your temporary password.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not change password. Please try again.');
        setSubmitting(false);
        return;
      }
      // The server re-issued a session token without the forced-change flag.
      // A full reload re-hydrates currentUser from /api/auth/me and lifts the gate.
      window.location.assign('/');
    } catch {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      style={{ background: 'var(--bg-primary)' }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 sm:p-8"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', boxShadow: 'var(--card-shadow-lg)' }}
      >
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
          style={{ background: 'transparent', color: 'var(--accent-primary)' }}
        >
          <ShieldCheck className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
          Set your password
        </h1>
        <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
          Welcome, {userName}. For security, choose a new password before continuing.
          Your temporary password was set by an administrator.
        </p>

        {error && (
          <div
            className="mb-4 p-3 rounded-lg text-sm font-medium"
            style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger-text)', border: '1px solid var(--color-danger-bg)' }}
          >
            {error}
          </div>
        )}

        <div className="space-y-3">
          <PasswordField
            label="Temporary password"
            value={currentPassword}
            onChange={setCurrentPassword}
            show={show}
            autoFocus
          />
          <PasswordField
            label="New password"
            value={newPassword}
            onChange={setNewPassword}
            show={show}
            hint={`At least ${MIN_LENGTH} characters`}
          />
          <PasswordField
            label="Confirm new password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            show={show}
            onEnter={handleSubmit}
          />
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none" style={{ color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} />
            Show passwords
          </label>
        </div>

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="btn btn-primary w-full mt-5 justify-center"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
          {submitting ? 'Saving…' : 'Set password & continue'}
        </button>
        <button
          onClick={onLogout}
          className="w-full mt-2 text-xs font-bold py-2"
          style={{ color: 'var(--text-muted)' }}
        >
          Sign out instead
        </button>
      </div>
    </div>
  );
}

function PasswordField({
  label, value, onChange, show, hint, autoFocus, onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  hint?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  const [reveal, setReveal] = useState(false);
  const visible = show || reveal;
  return (
    <div>
      <label className="block text-xs font-bold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        {label}
      </label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          autoFocus={autoFocus}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && onEnter) onEnter(); }}
          className="w-full px-3 py-2 pr-10 rounded-lg text-sm"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
        />
        <button
          type="button"
          onClick={() => setReveal(r => !r)}
          className="absolute right-3 top-1/2 -translate-y-1/2"
          tabIndex={-1}
        >
          {visible ? <EyeOff className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /> : <Eye className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
        </button>
      </div>
      {hint && <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>{hint}</p>}
    </div>
  );
}

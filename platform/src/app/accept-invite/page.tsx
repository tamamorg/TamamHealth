'use client';

/**
 * Set-your-password page for a newly invited staff member.
 *
 * Reached from the link in the welcome email, with no session — the person has
 * no password yet, which is the whole reason they are here. Authorisation is
 * the single-use token in the URL; `/api/auth/accept-invite` re-checks it on
 * submit and the proxy lets both through unauthenticated.
 *
 * Reuses the login page's `lg-*` styling so the first screen a new user sees
 * belongs to the same product as the second. The global `label` rule in
 * globals.css force-uppercases every label, which is why the fields are built
 * from the same classes rather than fresh ones.
 *
 * The token is read from the URL and deliberately never rendered or logged:
 * it is a credential until it is redeemed.
 */

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const MIN_PASSWORD_LENGTH = 8;

function AcceptInviteForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // A link with no token at all never reaches the API — the person is told
  // plainly rather than being shown a form that cannot succeed.
  if (!token) {
    return (
      <div className="lg-form">
        <p className="lg-error" role="alert">
          This invitation link is incomplete. Open the link from your email again, or ask your
          administrator to send a new invitation.
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="lg-form">
        <p className="lg-lede">
          Your password is set. You can sign in with it now.
        </p>
        <button type="button" className="lg-btn" onClick={() => router.push('/login')}>
          Go to sign in
        </button>
      </div>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    // Checked here as well as on the server so the common mistakes cost no
    // round trip — the server is still the authority.
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || 'Could not set your password. Try again.');
        return;
      }
      setDone(true);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="lg-form">
      <div className="lg-field">
        <label htmlFor="ai-password">New password</label>
        <input
          id="ai-password"
          type="password"
          className="lg-input"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </div>

      <div className="lg-field">
        <label htmlFor="ai-confirm">Confirm password</label>
        <input
          id="ai-confirm"
          type="password"
          className="lg-input"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </div>

      {error && <p className="lg-error" role="alert">{error}</p>}

      <button type="submit" className="lg-btn" disabled={busy}>
        {busy ? 'Setting your password…' : 'Set password'}
      </button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <div className="lg-root">
      <header className="lg-topbar">
        <a href="https://tamamhealth.org" className="lg-topbar-link">
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed-height SVG logo */}
          <img src="/assets/tamamhealth-logo-full.svg" alt="Tamam Healthcare System" className="lg-topbar-logo" />
        </a>
      </header>

      <div className="lg-grid">
        <div className="lg-col">
          <div>
            <h1 className="lg-h1">Set your password</h1>
            <p className="lg-lede">
              Choose the password you will use to sign in. Your administrator cannot see it.
            </p>
          </div>
          {/* useSearchParams needs a Suspense boundary in the App Router. */}
          <Suspense fallback={<div className="lg-boot"><span className="lg-spin" /> Loading…</div>}>
            <AcceptInviteForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

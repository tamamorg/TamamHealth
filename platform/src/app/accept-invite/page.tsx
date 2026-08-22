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

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { DEFAULT_MIN_PASSWORD_LENGTH } from '@/lib/password-policy';

function AcceptInviteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') || '';
  // Purely cosmetic — see `buildInviteUrl`. Editing it out of the URL changes
  // the wording and nothing else; the token decides what actually happens.
  const isReset = params.get('reset') === '1';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // What this deployment actually requires. The page used to hard-code 8 while
  // the server enforced whatever /admin/security said, so someone could type a
  // password the form accepted and the server refused.
  const [minLength, setMinLength] = useState(DEFAULT_MIN_PASSWORD_LENGTH);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/password-policy')
      .then(res => (res.ok ? res.json() : null))
      .then(body => {
        if (!cancelled && typeof body?.minLength === 'number') setMinLength(body.minLength);
      })
      // The documented default stands, and the server corrects it on submit.
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  // A link with no token at all never reaches the API — the person is told
  // plainly rather than being shown a form that cannot succeed.
  if (!token) {
    return (
      <>
        <Heading isReset={isReset} />
        <div className="lg-form">
        <p className="lg-error" role="alert">
          {isReset
            ? 'This reset link is incomplete. Open the link from your email again, or ask for a new one from the sign-in page.'
              : 'This invitation link is incomplete. Open the link from your email again, or ask your administrator to send a new invitation.'}
          </p>
        </div>
      </>
    );
  }

  if (done) {
    return (
      <>
        <h1 className="lg-h1">Your password is set</h1>
        <div className="lg-form">
          <p className="lg-lede">You can sign in with it now.</p>
          <button type="button" className="lg-btn" onClick={() => router.push('/login')}>
            Go to sign in
          </button>
        </div>
      </>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    // Checked here as well as on the server so the common mistakes cost no
    // round trip — the server is still the authority.
    if (password.length < minLength) {
      setError(`Password must be at least ${minLength} characters.`);
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
    <>
      <Heading isReset={isReset} />
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
          minLength={minLength}
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
    </>
  );
}

/**
 * Setting a password you never had and replacing one you forgot are the same
 * operation on the same token — only the words differ, and `?reset=1` chooses
 * them. Rendered INSIDE the Suspense child that reads the query, so the
 * heading is right on first paint instead of being corrected by an effect
 * after hydration.
 */
function Heading({ isReset }: { isReset: boolean }) {
  return (
    <div>
      <h1 className="lg-h1">{isReset ? 'Choose a new password' : 'Set your password'}</h1>
      <p className="lg-lede">
        {isReset
          ? 'Pick the password you will use from now on. Nobody else can see it, and your old one stops working immediately.'
          : 'Choose the password you will use to sign in. Your administrator cannot see it.'}
      </p>
    </div>
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
          {/* useSearchParams needs a Suspense boundary in the App Router, and
              the heading lives inside it: the page title depends on the query,
              so rendering it outside meant the wrong words on first paint. */}
          <Suspense fallback={<div className="lg-boot"><span className="lg-spin" /> Loading…</div>}>
            <AcceptInviteForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

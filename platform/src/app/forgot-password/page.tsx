'use client';

/**
 * "I have forgotten my password."
 *
 * Until now this page did not exist and neither did the flow behind it. The
 * login page's `login.forgotPassword` string sat in both locale files,
 * rendered nowhere, because the only answer available was an administrator
 * reset — which puts a plaintext temporary credential back into the room and
 * usually down a phone line, the exact thing the invitation design was built
 * to avoid.
 *
 * The page tells the person nothing about their account, because the endpoint
 * behind it cannot: one answer for every outcome, so a stranger cannot use it
 * to discover which usernames exist or which staff have an email address on
 * file. Everything useful happens in the mailbox.
 *
 * Drawn in the login page's `lg-*` language — it is the same doorway.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Corners, loginStyles } from '@/components/login/login-chrome';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSending(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 202) {
        setError(body.error || 'Could not send the request. Try again.');
        return;
      }
      setMessage(body.message || '');
      setSent(true);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="lg-root">
      <header className="lg-topbar">
        <a href="https://tamamhealth.org" className="lg-topbar-link">
          {/* eslint-disable-next-line @next/next/no-img-element -- brand mark, fixed size */}
          <img src="/assets/tamamhealth-logo-full.svg" alt="Tamam Healthcare System" className="lg-topbar-logo" />
        </a>
      </header>

      <div className="lg-grid">
        <div className="lg-col">
          {sent ? (
            <>
              <h1 className="lg-h1">{t('forgotPassword.sentTitle')}</h1>
              <p className="lg-lede">{message || t('forgotPassword.sentBody')}</p>
              <div className="lg-links">
                <Link href="/login">{t('forgotPassword.backToSignIn')}</Link>
              </div>
            </>
          ) : (
            <>
              <h1 className="lg-h1">{t('forgotPassword.title')}</h1>
              <p className="lg-lede">{t('forgotPassword.lede')}</p>

              <form onSubmit={submit} className="lg-form">
                <div className="lg-field">
                  <label htmlFor="fp-username">{t('forgotPassword.usernameLabel')}</label>
                  <input
                    id="fp-username"
                    className="lg-input"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    required
                    autoComplete="username"
                    autoFocus
                    placeholder="e.g. desk.amira"
                  />
                  <span className="lg-hint">{t('forgotPassword.usernameHint')}</span>
                </div>

                {error && <div role="alert" className="lg-error">{error}</div>}

                <button type="submit" disabled={sending} className="lg-btn blueprint">
                  {sending ? t('forgotPassword.sending') : t('forgotPassword.submit')}
                  <Corners />
                </button>
              </form>

              <div className="lg-links">
                <Link href="/login">{t('forgotPassword.backToSignIn')}</Link>
                <Link href="/request-account">{t('login.requestAccount')}</Link>
              </div>

              <span className="lg-offline">{t('forgotPassword.noEmailNote')}</span>
            </>
          )}
        </div>
      </div>

      {loginStyles}
    </div>
  );
}

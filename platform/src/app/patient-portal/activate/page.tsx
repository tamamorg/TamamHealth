'use client';

/**
 * Where a patient turns an activation slip into a portal account.
 *
 * The code is typed rather than followed from a link, because most patients
 * here are handed a printed slip at the desk rather than an email — see
 * `lib/services/patient-portal-enrolment.ts`. A link still works: `?code=`
 * pre-fills the field for the patients who do have an address.
 *
 * Drawn in the login page's `lg-*` language, like every other doorway.
 */

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Corners, loginStyles } from '@/components/login/login-chrome';
import { useTranslation } from '@/lib/i18n/useTranslation';

import { PORTAL_MIN_PASSWORD_LENGTH as MIN_PASSWORD_LENGTH } from '@/lib/password-policy';

function ActivateForm() {
  const { t } = useTranslation();
  const params = useSearchParams();
  // Read once, as the field's initial value, rather than written back from an
  // effect: the code is a starting point the patient may edit, not state to be
  // re-synchronised, and an effect here just triggers a second render.
  const [code, setCode] = useState(() => params.get('code') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <>
        <h1 className="lg-h1">{t('pactivate.readyTitle')}</h1>
        <p className="lg-lede">
          {t('pactivate.readyBodyPre')} <strong>{username}</strong> {t('pactivate.readyBodyPost')}
        </p>
        <div className="lg-links">
          <Link href="/patient-portal">{t('pactivate.goToPortal')}</Link>
        </div>
      </>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('pactivate.errShort', { count: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setError(t('pactivate.errMismatch'));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/patient-portal/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || t('pactivate.errFailed'));
        return;
      }
      setUsername(body.username || '');
      setDone(true);
    } catch {
      setError(t('pactivate.errNetwork'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="lg-h1">{t('pactivate.title')}</h1>
      <p className="lg-lede">{t('pactivate.lede')}</p>

      <form onSubmit={submit} className="lg-form">
        <div className="lg-field">
          <label htmlFor="pa-code">{t('pactivate.codeLabel')}</label>
          <input
            id="pa-code"
            className="lg-input"
            value={code}
            onChange={e => setCode(e.target.value)}
            required
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="lg-field">
          <label htmlFor="pa-password">{t('pactivate.passwordLabel')}</label>
          <input
            id="pa-password"
            type="password"
            className="lg-input"
            value={password}
            onChange={e => setPassword(e.target.value)}
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            required
          />
        </div>

        <div className="lg-field">
          <label htmlFor="pa-confirm">{t('pactivate.confirmLabel')}</label>
          <input
            id="pa-confirm"
            type="password"
            className="lg-input"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>

        {error && <div role="alert" className="lg-error">{error}</div>}

        <button type="submit" className="lg-btn blueprint" disabled={busy}>
          {busy ? t('pactivate.activating') : t('pactivate.activate')}
          <Corners />
        </button>
      </form>

      <div className="lg-links">
        <Link href="/patient-portal">{t('pactivate.backToPortal')}</Link>
      </div>

      <span className="lg-offline">
        {t('pactivate.lostCode')}
      </span>
    </>
  );
}

export default function PatientPortalActivatePage() {
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
          {/* useSearchParams needs a Suspense boundary in the App Router. */}
          <Suspense fallback={<div className="lg-boot"><span className="lg-spin" /> Loading…</div>}>
            <ActivateForm />
          </Suspense>
        </div>
      </div>

      {loginStyles}
    </div>
  );
}

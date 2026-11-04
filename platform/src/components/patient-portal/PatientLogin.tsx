'use client';

/**
 * Patient sign-in, drawn in the same language as the staff login at /login —
 * the marketing site's login chrome (centred logo bar, blueprint frames with
 * registration marks, square white fields, Barlow typography, one amber call
 * to action). The two doors into the platform now look like two doors of the
 * same building rather than two products; the shared sheet lives in
 * components/login/login-chrome.
 *
 * Only the dress changed. The behaviour — password step, the SMS second
 * factor (KAN-76), the demo prefill, the session write — is untouched.
 */

import { useState } from 'react';
import type { PatientDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { IS_DEMO, writePatientPortalSession } from '@/lib/patient-portal-session';
import { Corners } from '@/components/login/login-chrome';
import { describeApiError } from '@/lib/user-facing-error';
import { FormError } from '@/components/overlay/FormNotices';

/* ═════════════════════════════════════════
   PATIENT LOGIN SCREEN
   ═════════════════════════════════════════ */
export function PatientLogin({ onLogin }: { onLogin: (patient: PatientDoc) => void }) {
  const { t } = useTranslation();
  // Prefill the single demo account in demo mode so a visitor can sign in with
  // one tap (mirrors the staff login's demo roster). Empty in production
  // (NEXT_PUBLIC_DEMO_MODE=false).
  const [username, setUsername] = useState(IS_DEMO ? 'patient.mary' : '');
  const [password, setPassword] = useState(IS_DEMO ? 'patient1234' : '');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // OTP second factor (KAN-76). Non-null once the password step has succeeded
  // and the server is waiting on a code; the form switches to the code entry.
  const [otpChallenge, setOtpChallenge] = useState<{ challengeId: string; maskedPhone?: string } | null>(null);
  const [otpCode, setOtpCode] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const response = await fetch('/api/patient-portal/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await response.json() as {
        token?: string;
        patient?: PatientDoc & { id?: string };
        error?: string;
        otpRequired?: boolean;
        challengeId?: string;
        maskedPhone?: string;
      };
      if (!response.ok) {
        setError(describeApiError(data, t('patientPortal.unableToConnect')));
        return;
      }
      // Password was right but the server wants the SMS code before it will
      // issue a session. No token exists yet — nothing is stored.
      if (data.otpRequired && data.challengeId) {
        setOtpChallenge({ challengeId: data.challengeId, maskedPhone: data.maskedPhone });
        return;
      }
      const patientDoc = data.patient
        ? { ...data.patient, _id: data.patient._id || data.patient.id } as PatientDoc
        : null;
      if (!data.token || !patientDoc?._id) throw new Error('Your session has ended. Sign in again to continue.');
      writePatientPortalSession({ token: data.token, patient: patientDoc });
      onLogin(patientDoc);
    } catch (err) {
      setError(t('patientPortal.unableToConnect'));
      console.error(err);
    } finally { setLoading(false); }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpChallenge) return;
    setError(''); setLoading(true);
    try {
      const response = await fetch('/api/patient-portal/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: otpChallenge.challengeId, code: otpCode.trim() }),
      });
      const data = await response.json() as { token?: string; patient?: PatientDoc & { id?: string }; error?: string };
      if (!response.ok) {
        setError(describeApiError(data, t('patientPortal.unableToConnect')));
        // Send them back to the start on a burnt challenge so they aren't
        // stuck typing into a code box the server has already discarded.
        if (response.status === 429) { setOtpChallenge(null); setOtpCode(''); }
        return;
      }
      const patientDoc = data.patient
        ? { ...data.patient, _id: data.patient._id || data.patient.id } as PatientDoc
        : null;
      if (!data.token || !patientDoc?._id) throw new Error('Your session has ended. Sign in again to continue.');
      writePatientPortalSession({ token: data.token, patient: patientDoc });
      onLogin(patientDoc);
    } catch (err) {
      setError(t('patientPortal.unableToConnect'));
      console.error(err);
    } finally { setLoading(false); }
  };

  return (
    <div className="lg-root">
      {/* ── Logo bar ── */}
      <header className="lg-topbar">
        <a href="https://tamamhealth.org" className="lg-topbar-link">
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed-height SVG logo */}
          <img src="/assets/tamamhealth-logo-full.svg" alt={t('ui.tamamHealthcareSystem')} className="lg-topbar-logo" />
        </a>
      </header>

      <div className="lg-grid">
        {/* ── Left: the form ── */}
        <div className="lg-col">
          {otpChallenge ? (
            <>
              <div>
                <h1 className="lg-h1">{t('ui.enterYourVerificationCode')}</h1>
                <p className="lg-lede">
                  {otpChallenge.maskedPhone
                    ? `We sent a 6-digit code to ${otpChallenge.maskedPhone}. It expires in 5 minutes.`
                    : 'We sent a 6-digit code to the phone number on your record. It expires in 5 minutes.'}
                </p>
              </div>

              <form onSubmit={handleVerifyOtp} className="lg-form">
                <div className="lg-field">
                  <label htmlFor="pp-otp">{t('ui.verificationCode')}</label>
                  <input
                    id="pp-otp"
                    type="text"
                    className="lg-input"
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    // Lets the browser / Android autofill the code straight
                    // from the SMS instead of making the patient retype it.
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="\d{6}"
                    required
                    autoFocus
                  />
                </div>

                {error && <FormError message={error} />}

                <button type="submit" className="lg-btn blueprint" disabled={loading || otpCode.length !== 6}>
                  {loading ? 'Verifying…' : 'Verify and sign in'}
                  <Corners />
                </button>
                <button
                  type="button"
                  className="lg-btn-quiet"
                  onClick={() => { setOtpChallenge(null); setOtpCode(''); setError(''); }}
                >
                  {t('forgotPassword.backToSignIn')}
                </button>
              </form>
            </>
          ) : (
            <>
              <div>
                <h1 className="lg-h1">{t('patientPortal.signInTitle')}</h1>
                <p className="lg-lede">{t('patientPortal.signInSubtitle')}</p>
              </div>

              <form onSubmit={handleLogin} className="lg-form">
                <div className="lg-field">
                  <label htmlFor="pp-username">{t('patientPortal.username')}</label>
                  <input
                    id="pp-username"
                    type="text"
                    className="lg-input"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder={t('patientPortal.usernamePlaceholder')}
                    required
                    autoComplete="username"
                  />
                </div>

                <div className="lg-field">
                  <label htmlFor="pp-password">{t('patientPortal.password')}</label>
                  <div className="lg-inputwrap">
                    <input
                      id="pp-password"
                      type={showPassword ? 'text' : 'password'}
                      className="lg-input lg-input--bare"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder={t('patientPortal.passwordPlaceholder')}
                      required
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="lg-eye"
                      onClick={() => setShowPassword(v => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.6" />
                      </svg>
                    </button>
                  </div>
                </div>

                {IS_DEMO && (
                  <p className="lg-hint">
                    {t('ui.demoAccountSignsInAs')} <strong>patient.mary</strong> / <strong>patient1234</strong>{t('ui.seededDataNoRealPatient')}
                  </p>
                )}

                {error && <FormError message={error} />}

                <button type="submit" disabled={loading} className="lg-btn blueprint">
                  {loading ? t('patientPortal.searching') : 'Log in'}
                  <Corners />
                </button>
              </form>
            </>
          )}

          <div className="lg-links">
            {/* A patient handed an activation slip at the desk has a code and
                no account yet. The slip prints this address, but somebody who
                arrives at the sign-in page first should not have to retype a
                URL to find the one page that can help them. */}
            <a href="/patient-portal/activate">{t('patientPortal.haveActivationCode')}</a>
            <a href="/login">{t('ui.staffLogin')}</a>
            <a href={`mailto:support.tamam@gmail.com?subject=${encodeURIComponent('Trouble signing in to the patient portal')}`}>{t('ui.troubleSigningIn')}</a>
          </div>

          <span className="lg-note">
            {t('ui.yourRecordIsPrivateTo')}
          </span>
        </div>

        {/* ── Right: what the portal is for. A photograph rather than a
              screenshot of the app, the same argument the staff panel makes:
              the person signing in is about to see the interface anyway. ── */}
        <aside className="lg-aside blueprint">
          <Corners />
          <span className="lg-eyebrow">{t('pactivate.asideEyebrow')}</span>
          <h2 className="lg-h2">{t('pactivate.asideTitle')}</h2>
          <p className="lg-aside-copy">
            {t('pactivate.asideBody')}
          </p>
          <ul className="lg-points">
            <li>{t('pactivate.asidePoint1')}</li>
            <li>{t('pactivate.asidePoint2')}</li>
            <li>{t('pactivate.asidePoint3')}</li>
          </ul>
          <div className="lg-shot lg-shot--portrait blueprint">
            <Corners />
            {/* eslint-disable-next-line @next/next/no-img-element -- photograph, cropped by CSS */}
            <img src="/assets/clinician-with-tablet.jpg" alt={t('ui.aClinicianReadingAPatient')} />
          </div>
        </aside>
      </div>

      <footer className="lg-footer">
        <a href="/terms">{t('login.termsAndConditions')}</a>
        <a href="/privacy">{t('login.privacyPolicy')}</a>
        <a href="https://tamamhealth.org">{t('login.backToSite')}</a>
      </footer>

    </div>
  );
}

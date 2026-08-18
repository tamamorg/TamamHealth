'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  User, Calendar, FlaskConical,
  ArrowRight,
  X,
  Eye, EyeOff, Lock,
} from '@/components/icons/lucide';
import type { PatientDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { IS_DEMO, writePatientPortalSession } from '@/lib/patient-portal-session';

/* ═════════════════════════════════════════
   PATIENT LOGIN SCREEN
   ═════════════════════════════════════════ */
export function PatientLogin({ onLogin }: { onLogin: (patient: PatientDoc) => void }) {
  const { t } = useTranslation();
  // Prefill the single demo account in demo mode so a visitor can sign in with
  // one tap (mirrors the staff login's prefilled demo password). Empty in
  // production (NEXT_PUBLIC_DEMO_MODE=false).
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
        setError(data.error || t('patientPortal.unableToConnect'));
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
      if (!data.token || !patientDoc?._id) throw new Error('Invalid patient session');
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
        setError(data.error || t('patientPortal.unableToConnect'));
        // Send them back to the start on a burnt challenge so they aren't
        // stuck typing into a code box the server has already discarded.
        if (response.status === 429) { setOtpChallenge(null); setOtpCode(''); }
        return;
      }
      const patientDoc = data.patient
        ? { ...data.patient, _id: data.patient._id || data.patient.id } as PatientDoc
        : null;
      if (!data.token || !patientDoc?._id) throw new Error('Invalid patient session');
      writePatientPortalSession({ token: data.token, patient: patientDoc });
      onLogin(patientDoc);
    } catch (err) {
      setError(t('patientPortal.unableToConnect'));
      console.error(err);
    } finally { setLoading(false); }
  };

  return (
    <div className="pl-shell">
      <div className="pl-split">
        {/* ── Left: form ── */}
        <section className="pl-pane pl-form-pane">
          {/* Back to the marketing site — shown on small screens where the hero is hidden. */}
          <Link href="/" aria-label="Close" className="pl-form-close"><X size={18} /></Link>
          <header className="pl-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/tamamhealth-logo-full.svg" alt="Tamam Healthcare System" className="pl-brand-logo" />
          </header>

          <div className="pl-form-wrap">
            {otpChallenge ? (
              <>
                <h1 className="pl-title">Enter your verification code</h1>
                <p className="pl-subtitle">
                  {otpChallenge.maskedPhone
                    ? `We sent a 6-digit code to ${otpChallenge.maskedPhone}. It expires in 5 minutes.`
                    : 'We sent a 6-digit code to the phone number on your record. It expires in 5 minutes.'}
                </p>

                <form onSubmit={handleVerifyOtp} className="pl-form">
                  <div className="pl-field">
                    <label htmlFor="pp-otp">Verification code</label>
                    <div className="pl-input-wrap">
                      <span className="pl-input-icon"><Lock size={16} /></span>
                      <input
                        id="pp-otp"
                        type="text"
                        value={otpCode}
                        onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="123456"
                        // Lets the browser / Android autofill the code straight
                        // from the SMS instead of making the patient retype it.
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        pattern="\\d{6}"
                        required
                        autoFocus
                        className="pl-input pl-input-icon-pad"
                      />
                    </div>
                  </div>
                  {error && <p className="pl-error" role="alert">{error}</p>}
                  <button type="submit" className="pl-submit" disabled={loading || otpCode.length !== 6}>
                    {loading ? '…' : 'Verify and sign in'}
                  </button>
                  <button
                    type="button"
                    className="pl-link-btn"
                    onClick={() => { setOtpChallenge(null); setOtpCode(''); setError(''); }}
                  >
                    Back to sign in
                  </button>
                </form>
              </>
            ) : (
            <>
            <h1 className="pl-title">{t('patientPortal.signInTitle')}</h1>
            <p className="pl-subtitle">{t('patientPortal.signInSubtitle')}</p>

            <form onSubmit={handleLogin} className="pl-form">
              <div className="pl-field">
                <label htmlFor="pp-username">{t('patientPortal.username')}</label>
                <div className="pl-input-wrap">
                  <span className="pl-input-icon"><User size={16} /></span>
                  <input id="pp-username" type="text" value={username} onChange={e => setUsername(e.target.value)}
                    placeholder={t('patientPortal.usernamePlaceholder')} required autoComplete="username" className="pl-input pl-input-icon-pad" />
                </div>
              </div>
              <div className="pl-field">
                <label htmlFor="pp-password">{t('patientPortal.password')}</label>
                <div className="pl-input-wrap">
                  <span className="pl-input-icon"><Lock size={16} /></span>
                  <input id="pp-password" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                    placeholder={t('patientPortal.passwordPlaceholder')} required autoComplete="current-password" className="pl-input pl-input-icon-pad pl-input-eye-pad" />
                  <button type="button" onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'} className="pl-input-eye">
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {IS_DEMO && (
                <p className="pl-demo-hint">Demo account &mdash; sign in with <strong>patient.mary</strong> / <strong>patient1234</strong></p>
              )}

              {error && <div role="alert" className="pl-error">{error}</div>}

              <button type="submit" disabled={loading} className="pl-submit">
                {loading
                  ? (<span className="pl-submit-loading"><span className="pl-spin pl-spin-light" /> {t('patientPortal.searching')}</span>)
                  : (<>{t('patientPortal.signInTitle')} <ArrowRight size={16} /></>)}
              </button>
            </form>
            </>
            )}

            <p className="pl-foot">
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="pl-link">Terms &amp; Conditions</a>
            </p>
          </div>
        </section>

        {/* ── Right: hero — same floating-chip treatment as the staff login
            (decorative copy hardcoded in English there too). ── */}
        <section className="pl-hero" style={{ backgroundImage: 'url(/assets/doctor-nurse-consultation.jpg)' }}>
          <Link href="/" aria-label="Close" className="pl-hero-close"><X size={18} /></Link>

          {/* What the portal offers — replaces the old decorative chips, which
              advertised an invented appointment and a fixed calendar week. */}
          <div className="pl-promo">
            <span className="pl-promo-eyebrow">Tamam Patient Portal</span>
            <h2 className="pl-promo-title">Your health record, in your hands.</h2>
            <ul className="pl-promo-points">
              <li><Calendar size={15} /> Book and track your visits</li>
              <li><FlaskConical size={15} /> See lab results and prescriptions as they&rsquo;re ready</li>
              <li><Lock size={15} /> Private to you, shared only with your care team</li>
            </ul>
          </div>
        </section>
      </div>

      <style jsx>{`
        .pl-shell {
          min-height: 100vh; padding: 24px;
          display: flex; align-items: center; justify-content: center;
          background: var(--bg-app);
        }
        .pl-split {
          width: 100%; max-width: 1080px; height: min(680px, calc(100vh - 48px));
          display: grid; grid-template-columns: 1fr 1.05fr;
          background: var(--bg-card-solid); border: 1px solid var(--border-light);
          border-radius: 28px; overflow: hidden;
        }
        .pl-pane { padding: 30px 38px; display: flex; flex-direction: column; overflow-y: auto; }
        .pl-form-pane { position: relative; }
        .pl-brand { width: 100%; max-width: 380px; align-self: center; display: flex; align-items: center; }
        .pl-brand-logo { height: 30px; width: auto; }
        .pl-form-close { display: none; position: absolute; top: 18px; right: 18px; z-index: 3; width: 38px; height: 38px; align-items: center; justify-content: center; border-radius: 50%; border: 1px solid var(--border-light); background: var(--bg-card-solid); color: var(--text-primary); cursor: pointer; }
        .pl-form-close:hover { background: var(--overlay-subtle); }
        .pl-form-wrap { margin: auto 0; width: 100%; max-width: 380px; align-self: center; padding: 20px 0; }
        .pl-title { font-family: var(--font-platform); font-size: 27px; font-weight: 800; letter-spacing: -0.03em; color: var(--text-primary); margin: 4px 0 0; }
        .pl-subtitle { font-size: 13.5px; color: var(--text-muted); margin: 6px 0 0; }

        .pl-form { display: flex; flex-direction: column; gap: 14px; margin-top: 22px; }
        .pl-field { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
        .pl-field label { font-size: 12.5px; font-weight: 600; color: var(--text-secondary); }
        .pl-input-wrap { position: relative; display: flex; align-items: center; }
        .pl-input-icon { position: absolute; left: 15px; top: 50%; transform: translateY(-50%); display: flex; align-items: center; color: var(--text-muted); pointer-events: none; }
        .pl-input { width: 100%; padding: 13px 16px; font-size: 14.5px; color: var(--text-primary); background: var(--overlay-subtle); border: 1.5px solid transparent; border-radius: 999px; outline: none; transition: border-color .15s, background .15s; font-family: var(--font-platform); }
        .pl-input-icon-pad { padding-left: 42px; }
        .pl-input-eye-pad { padding-right: 44px; }
        .pl-input-eye { position: absolute; right: 8px; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border: none; background: transparent; color: var(--text-muted); cursor: pointer; border-radius: 999px; }
        .pl-input-eye:hover { color: var(--text-secondary); background: var(--overlay-subtle); }
        .pl-demo-hint { margin: -2px 0 0; font-size: 12px; color: var(--text-muted); text-align: center; }
        .pl-demo-hint strong { color: var(--text-secondary); font-weight: 700; }
        .pl-input::placeholder { color: var(--text-muted); }
        .pl-input:focus { border-color: var(--accent-primary); background: var(--bg-card-solid); }

        .pl-error { padding: 10px 13px; font-size: 12.5px; color: var(--color-danger); background: var(--color-danger-bg); border: 1px solid color-mix(in srgb, var(--color-danger) 22%, transparent); border-radius: 10px; }

        .pl-submit { width: 100%; padding: 14px 24px; margin-top: 4px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-size: 15px; font-weight: 700; color: #fff; background: var(--accent-primary); border: none; border-radius: 999px; cursor: pointer; transition: transform .12s, opacity .15s; }
        .pl-submit:hover:not(:disabled) { transform: translateY(-1px); }
        .pl-submit:disabled { opacity: .6; cursor: not-allowed; }
        .pl-submit-loading { display: inline-flex; align-items: center; gap: 8px; }
        /* Secondary action under the OTP form ("Back to sign in"). Text-only so
           it reads as an escape hatch rather than competing with Verify. */
        .pl-link-btn { width: 100%; margin-top: 10px; padding: 8px; background: none; border: none; font-size: 14px; font-weight: 600; color: var(--text-secondary); cursor: pointer; }
        .pl-link-btn:hover { color: var(--accent-primary); text-decoration: underline; }

        .pl-foot { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 22px; font-size: 12.5px; }
        .pl-foot-sep { color: var(--border-medium); }
        .pl-link { display: inline-flex; align-items: center; gap: 5px; color: var(--accent-hover); font-weight: 600; text-decoration: none; background: none; border: none; padding: 0; cursor: pointer; font-family: inherit; font-size: 12.5px; }
        .pl-link:hover { text-decoration: underline; }

        /* ── Hero — mirrors the staff login (tl-hero): flat tint over the
           photo, blue task chip, frosted week strip, white card bottom-left. */
        .pl-hero { position: relative; background-size: cover; background-position: 50% 32%; }
        .pl-hero::after { content: ''; position: absolute; inset: 0; background: color-mix(in srgb, var(--accent-hover) 18%, transparent); }
        .pl-hero-close { position: absolute; top: 18px; right: 18px; z-index: 3; width: 38px; height: 38px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; border: none; background: var(--bg-card-solid); color: var(--text-primary); cursor: pointer; box-shadow: none; }
        .pl-hero-close:hover { background: var(--bg-card-solid); }
        /* Value panel over the hero photo: a readable scrim rather than
           floating cards, so the copy stays legible on any background image. */
        .pl-promo { position: absolute; z-index: 2; left: 0; right: 0; bottom: 0; padding: 92px 34px 34px; background: linear-gradient(180deg, rgba(2, 26, 45, 0) 0%, rgba(2, 26, 45, 0.55) 30%, rgba(2, 26, 45, 0.9) 62%, rgba(2, 26, 45, 0.95) 100%); color: var(--color-white); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35); }
        .pl-promo-eyebrow { display: block; color: #fff; font-size: 11px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; opacity: 0.82; }
        .pl-promo-title { margin: 9px 0 0; color: #fff; font-family: var(--font-platform); font-size: 25px; line-height: 1.24; font-weight: 800; letter-spacing: -0.02em; max-width: 22ch; }
        .pl-promo-points { margin: 16px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 9px; }
        .pl-promo-points li { display: flex; color: #fff; align-items: center; gap: 9px; font-size: 13px; font-weight: 600; opacity: 0.94; }
        .pl-promo-points svg { flex: none; opacity: 0.9; }

        .pl-spin { width: 13px; height: 13px; border: 2px solid var(--accent-border); border-top-color: var(--accent-primary); border-radius: 50%; display: inline-block; animation: pl-rot .7s linear infinite; }
        .pl-spin-light { border-color: rgba(255,255,255,0.4); border-top-color: #fff; }
        @keyframes pl-rot { to { transform: rotate(360deg); } }

        @media (max-width: 860px) {
          .pl-split { grid-template-columns: 1fr; height: auto; max-width: 460px; }
          .pl-hero { display: none; }
          .pl-pane { padding: 28px 26px; }
          .pl-form-close { display: inline-flex; }
        }
      `}</style>
    </div>
  );
}

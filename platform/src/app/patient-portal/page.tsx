'use client';

import Link from 'next/link';
import { useState, useEffect, useMemo, useCallback } from 'react';
import Modal from '@/components/Modal';
import {
  User, Calendar, FileText, FlaskConical, Syringe,
  Pill, Scan,
  ChevronRight, Search, AlertTriangle,
  MessageSquare, ArrowRight, Activity,
  Plus, X, LogOut, Send,
  Wallet, CreditCard, Phone, Banknote,
  CheckCircle2,
  Eye, EyeOff, Lock,
  Receipt,
  UserCircle,
  Video,
} from '@/components/icons/lucide';
import type { PatientDoc, AppointmentDoc, LabResultDoc, MedicalRecordDoc, PrescriptionDoc, ImmunizationDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatMoney, formatClockTime , formatRxSig } from '@/lib/format-utils';
import Select from '@/components/Select';

type Tab = 'overview' | 'appointments' | 'records' | 'lab' | 'prescriptions' | 'radiology' | 'immunizations' | 'messages' | 'chat' | 'billing' | 'profile';

// Only used now for the demo bank-transfer detail fallback in the billing flow
// below (shown when a facility hasn't configured real bank details) — the
// login screen's demo scaffolding (Demo Accounts panel, ?demo= auto-login)
// has been removed in favor of a single real username/password account.
const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';
const PATIENT_PORTAL_SESSION_KEY = 'tamamhealth-patient-portal-session';

type PatientPortalSession = {
  token: string;
  patient: PatientDoc;
};

function readPatientPortalSession(): PatientPortalSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(PATIENT_PORTAL_SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PatientPortalSession;
    if (!parsed.token || !parsed.patient?._id) return null;
    return parsed;
  } catch {
    window.sessionStorage.removeItem(PATIENT_PORTAL_SESSION_KEY);
    return null;
  }
}

// The `storage` event only fires in OTHER tabs, so a same-tab sign-in/out
// won't reach the layout header. Emit a same-tab event alongside every write
// so the header user chip updates immediately without a reload.
const PATIENT_PORTAL_SESSION_EVENT = 'patient-portal-session-change';

function writePatientPortalSession(session: PatientPortalSession): void {
  window.sessionStorage.setItem(PATIENT_PORTAL_SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(PATIENT_PORTAL_SESSION_EVENT));
}

function clearPatientPortalSession(): void {
  window.sessionStorage.removeItem(PATIENT_PORTAL_SESSION_KEY);
  window.dispatchEvent(new Event(PATIENT_PORTAL_SESSION_EVENT));
}

async function patientPortalFetch<T>(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    if (response.status === 401) clearPatientPortalSession();
    let message = 'Request failed';
    try {
      const body = await response.json() as { error?: string };
      message = body.error || message;
    } catch {
      // keep generic message
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

/* ═════════════════════════════════════════
   PATIENT LOGIN SCREEN
   ═════════════════════════════════════════ */
function PatientLogin({ onLogin }: { onLogin: (patient: PatientDoc) => void }) {
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

/* ═════════════════════════════════════════
   PATIENT PORTAL (authenticated)
   ═════════════════════════════════════════ */
export default function PatientPortalPage() {
  const { t } = useTranslation();
  const [patient, setPatient] = useState<PatientDoc | null>(null);
  const [checking, setChecking] = useState(true);

  // Check for existing session. A `?demo=<id>` deep link from the staff login
  // picker names a specific patient — if the stored session belongs to someone
  // else, drop it so PatientLogin's auto-login can switch accounts; otherwise
  // clicking a second demo patient would silently keep the first one's session.
  useEffect(() => {
    const session = readPatientPortalSession();
    const demoId = new URLSearchParams(window.location.search).get('demo');
    if (session && demoId && session.patient?._id !== demoId) {
      clearPatientPortalSession();
    } else if (session) {
      setPatient(session.patient);
    }
    setChecking(false);
  }, []);

  const handleLogout = useCallback(() => {
    clearPatientPortalSession();
    setPatient(null);
  }, []);

  if (checking) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('status.loading')}</p>
      </div>
    );
  }

  if (!patient) {
    return <PatientLogin onLogin={setPatient} />;
  }

  return <PatientDashboard patient={patient} onLogout={handleLogout} />;
}

/* ═════════════════════════════════════════
   PATIENT DASHBOARD
   ═════════════════════════════════════════ */

// Short month names for the design's date plates ("27 / AUG") and vitals
// sublines ("13 Aug · Post-natal check"). Chrome-level formatting, English
// like the rest of the portal chrome.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dateParts(iso: string): { day: string; mon: string } {
  const [, m, d] = (iso || '').split('-');
  return { day: d || '—', mon: MONTHS[Number(m) - 1] || '' };
}
function shortDate(iso: string): string {
  const { day, mon } = dateParts(iso);
  return mon ? `${Number(day)} ${mon}` : iso;
}

function PatientDashboard({ patient, onLogout }: { patient: PatientDoc; onLogout: () => void }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [appointments, setAppointments] = useState<AppointmentDoc[]>([]);
  const [labResults, setLabResults] = useState<LabResultDoc[]>([]);
  const [records, setRecords] = useState<MedicalRecordDoc[]>([]);
  const [prescriptions, setPrescriptions] = useState<PrescriptionDoc[]>([]);
  const [immunizations, setImmunizations] = useState<ImmunizationDoc[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showBooking, setShowBooking] = useState(false);
  const [sessionToken, setSessionToken] = useState('');

  // Transient confirmation toast (bottom-center, per the design). Only fired
  // after an action actually persisted — never to fake a success.
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  // Load patient-specific data
  useEffect(() => {
    const session = readPatientPortalSession();
    if (!session) {
      onLogout();
      return;
    }
    setSessionToken(session.token);
    (async () => {
      try {
        const [apts, labs, recs, rxs, imms] = await Promise.all([
          patientPortalFetch<{ appointments: AppointmentDoc[] }>('/api/patient-portal/appointments', session.token),
          patientPortalFetch<{ results: LabResultDoc[] }>('/api/patient-portal/labs', session.token),
          patientPortalFetch<{ records: MedicalRecordDoc[] }>('/api/patient-portal/records', session.token),
          patientPortalFetch<{ prescriptions: PrescriptionDoc[] }>('/api/patient-portal/prescriptions', session.token),
          patientPortalFetch<{ immunizations: ImmunizationDoc[] }>('/api/patient-portal/immunizations', session.token),
        ]);
        setAppointments(apts.appointments);
        setLabResults(labs.results);
        setRecords(recs.records);
        setPrescriptions(rxs.prescriptions);
        setImmunizations(imms.immunizations);
      } catch (err) { console.error('Failed to load patient data:', err); }
    })();
  }, [onLogout, patient._id]);

  const upcomingApts = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return appointments.filter(a => a.appointmentDate >= today && a.status !== 'cancelled' && a.status !== 'no_show');
  }, [appointments]);

  // `registrationHospitalName` isn't on the `PatientDoc` type but the seed/
  // registration data carries it alongside the hospital id — fall back to the
  // id itself only if the name was never recorded.
  const patientFacilityName = (patient as { registrationHospitalName?: string }).registrationHospitalName
    || patient.registrationHospital
    || '';

  const [bookingDate, setBookingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bookingTime, setBookingTime] = useState<'morning' | 'afternoon' | 'any'>('any');
  const [bookingDepartment, setBookingDepartment] = useState('General / OPD');
  const [bookingReason, setBookingReason] = useState('');
  const [bookingVisitType, setBookingVisitType] = useState<'in_person' | 'telehealth_video' | 'telehealth_audio'>('in_person');
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const resetBookingForm = () => {
    setBookingDate(new Date().toISOString().slice(0, 10));
    setBookingTime('any');
    setBookingDepartment('General / OPD');
    setBookingReason('');
    setBookingVisitType('in_person');
    setBookingError(null);
  };

  const handleSubmitBooking = async () => {
    if (bookingSubmitting) return;
    setBookingSubmitting(true);
    setBookingError(null);
    try {
      const session = readPatientPortalSession();
      if (!session) throw new Error('Missing patient session');
      const timeOfDay: Record<typeof bookingTime, string> = { morning: '09:00', afternoon: '14:00', any: '' };
      const { appointment } = await patientPortalFetch<{ appointment: AppointmentDoc }>(
        '/api/patient-portal/appointments',
        session.token,
        {
          method: 'POST',
          body: JSON.stringify({
            patientPhone: patient.phone || '',
            facilityId: patient.registrationHospital || '',
            facilityName: patientFacilityName,
            appointmentDate: bookingDate,
            appointmentTime: timeOfDay[bookingTime],
            department: bookingDepartment,
            reason: bookingReason,
            appointmentType: bookingVisitType === 'in_person' ? 'general' : 'telehealth',
            state: patient.state || '',
          }),
        }
      );
      setAppointments(prev => [...prev, appointment]);
      setShowBooking(false);
      resetBookingForm();
      setToast('Appointment request sent — the facility will confirm it');
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : t('patientPortal.bookingRequestError'));
    } finally {
      setBookingSubmitting(false);
    }
  };

  const [chatDepartment, setChatDepartment] = useState('General / OPD');

  // ── Sidebar navigation, in the design's three groups. Group titles are
  // chrome copy (hardcoded English, like the rail and search placeholder).
  const pendingLabCount = labResults.filter(l => l.status === 'pending').length;
  type NavItem = { key: Tab; label: string; icon: typeof User; count?: number; orange?: boolean };
  const navGroups: { title: string; items: NavItem[] }[] = [
    { title: 'Home', items: [{ key: 'overview', label: t('patientPortal.tabOverview'), icon: Activity }] },
    {
      title: 'My health record',
      items: [
        { key: 'records', label: t('patientPortal.tabMedicalRecords'), icon: FileText, count: records.length },
        { key: 'prescriptions', label: t('patientPortal.tabPrescriptions'), icon: Pill },
        { key: 'lab', label: t('patientPortal.tabLabResults'), icon: FlaskConical, count: pendingLabCount, orange: true },
        { key: 'radiology', label: t('patientPortal.tabRadiology'), icon: Scan },
        { key: 'immunizations', label: t('patientPortal.tabImmunizations'), icon: Syringe },
      ],
    },
    {
      title: 'Care & payments',
      items: [
        { key: 'appointments', label: t('patientPortal.tabAppointments'), icon: Calendar, count: upcomingApts.length },
        { key: 'billing', label: t('patientPortal.tabBilling'), icon: Wallet },
        { key: 'chat', label: t('patientPortal.tabMessages'), icon: MessageSquare },
        { key: 'profile', label: t('patientPortal.tabMyProfile'), icon: UserCircle },
      ],
    },
  ];
  const tabs = navGroups.flatMap(g => g.items);

  type ChatMsg = { id?: string; text: string; from: 'patient' | 'system'; time: string };
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([
    { text: t('patientPortal.chatWelcome', { name: patient.firstName }), from: 'system', time: '09:00' },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // Load any existing messages on this patient record so the conversation
  // history survives page reloads (rather than only living in component
  // state). Anything authored by `fromDoctorId === 'patient'` is rendered as
  // a patient-side bubble; everything else is a staff/system reply.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = readPatientPortalSession();
        if (!session) return;
        const { messages: docs } = await patientPortalFetch<{ messages: Array<{ _id?: string; body: string; fromDoctorId?: string; sentAt?: string; createdAt?: string }> }>(
          '/api/patient-portal/messages',
          session.token
        );
        if (cancelled) return;
        const formatted: ChatMsg[] = docs
          .slice() // getMessagesByPatient returns newest-first; flip so newest is at the bottom
          .sort((a, b) => (a.sentAt || '').localeCompare(b.sentAt || ''))
          .map(m => ({
            id: m._id,
            text: m.body,
            from: m.fromDoctorId === 'patient' ? 'patient' : 'system',
            time: new Date(m.sentAt || m.createdAt || Date.now())
              .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }));
        if (formatted.length > 0) {
          setChatMessages(formatted);
        }
      } catch (err) {
        // History load is best-effort — fall back to the welcome stub.
        console.error('[patient-portal] load messages failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSendChat = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || chatSending) return;
    setChatSending(true);
    setChatError(null);
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Optimistically render the patient bubble so the UI feels instant.
    // We tag it with a temporary id so the post-persist replacement is safe.
    const tempId = `pending-${now.getTime()}`;
    setChatMessages(prev => [...prev, { id: tempId, text: trimmed, from: 'patient', time }]);
    setChatInput('');

    try {
      const session = readPatientPortalSession();
      if (!session) throw new Error('Missing patient session');
      const { message: saved } = await patientPortalFetch<{ message: { _id: string; body: string } }>(
        '/api/patient-portal/messages',
        session.token,
        {
          method: 'POST',
          body: JSON.stringify({
            patientPhone: patient.phone || '',
            recipientDepartment: chatDepartment,
            recipientHospitalId: patient.registrationHospital || '',
            recipientHospitalName: patientFacilityName,
            fromHospitalId: patient.registrationHospital || '',
            fromHospitalName: patientFacilityName,
            subject: `Patient message — ${chatDepartment}`,
            body: trimmed,
            sentAt: now.toISOString(),
          }),
        }
      );
      // Replace the optimistic entry with the persisted one (using the real id).
      setChatMessages(prev => prev.map(m => m.id === tempId
        ? { id: saved._id, text: saved.body, from: 'patient', time }
        : m));
    } catch (err) {
      console.error('[patient-portal] send message failed', err);
      // Roll back the optimistic bubble and surface a real error to the user
      // — better to say "we couldn't deliver that" than to fake a success
      // and leave them thinking the doctor saw it.
      setChatMessages(prev => prev.filter(m => m.id !== tempId));
      setChatInput(trimmed);
      setChatError(t('patientPortal.chatSendError'));
    } finally {
      setChatSending(false);
    }
  };

  // ── Header chrome: user menu + portal-wide search ──
  // The search indexes the patient's own data (already loaded for the tabs)
  // and jumps to the tab that holds the match. Chrome copy is hardcoded
  // English to match the staff top rail, which does the same.
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  // Computed inline (not memoized): the source arrays are rebuilt each render
  // anyway, and the scan is over at most a few hundred short strings.
  const searchResults = (() => {
    const q = searchQ.trim().toLowerCase();
    if (q.length < 2) return [];
    const hits: { key: string; tab: Tab; title: string; sub: string }[] = [];
    tabs.forEach(tb => {
      if (tb.label.toLowerCase().includes(q)) hits.push({ key: `tab-${tb.key}`, tab: tb.key, title: tb.label, sub: 'Section' });
    });
    prescriptions.forEach(rx => {
      if (rx.medication?.toLowerCase().includes(q)) hits.push({ key: `rx-${rx._id}`, tab: 'prescriptions', title: rx.medication, sub: `Prescription · ${rx.status}` });
    });
    labResults.forEach(lab => {
      if (lab.testName?.toLowerCase().includes(q)) hits.push({ key: `lab-${lab._id}`, tab: 'lab', title: lab.testName, sub: `Lab result · ${lab.status}` });
    });
    records.forEach(rec => {
      const r = rec as unknown as { visitType?: string; diagnoses?: Array<{ name?: string }> };
      const diag = (r.diagnoses || []).map(d => d.name || '').join(', ');
      if (r.visitType?.toLowerCase().includes(q) || diag.toLowerCase().includes(q)) {
        hits.push({ key: `rec-${rec._id}`, tab: 'records', title: r.visitType || 'Visit', sub: diag || `Visit · ${rec.createdAt?.slice(0, 10)}` });
      }
    });
    appointments.forEach(apt => {
      if (apt.reason?.toLowerCase().includes(q) || apt.providerName?.toLowerCase().includes(q)) {
        hits.push({ key: `apt-${apt._id}`, tab: 'appointments', title: apt.reason || apt.appointmentType, sub: `Appointment · ${apt.appointmentDate}` });
      }
    });
    return hits.slice(0, 8);
  })();

  const initials = `${(patient.firstName || ' ')[0]}${(patient.surname || ' ')[0]}`.toUpperCase();
  const goTab = (tab: Tab) => { setActiveTab(tab); setUserMenuOpen(false); setSearchQ(''); setSearchOpen(false); };

  // Appointment status → design chip tone. Past/terminal states go neutral,
  // confirmed goes green, anything still in flight reads as the blue tone.
  const aptChip = (status: AppointmentDoc['status']): { tone: ChipTone; label: string } => {
    if (status === 'completed') return { tone: 'neutral', label: 'Done' };
    if (status === 'cancelled') return { tone: 'neutral', label: 'Cancelled' };
    if (status === 'no_show') return { tone: 'neutral', label: 'No show' };
    if (status === 'confirmed') return { tone: 'green', label: 'Confirmed' };
    return { tone: 'blue', label: String(status).replace('_', ' ') };
  };

  return (
    <div className="pp-shell">

      {/* ── Top bar — brand · facility · search · patient chip. ── */}
      <header className="pp-top">
        <button type="button" className="pp-top-brand" onClick={() => goTab('overview')} aria-label="Patient portal home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/tamamhealth-logo-full-white.svg" alt="Tamam Healthcare System" />
        </button>
        <span className="pp-top-rule" aria-hidden />
        <span className="pp-top-facility" title={patientFacilityName}>{patientFacilityName}</span>

        <div className="pp-search-wrap">
          <label className="pp-search">
            <Search size={14} />
            <input
              value={searchQ}
              onChange={e => { setSearchQ(e.target.value); setSearchOpen(e.target.value.trim().length >= 2); }}
              onFocus={() => setSearchOpen(searchQ.trim().length >= 2)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 120)}
              placeholder="Search your records, results, medications"
              aria-label="Search your records"
              type="search"
            />
            {searchQ && (
              <button type="button" className="pp-search-clear" onClick={() => { setSearchQ(''); setSearchOpen(false); }} aria-label="Clear search">
                <X size={9} strokeWidth={2.4} />
              </button>
            )}
          </label>
          {searchOpen && (
            <div className="pp-pop pp-search-menu">
              {searchResults.length === 0 ? (
                <p>No matches in your records.</p>
              ) : searchResults.map(r => (
                <button key={r.key} type="button" onMouseDown={e => { e.preventDefault(); goTab(r.tab); }}>
                  <strong>{r.title}</strong>
                  <small>{r.sub}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="pp-user-wrap">
          <button type="button" className={`pp-user ${userMenuOpen ? 'active' : ''}`}
            onClick={() => setUserMenuOpen(o => !o)}
            aria-expanded={userMenuOpen} aria-haspopup="menu" title={`${patient.firstName} ${patient.surname}`}>
            <span className="pp-user-mark">
              {patient.photoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={patient.photoUrl} alt="" />
                : initials}
            </span>
            <span className="pp-user-role">Patient</span>
          </button>
          {userMenuOpen && (
            <>
              <div className="pp-scrim" onClick={() => setUserMenuOpen(false)} />
              <div className="pp-pop pp-user-menu" role="menu">
                <div className="pp-user-menu-id" aria-hidden>
                  <b>{patient.firstName} {patient.surname}</b>
                  <small>{patient.hospitalNumber} · {patientFacilityName}</small>
                </div>
                <button type="button" role="menuitem" className="pp-menu-item" onClick={() => goTab('profile')}>
                  <User size={15} /><span>{t('patientPortal.tabMyProfile')}</span>
                </button>
                <button type="button" role="menuitem" className="pp-menu-item danger" onClick={onLogout}>
                  <LogOut size={15} /><span>{t('patientPortal.signOut')}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="pp-body">

        {/* ── Sidebar — three groups per the design; emergencies note pinned
            at the bottom. Collapses to a horizontal strip on small screens. ── */}
        <aside className="pp-side" aria-label="Patient portal sections">
          {navGroups.map(group => (
            <div key={group.title} className="pp-side-group">
              <p className="pp-side-title">{group.title}</p>
              {group.items.map(item => {
                const on = activeTab === item.key;
                return (
                  <button key={item.key} type="button" className={`pp-side-item ${on ? 'active' : ''}`}
                    aria-current={on ? 'page' : undefined} onClick={() => goTab(item.key)}>
                    <item.icon size={15} strokeWidth={1.7} />
                    <span>{item.label}</span>
                    {item.count ? <b className={`pp-side-badge ${item.orange ? 'orange' : ''}`}>{item.count}</b> : null}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="pp-side-foot">
            <p>Emergencies: call 911 or come straight to the facility.</p>
          </div>
        </aside>

        <main className="pp-main">
          <div className="pp-page">

      {/* ═══ Overview ═══ */}
      {activeTab === 'overview' && (() => {
        /* Extract latest vitals from most recent record */
        const sortedRecs = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const latestRec = sortedRecs[0] as unknown as Record<string, unknown> | undefined;
        const vitals = (latestRec?.vitalSigns || {}) as Record<string, string | number>;
        const latestDate = latestRec?.createdAt ? String(latestRec.createdAt).slice(0, 10) : null;
        const latestVisitType = (latestRec?.visitType as string) || t('patientPortal.consultation');

        const activeRx = prescriptions.slice(0, 3);

        /* Recent activity — visits and lab results interleaved, newest first. */
        const activity: { key: string; what: string; when: string }[] = [];
        records.slice(0, 3).forEach(rec => {
          const r = rec as unknown as Record<string, unknown>;
          activity.push({ key: `rec-${rec._id}`, what: `${t('patientPortal.consultation')} — ${(r.visitType as string) || t('patientPortal.generalCheckup')}`, when: rec.createdAt?.slice(0, 10) || '' });
        });
        labResults.slice(0, 3).forEach(lab => {
          activity.push({ key: `lab-${lab._id}`, what: `${lab.status === 'completed' ? 'Lab result released' : 'Lab test ordered'} — ${lab.testName}`, when: (lab.orderedAt || lab.createdAt).slice(0, 10) });
        });
        activity.sort((a, b) => b.when.localeCompare(a.when));

        // Seed/registration data uses 'None' / 'None known' as explicit
        // placeholders — those are the *absence* of an alert, not an alert.
        const realAllergies = (patient.allergies || []).filter(a => a && !/^none\b/i.test(a));
        const realConditions = (patient.chronicConditions || []).filter(c => c && !/^none\b/i.test(c));
        const hasCritical = labResults.some(l => l.critical);

        /* Things to do — only real, actionable items derived from the data
           already loaded; each jumps to the tab where the action lives. */
        const today = new Date().toISOString().slice(0, 10);
        const dueImm = immunizations.find(im => im.nextDueDate && im.nextDueDate >= today);
        const todos: { key: string; label: string; sub: string; icon: typeof User; amber?: boolean; go: () => void }[] = [];
        if (upcomingApts[0]) {
          const next = upcomingApts[0];
          todos.push({ key: 'apt', label: 'Your next visit', sub: `${shortDate(next.appointmentDate)}${next.appointmentTime ? ` · ${formatClockTime(next.appointmentTime)}` : ''} · ${next.department}`, icon: Calendar, go: () => goTab('appointments') });
        }
        if (pendingLabCount > 0) {
          todos.push({ key: 'lab', label: 'Lab results in progress', sub: `${pendingLabCount} pending review`, icon: FlaskConical, amber: true, go: () => goTab('lab') });
        }
        if (dueImm) {
          todos.push({ key: 'imm', label: `Book ${dueImm.vaccine} — ${t('patientPortal.doseNumber', { number: dueImm.doseNumber + 1 })}`, sub: `Due ${shortDate(dueImm.nextDueDate!)}`, icon: Syringe, go: () => goTab('immunizations') });
        }
        if (sortedRecs[0]) {
          todos.push({ key: 'rec', label: 'Read your visit summary', sub: `${latestVisitType} · ${shortDate(latestDate || '')}`, icon: FileText, go: () => goTab('records') });
        }

        const hour = new Date().getHours();
        const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
        const todayLine = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        const vitalDefs = [
          { key: 'bloodPressure', label: t('patientPortal.bloodPressure'), unit: 'mmHg' },
          { key: 'heartRate', label: t('patientPortal.heartRate'), unit: 'bpm' },
          { key: 'temperature', label: t('patientPortal.temperature'), unit: '°C' },
          { key: 'weight', label: t('patientPortal.weight'), unit: 'kg' },
          { key: 'respiratoryRate', label: t('patientPortal.respRate'), unit: '/min' },
          { key: 'oxygenSaturation', label: 'SpO₂', unit: '%' },
        ].filter(v => vitals[v.key]);

        return (
        <div>
          <div className="pp-head">
            <div>
              <h1>{greeting}, {patient.firstName}</h1>
              <p className="pp-head-note">{patientFacilityName} · {todayLine}</p>
            </div>
            <div className="pp-head-actions">
              <button type="button" className="pp-btn pp-btn-primary" onClick={() => setShowBooking(true)}>
                <Calendar size={15} strokeWidth={1.8} /> {t('patientPortal.bookAppointment')}
              </button>
              <button type="button" className="pp-btn pp-btn-secondary" onClick={() => goTab('chat')}>
                <MessageSquare size={15} strokeWidth={1.8} /> Message care team
              </button>
            </div>
          </div>

          {/* Things to do */}
          {todos.length > 0 && (
            <div className="pp-card" style={{ marginBottom: 14 }}>
              <div className="pp-card-head">
                <h2>Things to do</h2>
                <small>{todos.length} open</small>
              </div>
              <div className="pp-todos">
                {todos.map(td => (
                  <button key={td.key} type="button" className="pp-todo" onClick={td.go}>
                    <span className={`pp-todo-ic ${td.amber ? 'amber' : ''}`}>
                      <td.icon size={15} strokeWidth={1.8} />
                    </span>
                    <span className="pp-todo-body">
                      <b>{td.label}</b>
                      <small>{td.sub}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Latest vitals */}
          {vitalDefs.length > 0 && (
            <div className="pp-tiles">
              {vitalDefs.map(v => (
                <div key={v.key} className="pp-tile">
                  <p className="pp-tile-label">{v.label}</p>
                  <p className="pp-tile-value">{String(vitals[v.key])} <small>{v.unit}</small></p>
                  {latestDate && <p className="pp-tile-sub">{shortDate(latestDate)} · {latestVisitType}</p>}
                </div>
              ))}
            </div>
          )}

          <div className="pp-grid2">
            {/* Upcoming appointments */}
            <div className="pp-card">
              <div className="pp-card-head">
                <h2>{t('patientPortal.upcomingAppointments')}</h2>
                <button type="button" className="pp-card-link" onClick={() => goTab('appointments')}>All ›</button>
              </div>
              {upcomingApts.length > 0 ? upcomingApts.slice(0, 3).map(apt => {
                const { day, mon } = dateParts(apt.appointmentDate);
                const chip = aptChip(apt.status);
                return (
                  <div key={apt._id} className="pp-row" style={{ padding: '11px 14px' }}>
                    <div className="pp-date-plate">
                      <b>{day}</b>
                      <small>{mon}</small>
                    </div>
                    <div className="pp-row-main">
                      <b style={{ fontSize: 13 }}>{apt.reason || apt.appointmentType}</b>
                      <span style={{ fontSize: 11.5 }}>{apt.appointmentTime ? `${formatClockTime(apt.appointmentTime)} · ` : ''}{apt.providerName ? `${/^dr\.?\s/i.test(apt.providerName) ? apt.providerName : `${t('patientPortal.drPrefix')} ${apt.providerName}`} · ` : ''}{apt.department}</span>
                    </div>
                    <span className={`pp-chip pp-chip--${chip.tone}`}>{chip.label}</span>
                  </div>
                );
              }) : (
                <div style={{ padding: '14px', fontSize: 12, color: '#5B6B7E' }}>
                  {t('patientPortal.noUpcomingAppointments')}
                </div>
              )}
            </div>

            {/* Current medications */}
            <div className="pp-card">
              <div className="pp-card-head"><h2>{t('patient.medications')}</h2></div>
              {activeRx.length > 0 ? activeRx.map(rx => (
                <div key={rx._id} className="pp-row" style={{ padding: '10px 14px' }}>
                  <div className="pp-row-main">
                    <b style={{ fontSize: 13 }}>{rx.medication}</b>
                    <span style={{ fontSize: 11.5 }}>{formatRxSig(rx)}</span>
                  </div>
                  <span style={{ flex: 'none', fontSize: 11, color: 'var(--ehr-muted)', whiteSpace: 'nowrap', textTransform: 'capitalize' }}>{rx.status}</span>
                </div>
              )) : (
                <div style={{ padding: '14px', fontSize: 12, color: '#5B6B7E' }}>{t('patientPortal.noMedications')}</div>
              )}
              <button type="button" className="pp-card-foot" onClick={() => goTab('prescriptions')}>All prescriptions ›</button>
            </div>

            {/* Health alerts */}
            <div className="pp-card">
              <div className="pp-card-head"><h2>{t('patientPortal.healthAlerts')}</h2></div>
              {realAllergies.length === 0 && realConditions.length === 0 && pendingLabCount === 0 && !hasCritical ? (
                <div style={{ padding: '14px', fontSize: 12, color: '#15795C' }}>{t('patientPortal.noHealthAlerts')}</div>
              ) : (
                <>
                  {realAllergies.length > 0 && (
                    <div className="pp-row" style={{ alignItems: 'flex-start', padding: '11px 14px' }}>
                      <i className="pp-dot" style={{ background: '#8B2E24' }} />
                      <div className="pp-row-main">
                        <b style={{ fontSize: 13 }}>{t('patient.allergies')}</b>
                        <span style={{ fontSize: 11.5, lineHeight: 1.45 }}>{realAllergies.join(', ')}</span>
                      </div>
                    </div>
                  )}
                  {realConditions.map((c, i) => (
                    <div key={i} className="pp-row" style={{ alignItems: 'flex-start', padding: '11px 14px' }}>
                      <i className="pp-dot" style={{ background: '#9C5E16' }} />
                      <div className="pp-row-main">
                        <b style={{ fontSize: 13 }}>{c}</b>
                        <span style={{ fontSize: 11.5 }}>{t('patient.chronicConditions')}</span>
                      </div>
                    </div>
                  ))}
                  {hasCritical && (
                    <div className="pp-row" style={{ alignItems: 'flex-start', padding: '11px 14px' }}>
                      <i className="pp-dot" style={{ background: '#8B2E24' }} />
                      <div className="pp-row-main">
                        <b style={{ fontSize: 13 }}>{t('patientPortal.criticalLabAlert')}</b>
                        <span style={{ fontSize: 11.5 }}>{t('patientPortal.tabLabResults')}</span>
                      </div>
                    </div>
                  )}
                  {pendingLabCount > 0 && (
                    <div className="pp-row" style={{ alignItems: 'flex-start', padding: '11px 14px' }}>
                      <i className="pp-dot" style={{ background: 'var(--accent-primary)' }} />
                      <div className="pp-row-main">
                        <b style={{ fontSize: 13 }}>{t('patientPortal.pendingLabResults', { count: pendingLabCount })}</b>
                        <span style={{ fontSize: 11.5 }}>Results are released after your clinician reviews them.</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Recent activity */}
            <div className="pp-card">
              <div className="pp-card-head"><h2>{t('patientPortal.recentActivity')}</h2></div>
              {activity.length > 0 ? activity.slice(0, 4).map(ac => (
                <div key={ac.key} className="pp-activity-row">
                  <span>{ac.what}</span>
                  <small>{shortDate(ac.when)}</small>
                </div>
              )) : (
                <div style={{ padding: '14px', fontSize: 12, color: '#5B6B7E' }}>{t('patientPortal.noRecentActivity')}</div>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {/* ═══ Appointments ═══ */}
      {activeTab === 'appointments' && (
        <div>
          <div className="pp-head">
            <div>
              <h1>{t('patientPortal.tabAppointments')}</h1>
              <p className="pp-head-note">Upcoming and past visits.</p>
            </div>
            <button type="button" className="pp-btn pp-btn-primary" onClick={() => setShowBooking(true)}>{t('patientPortal.bookAppointment')}</button>
          </div>
          {appointments.length === 0 ? (
            <Empty icon={Calendar} text={t('patientPortal.noAppointmentsYet')} action={t('patientPortal.bookAppointment')} onAction={() => setShowBooking(true)} />
          ) : (
            <div className="pp-card">
              {appointments.slice().sort((a, b) => b.appointmentDate.localeCompare(a.appointmentDate)).map(apt => {
                const isPast = apt.status === 'completed' || apt.status === 'cancelled' || apt.status === 'no_show';
                const chip = aptChip(apt.status);
                // KAN-124: the server attaches a join path only for live
                // telehealth appointments with a usable session — this
                // button is the patient's entry point to the video visit.
                const joinPath = (apt as AppointmentDoc & { telehealth?: { joinPath: string } }).telehealth?.joinPath;
                return (
                  <div key={apt._id} className="pp-row">
                    <div className="pp-row-main">
                      <b>{apt.reason || apt.appointmentType}{apt.providerName ? ` — ${/^dr\.?\s/i.test(apt.providerName) ? apt.providerName : `${t('patientPortal.drPrefix')} ${apt.providerName}`}` : ''}</b>
                      <span>{shortDate(apt.appointmentDate)}{apt.appointmentTime ? ` · ${formatClockTime(apt.appointmentTime)}` : ''} · {apt.department}</span>
                    </div>
                    {joinPath && !isPast && (
                      <a href={joinPath} className="pp-row-pay" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
                        <Video size={13} /> {t('patientPortal.joinVideoVisit')}
                      </a>
                    )}
                    <span className={`pp-chip pp-chip--${chip.tone}`}>{chip.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ Records ═══ */}
      {activeTab === 'records' && (
        <div>
          <div className="pp-head">
            <div>
              <h1>{t('patientPortal.tabMedicalRecords')}</h1>
              <p className="pp-head-note">Notes and visit summaries your clinicians have shared with you.</p>
            </div>
          </div>
          {records.length === 0 ? (
            <Empty icon={FileText} text={t('patientPortal.noMedicalRecords')} />
          ) : (
            <div className="pp-card">
              {records.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(rec => {
                const r = rec as unknown as Record<string, unknown>;
                const vitalSigns = r.vitalSigns as Record<string, unknown> | undefined;
                const recRx = (r.prescriptions as Array<{ medication: string; dosage: string }> | undefined) || [];
                const open = expandedId === rec._id;
                return (
                  <div key={rec._id} style={{ borderBottom: '1px solid #EDF2F7' }}>
                    <button type="button" className="pp-row-toggle" onClick={() => setExpandedId(open ? null : rec._id)}>
                      <div className="pp-row-main">
                        <b>{(r.visitType as string) || t('patientPortal.consultation')}</b>
                        <span>{shortDate(rec.createdAt?.slice(0, 10) || '')} · {((r.diagnoses as Array<{ name: string }>) || []).map(d => d.name).join(', ') || t('patientPortal.noDiagnosisRecorded')}</span>
                      </div>
                      <span className="pp-row-action" aria-hidden>
                        View <ChevronRight size={12} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                      </span>
                    </button>
                    {open && (
                      <div className="pp-row-detail">
                        <div className="pp-row-detail-box" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                          {vitalSigns && (
                            <div>
                              <p className="pp-field-label" style={{ margin: 0 }}>{t('patientPortal.vitalSigns')}</p>
                              {Object.entries(vitalSigns)
                                .filter(([k, v]) => v && k !== 'recordedAt')
                                .map(([k, v]) => (
                                  // camelCase key → spaced lowercase label ("respiratoryRate" → "respiratory rate")
                                  <p key={k} className="pp-field-value">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}: <strong>{String(v)}</strong></p>
                                ))}
                            </div>
                          )}
                          {recRx.filter(rx => rx.medication).length > 0 && (
                            <div>
                              <p className="pp-field-label" style={{ margin: 0 }}>{t('patientPortal.tabPrescriptions')}</p>
                              {recRx.filter(rx => rx.medication).map((rx, i) => (
                                <p key={i} className="pp-field-value">{rx.medication}{rx.dosage ? ` — ${rx.dosage}` : ''}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ Lab Results ═══ */}
      {activeTab === 'lab' && (
        <div>
          <div className="pp-head">
            <div>
              <h1>{t('patientPortal.tabLabResults')}</h1>
              <p className="pp-head-note">Results are released after your clinician reviews them.</p>
            </div>
          </div>
          {labResults.length === 0 ? (
            <Empty icon={FlaskConical} text={t('patientPortal.noLabResults')} />
          ) : (
            <div className="pp-card">
              {labResults.slice().sort((a, b) => (b.orderedAt || b.createdAt).localeCompare(a.orderedAt || a.createdAt)).map(lab => {
                const open = expandedId === lab._id;
                const chip = lab.status === 'pending'
                  ? { tone: 'yellow' as ChipTone, label: 'Pending review' }
                  : lab.status === 'completed'
                    ? (lab.abnormal ? { tone: 'red' as ChipTone, label: t('patientPortal.abnormal') } : { tone: 'green' as ChipTone, label: t('patientPortal.normal') })
                    : { tone: 'neutral' as ChipTone, label: lab.status };
                return (
                  <div key={lab._id} style={{ borderBottom: '1px solid #EDF2F7' }}>
                    <button type="button" className="pp-row-toggle" onClick={() => setExpandedId(open ? null : lab._id)}>
                      <div className="pp-row-main">
                        <b>{lab.testName}</b>
                        <span>{shortDate((lab.orderedAt || lab.createdAt).slice(0, 10))}{lab.specimen ? ` · ${lab.specimen}` : ''}{lab.orderedBy ? ` · ${lab.orderedBy}` : ''}</span>
                      </div>
                      <span className={`pp-chip pp-chip--${chip.tone}`}>{chip.label}</span>
                      {lab.status === 'completed' && (
                        <span className="pp-row-action" aria-hidden>
                          View <ChevronRight size={12} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                        </span>
                      )}
                    </button>
                    {open && lab.status === 'completed' && (
                      <div className="pp-row-detail">
                        <div className="pp-row-detail-box" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <div>
                            <p className="pp-field-label" style={{ margin: 0 }}>{t('patientPortal.result')}</p>
                            <p style={{ margin: '2px 0 0', fontFamily: 'var(--font-condensed)', fontSize: 17, fontWeight: 600, color: lab.abnormal ? '#8B2E24' : '#0E2A4A' }}>{lab.result}</p>
                          </div>
                          {lab.referenceRange && (
                            <div style={{ textAlign: 'right' }}>
                              <p className="pp-field-label" style={{ margin: 0 }}>{t('patientPortal.reference')}</p>
                              <p className="pp-field-value">{lab.referenceRange} {lab.unit}</p>
                            </div>
                          )}
                        </div>
                        {lab.critical && (
                          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <AlertTriangle size={12} style={{ color: '#8B2E24' }} />
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: '#8B2E24' }}>{t('patientPortal.criticalResult')}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ Prescriptions ═══ */}
      {activeTab === 'prescriptions' && (
        <div>
          <div className="pp-head">
            <div>
              <h1>{t('patientPortal.tabPrescriptions')}</h1>
              <p className="pp-head-note">What you have been prescribed, and what each is for.</p>
            </div>
          </div>
          {prescriptions.length === 0 ? (
            <Empty icon={Pill} text={t('patientPortal.noPrescriptions')} />
          ) : (
            <div className="pp-card">
              {prescriptions.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(rx => (
                <div key={rx._id} className="pp-row">
                  <div className="pp-row-main">
                    <b>{rx.medication}</b>
                    <span>{formatRxSig(rx)}{rx.prescribedBy ? ` · ${t('patientPortal.prescribedBy', { name: rx.prescribedBy })}` : ''}</span>
                  </div>
                  <span className="pp-row-value">{shortDate(rx.createdAt.slice(0, 10))}</span>
                  <span className={`pp-chip pp-chip--${rx.status === 'dispensed' ? 'green' : 'yellow'}`}>{rx.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ Radiology & Imaging ═══ */}
      {activeTab === 'radiology' && (
        <div>
          <div className="pp-head">
            <div>
              <h1>{t('patientPortal.tabRadiology')}</h1>
              {/* Honesty note: these are imaging-related order/report records
                  pulled from lab results — NOT the actual scan images. */}
              <p className="pp-head-note">{t('patientPortal.imagingDisclaimer')}</p>
            </div>
          </div>
          {(() => {
            const imagingTests = labResults.filter(l =>
              /x-ray|xray|mri|ct scan|ultrasound|radiology|imaging|echo|mammogram/i.test(l.testName || '')
            );
            return imagingTests.length > 0 ? (
              <div className="pp-card">
                {imagingTests.map(img => (
                  <div key={img._id} className="pp-row">
                    <div className="pp-row-main">
                      <b>{img.testName}</b>
                      <span>{shortDate((img.orderedAt || img.createdAt).slice(0, 10))}{img.orderedBy ? ` · ${img.orderedBy}` : ''}</span>
                    </div>
                    <span className={`pp-chip pp-chip--${img.status === 'pending' ? 'yellow' : 'green'}`}>{img.status === 'pending' ? 'Pending' : 'Reported'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <Empty icon={Scan} text={t('patientPortal.noImagingResults')} />
                <div className="pp-card" style={{ marginTop: 14 }}>
                  <div className="pp-card-head"><h2>{t('patientPortal.availableImagingServices')}</h2></div>
                  {['X-Ray', 'Ultrasound', 'CT Scan', 'MRI', 'Echocardiogram', 'Mammogram'].map(svc => (
                    <div key={svc} className="pp-row">
                      <div className="pp-row-main">
                        <b>{svc}</b>
                        <span>{t('patientPortal.imagingNotice')}</span>
                      </div>
                      <span className="pp-chip pp-chip--blue">Service</span>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ═══ Billing & Payments ═══ */}
      {activeTab === 'billing' && <BillingTab patient={patient} sessionToken={sessionToken} />}

      {/* ═══ Immunizations ═══ */}
      {activeTab === 'immunizations' && (
        <div>
          <div className="pp-head">
            <div>
              <h1>{t('patientPortal.tabImmunizations')}</h1>
              <p className="pp-head-note">{t('patientPortal.immunizationNotice')}</p>
            </div>
          </div>
          {immunizations.length === 0 ? (
            <Empty icon={Syringe} text={t('patientPortal.noImmunizations')} />
          ) : (
            <div className="pp-card">
              {immunizations.slice().sort((a, b) => b.dateGiven.localeCompare(a.dateGiven)).map(imm => {
                const today = new Date().toISOString().slice(0, 10);
                const due = imm.nextDueDate && imm.nextDueDate >= today;
                return (
                  <div key={imm._id} className="pp-row">
                    <div className="pp-row-main">
                      <b>{imm.vaccine} — {t('patientPortal.doseNumber', { number: imm.doseNumber })}</b>
                      <span>{t('patientPortal.siteBatch', { site: imm.site, batch: imm.batchNumber })} · {t('patientPortal.administeredBy', { name: imm.administeredBy, facility: imm.facilityName })}</span>
                    </div>
                    <span className="pp-row-value">{shortDate(imm.dateGiven)}</span>
                    {due ? (
                      <>
                        <span className="pp-chip pp-chip--yellow">{t('patientPortal.nextDue', { date: shortDate(imm.nextDueDate!) })}</span>
                        <button type="button" className="pp-row-action" onClick={() => setShowBooking(true)}>Book</button>
                      </>
                    ) : (
                      <span className="pp-chip pp-chip--green">Given</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ Chat / Messages ═══ */}
      {activeTab === 'chat' && (
        <div>
          <div className="pp-head">
            <div>
              <h1>{t('patientPortal.tabMessages')}</h1>
              <p className="pp-head-note">Your care team replies within one working day. For emergencies call 911 or come to the facility.</p>
            </div>
          </div>
          <div className="pp-card pp-chat">
            <div className="pp-card-head">
              <h2>{patientFacilityName}</h2>
              <div style={{ flex: 'none', width: 190 }}>
                <Select value={chatDepartment} onChange={e => setChatDepartment(e.target.value)}
                  aria-label={t('patientPortal.department')}
                  style={{ width: '100%', height: 28, padding: '0 8px', borderRadius: 6, border: '1px solid #E3EBF2', background: '#FFFFFF', color: '#0E2A4A', fontSize: 12, fontFamily: 'var(--font-platform)' }}>
                  {['General / OPD', 'Internal Medicine', 'Obstetrics', 'Pediatrics', 'Surgery', 'Laboratory', 'Pharmacy', 'Dental', 'Emergency'].map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="pp-chat-scroll">
              {chatMessages.map((msg, i) => (
                <div key={msg.id || i} className={`pp-bubble-line ${msg.from === 'patient' ? 'me' : ''}`}>
                  <div className="pp-bubble">
                    {msg.text}
                    <small>{msg.time}</small>
                  </div>
                </div>
              ))}
            </div>
            {chatError && (
              <div style={{ padding: '8px 14px', borderTop: '1px solid #EDF2F7', background: 'rgba(139,46,36,0.06)', color: '#8B2E24', fontSize: 12 }}>
                {chatError}
              </div>
            )}
            <div className="pp-composer">
              <input
                type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { void handleSendChat(); } }}
                placeholder={t('patientPortal.messagePlaceholder', { department: chatDepartment })}
                disabled={chatSending}
              />
              <button type="button" className="pp-btn pp-btn-primary"
                onClick={() => { void handleSendChat(); }}
                disabled={chatSending || !chatInput.trim()}
                aria-label={t('patientPortal.sendMessage')}>
                <Send size={14} strokeWidth={1.8} /> {t('patientPortal.sendMessage')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ My Profile ═══ */}
      {activeTab === 'profile' && (
        <ProfileTab patient={patient} />
      )}

      {/* Booking Modal */}
      {showBooking && (
        <Modal onClose={() => { setShowBooking(false); resetBookingForm(); }}>
          <div className="modal-panel modal-panel--md">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{t('patientPortal.requestAppointment')}</h3>
              <button onClick={() => { setShowBooking(false); resetBookingForm(); }} style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--overlay-subtle)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}><X size={14} /></button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 }}>{t('patientPortal.bookingNotice')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--accent-light)', border: '1px solid var(--accent-border)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Calendar size={14} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{t('patientPortal.bookingAt', { facility: patientFacilityName })}</span>
              </div>
              <div><label>{t('patientPortal.preferredDate')}</label><input type="date" value={bookingDate} onChange={e => setBookingDate(e.target.value)} min={new Date().toISOString().slice(0, 10)} /></div>
              <div><label>{t('patientPortal.preferredTime')}</label>
                <Select value={bookingTime} onChange={e => setBookingTime(e.target.value as typeof bookingTime)}>
                  <option value="morning">{t('patientPortal.timeMorning')}</option>
                  <option value="afternoon">{t('patientPortal.timeAfternoon')}</option>
                  <option value="any">{t('patientPortal.timeAnyTime')}</option>
                </Select>
              </div>
              <div><label>{t('patientPortal.department')}</label>
                <Select value={bookingDepartment} onChange={e => setBookingDepartment(e.target.value)}>
                  <option>General / OPD</option><option>Obstetrics</option><option>Internal Medicine</option><option>Pediatrics</option><option>Surgery</option><option>Laboratory</option><option>Dental</option>
                </Select>
              </div>
              <div><label>{t('patientPortal.reason')}</label><textarea rows={3} placeholder={t('patientPortal.reasonPlaceholder')} value={bookingReason} onChange={e => setBookingReason(e.target.value)} /></div>
              <div><label>{t('patientPortal.visitType')}</label>
                <Select value={bookingVisitType} onChange={e => setBookingVisitType(e.target.value as typeof bookingVisitType)}>
                  <option value="in_person">{t('patientPortal.visitInPerson')}</option>
                  <option value="telehealth_video">{t('patientPortal.visitTelehealthVideo')}</option>
                  <option value="telehealth_audio">{t('patientPortal.visitTelehealthAudio')}</option>
                </Select>
              </div>
              {bookingError && <p style={{ fontSize: 12, color: 'var(--color-danger-text)' }}>{bookingError}</p>}
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button onClick={() => { setShowBooking(false); resetBookingForm(); }} className="btn btn-secondary" style={{ flex: 1 }} disabled={bookingSubmitting}>{t('action.cancel')}</button>
                <button onClick={handleSubmitBooking} className="btn btn-primary" style={{ flex: 1 }} disabled={bookingSubmitting || !bookingDate || !bookingDepartment}>
                  {bookingSubmitting ? t('status.loading') : t('patientPortal.submitRequest')}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

          </div>
        </main>
      </div>

      {/* Confirmation toast — only after an action actually persisted. */}
      {toast && (
        <div className="pp-toast" role="status">
          <CheckCircle2 size={14} strokeWidth={2.2} />{toast}
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════
   PROFILE TAB
   ═════════════════════════════════════════ */
function ProfileTab({ patient }: { patient: PatientDoc }) {
  const { t } = useTranslation();
  const facilityName = (patient as { registrationHospitalName?: string }).registrationHospitalName
    || patient.registrationHospital
    || '—';

  const fields = [
    { label: t('patientPortal.firstName'), value: patient.firstName },
    { label: t('patientPortal.middleName'), value: patient.middleName || '—' },
    { label: t('patientPortal.surname'), value: patient.surname },
    { label: t('patientPortal.dateOfBirth'), value: patient.dateOfBirth || (patient.estimatedAge ? `~${patient.estimatedAge} years` : '—') },
    { label: t('patient.gender'), value: patient.gender },
    { label: t('patient.bloodType'), value: patient.bloodType || '—' },
    { label: t('patient.phone'), value: patient.phone || '—' },
    { label: t('patientPortal.geocodeId'), value: patient.geocodeId || '—' },
    { label: t('patientPortal.county'), value: patient.county || '—' },
    { label: t('patientPortal.state'), value: patient.state || '—' },
    { label: t('patient.hospitalNumber'), value: patient.hospitalNumber || '—' },
    { label: t('patientPortal.registrationHospital'), value: facilityName },
  ];

  // 'None' / 'None known' placeholders are the absence of an entry.
  const realAllergies = (patient.allergies || []).filter(a => a && !/^none\b/i.test(a));
  const realConditions = (patient.chronicConditions || []).filter(c => c && !/^none\b/i.test(c));

  return (
    <div>
      <div className="pp-head">
        <div>
          <h1>{t('patientPortal.tabMyProfile')}</h1>
          <p className="pp-head-note">{t('patientPortal.protectedFieldsNote')}</p>
        </div>
      </div>

      <div className="pp-grid2">
        <div className="pp-card">
          <div className="pp-card-head"><h2>{t('patientPortal.personalDetails')}</h2></div>
          <div className="pp-fields">
            {fields.map((f, i) => (
              <div key={i}>
                <p className="pp-field-label">{f.label}</p>
                <p className="pp-field-value">{f.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="pp-card">
            <div className="pp-card-head"><h2>{t('patientPortal.emergencyContact')}</h2></div>
            <div style={{ padding: '11px 14px' }}>
              <b style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: '#0E2A4A' }}>
                {patient.nokName || '—'}{patient.nokRelationship ? ` · ${patient.nokRelationship}` : ''}
              </b>
              <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: '#5B6B7E' }}>{patient.nokPhone || '—'}</span>
            </div>
          </div>

          <div className="pp-card pp-card--danger">
            <div className="pp-card-head"><h2>{t('patient.allergies')}</h2></div>
            <div className="pp-pillbox">
              {realAllergies.length > 0 ? realAllergies.map((a, i) => (
                <span key={i} className="pp-pill pp-pill--red">{a}</span>
              )) : (
                <span style={{ fontSize: 12, color: '#5B6B7E' }}>{t('patientPortal.noKnownAllergies')}</span>
              )}
            </div>
          </div>

          <div className="pp-card">
            <div className="pp-card-head"><h2>{t('patient.chronicConditions')}</h2></div>
            <div className="pp-pillbox">
              {realConditions.length > 0 ? realConditions.map((c, i) => (
                <span key={i} className="pp-pill pp-pill--blue">{c}</span>
              )) : (
                <span style={{ fontSize: 12, color: '#5B6B7E' }}>{t('patientPortal.noChronicConditions')}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════
   BILLING & PAYMENTS TAB
   ═════════════════════════════════════════ */
// View model the UI renders against. We derive this from the real
// `BillingDoc` records in PouchDB rather than baking in a hardcoded array
// — the previous implementation rendered fake invoices ("B-2026-001"…)
// and the "Pay" flow returned a fake `TBN-…` reference without persisting
// anything, which was dishonest UX (the patient thought they had paid).
type BillItem = {
  id: string;          // The BillingDoc _id sent to the patient-portal payment API.
  invoiceNumber: string;
  date: string;
  description: string;
  department: string;
  amount: number;
  paid: number;
  /** Sliced from BillingDoc.status; 'overdue' is computed from dueDate. */
  status: 'paid' | 'partial' | 'unpaid' | 'overdue';
};

type UiPaymentMethod = 'mpesa' | 'mtn' | 'airtel' | 'card' | 'bank';

function BillingTab({ patient, sessionToken }: { patient: PatientDoc; sessionToken: string }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<'bills' | 'method' | 'confirm' | 'success'>('bills');
  const [selectedBills, setSelectedBills] = useState<string[]>([]);
  const [payMethod, setPayMethod] = useState<UiPaymentMethod | null>(null);
  const [payPhone, setPayPhone] = useState(patient.phone || '');

  // Real bill data, loaded from PouchDB. `null` = still loading; `[]` = no
  // bills on file. Distinguishing these lets us show a loading skeleton vs.
  // an empty-state card.
  const [bills, setBills] = useState<BillItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Org-configured bank-transfer instructions (set on the org-admin branding
  // page). When present we show the real details; otherwise we fall back to a
  // "contact billing" message rather than a hardcoded account number.
  const [bankDetails, setBankDetails] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!patient.orgId) { setBankDetails(null); return; }
    (async () => {
      try {
        const { getOrganizationById } = await import('@/lib/services/organization-service');
        const org = await getOrganizationById(patient.orgId!);
        if (!cancelled) setBankDetails(org?.bankDetails?.trim() || null);
      } catch (err) {
        console.error('[patient-portal/billing] org load failed', err);
        if (!cancelled) setBankDetails(null);
      }
    })();
    return () => { cancelled = true; };
  }, [patient.orgId]);

  // Last-payment metadata for the success screen — populated by the actual
  // recordPayment response so the reference shown is the one that ended up
  // in the bill's payments[] array.
  const [lastPayment, setLastPayment] = useState<{
    reference: string;
    amount: number;
    billCount: number;
    failedBillIds: string[];
  } | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  // Derive the UI status from the underlying BillingDoc plus dueDate so the
  // patient sees "overdue" on bills past due, even when the doc itself just
  // says "pending".
  const deriveStatus = (
    docStatus: string,
    totalAmount: number,
    amountPaid: number,
    encounterDate: string,
  ): BillItem['status'] => {
    if (docStatus === 'paid' || amountPaid >= totalAmount) return 'paid';
    if (docStatus === 'partial' || (amountPaid > 0 && amountPaid < totalAmount)) return 'partial';
    // Treat anything older than 30 days with non-zero balance as 'overdue'
    // for display purposes. The model has no explicit dueDate field today.
    if (encounterDate) {
      const ageMs = Date.now() - new Date(encounterDate).getTime();
      if (ageMs > 30 * 24 * 60 * 60 * 1000) return 'overdue';
    }
    return 'unpaid';
  };

  useEffect(() => {
    let cancelled = false;
    setBills(null);
    setLoadError(null);
    (async () => {
      try {
        const session = readPatientPortalSession();
        if (!session) throw new Error('Missing patient session');
        const { bills: docs } = await patientPortalFetch<{ bills: Array<{
          _id: string;
          invoiceNumber?: string;
          encounterDate?: string;
          createdAt?: string;
          facilityName?: string;
          items?: Array<{ description: string; category: string }>;
          totalAmount: number;
          amountPaid: number;
          status: string;
        }> }>('/api/patient-portal/billing', session.token);
        if (cancelled) return;
        const mapped: BillItem[] = docs
          .map(d => ({
            id: d._id,
            invoiceNumber: d.invoiceNumber || d._id,
            date: (d.encounterDate || d.createdAt || '').slice(0, 10),
            description:
              (d.items && d.items.length > 0
                ? d.items.map(i => i.description).slice(0, 2).join(', ')
                : null) || t('patientPortal.visitAt', { facility: d.facilityName || t('patientPortal.facilityFallback') }),
            department:
              (d.items && d.items[0] ? d.items[0].category : 'Services').toString(),
            amount: d.totalAmount,
            paid: d.amountPaid,
            status: deriveStatus(d.status, d.totalAmount, d.amountPaid, d.encounterDate || d.createdAt || ''),
          }))
          .sort((a, b) => b.date.localeCompare(a.date));
        setBills(mapped);
      } catch (err) {
        console.error('[patient-portal/billing] load failed', err);
        if (!cancelled) {
          setBills([]);
          setLoadError(t('patientPortal.billsLoadError'));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [patient._id]);

  const safeBills = bills || [];
  const totalBilled = safeBills.reduce((s, b) => s + b.amount, 0);
  const totalOwed = safeBills.reduce((s, b) => s + (b.amount - b.paid), 0);
  const totalPaid = safeBills.reduce((s, b) => s + b.paid, 0);
  const totalOverdue = safeBills.filter(b => b.status === 'overdue').reduce((s, b) => s + (b.amount - b.paid), 0);
  const outstandingBills = safeBills.filter(b => b.amount - b.paid > 0);
  const selectedTotal = safeBills.filter(b => selectedBills.includes(b.id)).reduce((s, b) => s + (b.amount - b.paid), 0);

  const billChip = (s: BillItem['status']): { tone: ChipTone; label: string } => {
    switch (s) {
      case 'paid': return { tone: 'green', label: 'Paid' };
      case 'partial': return { tone: 'yellow', label: 'Partial' };
      case 'overdue': return { tone: 'red', label: t('patientPortal.overdue') };
      default: return { tone: 'blue', label: 'Unpaid' };
    }
  };

  const paymentMethods: { key: UiPaymentMethod; name: string; icon: typeof Phone; desc: string; color: string }[] = [
    { key: 'mpesa', name: 'M-Pesa', icon: Phone, desc: t('patientPortal.payViaMpesa'), color: '#4CAF50' },
    { key: 'mtn', name: 'MTN Mobile Money', icon: Phone, desc: t('patientPortal.payViaMtn'), color: '#FFC107' },
    { key: 'airtel', name: 'Airtel Money', icon: Phone, desc: t('patientPortal.payViaAirtel'), color: '#E53935' },
    { key: 'card', name: t('patientPortal.cardPayment'), icon: CreditCard, desc: t('patientPortal.payViaCard'), color: 'var(--accent-primary)' },
    { key: 'bank', name: t('patientPortal.bankTransfer'), icon: Banknote, desc: t('patientPortal.payViaBank'), color: '#00897B' },
  ];

  // Map the UI-level payment buttons onto the canonical PaymentMethod values
  // accepted by the patient-portal payment API.
  const toCanonicalMethod = (m: UiPaymentMethod): 'mobile_money' | 'bank_transfer' | 'cash' => {
    if (m === 'mpesa' || m === 'mtn' || m === 'airtel') return 'mobile_money';
    if (m === 'card' || m === 'bank') return 'bank_transfer';
    return 'cash';
  };

  // Submit a patient-entered payment for every selected bill. The server stores
  // these as pending finance review; this screen only reflects the submitted
  // intent, then refreshes billing from the server when possible.
  const submitPayment = async () => {
    if (!payMethod || paying) return;
    setPaying(true);
    setPayError(null);

    try {
      const canonicalMethod = toCanonicalMethod(payMethod);
      const referenceBase = `TBN-${Date.now().toString(36).toUpperCase()}`;
      if (!sessionToken) throw new Error('Missing patient session');

      const updates: Array<{ id: string; amount: number; ok: boolean }> = [];
      for (const billId of selectedBills) {
        const bill = safeBills.find(b => b.id === billId);
        if (!bill) continue;
        const remaining = bill.amount - bill.paid;
        if (remaining <= 0) continue;
        try {
          await patientPortalFetch<{ ok: boolean; id: string }>(
            '/api/patient-portal/payments',
            sessionToken,
            {
              method: 'POST',
              body: JSON.stringify({
                invoiceId: billId,
                amount: remaining,
                method: canonicalMethod,
                reference: referenceBase,
                mobileMoneyPhone: payMethod === 'mpesa' || payMethod === 'mtn' || payMethod === 'airtel'
                  ? payPhone
                  : undefined,
                notes: payMethod === 'mpesa' || payMethod === 'mtn' || payMethod === 'airtel'
                  ? `Patient portal — ${payMethod} from ${payPhone}`
                  : `Patient portal — ${payMethod}`,
              }),
            }
          );
          updates.push({ id: billId, amount: remaining, ok: true });
        } catch {
          updates.push({ id: billId, amount: remaining, ok: false });
        }
      }

      const failed = updates.filter(u => !u.ok);
      const paidTotal = updates.filter(u => u.ok).reduce((s, u) => s + u.amount, 0);

      if (updates.length === 0 || updates.every(u => !u.ok)) {
        setPayError(t('patientPortal.paymentRecordError'));
        setPaying(false);
        return;
      }

      // Refresh the in-memory bills list from the source of truth so the UI
      // reflects the new amountPaid / balanceDue / status.
      try {
        const { bills: docs } = await patientPortalFetch<{ bills: Array<{
          _id: string;
          invoiceNumber?: string;
          encounterDate?: string;
          createdAt?: string;
          facilityName?: string;
          items?: Array<{ description: string; category: string }>;
          totalAmount: number;
          amountPaid: number;
          status: string;
        }> }>('/api/patient-portal/billing', sessionToken);
        setBills(docs
          .map(d => ({
            id: d._id,
            invoiceNumber: d.invoiceNumber || d._id,
            date: (d.encounterDate || d.createdAt || '').slice(0, 10),
            description:
              (d.items && d.items.length > 0
                ? d.items.map(i => i.description).slice(0, 2).join(', ')
                : null) || t('patientPortal.visitAt', { facility: d.facilityName || t('patientPortal.facilityFallback') }),
            department: (d.items && d.items[0] ? d.items[0].category : 'Services').toString(),
            amount: d.totalAmount,
            paid: d.amountPaid,
            status: deriveStatus(d.status, d.totalAmount, d.amountPaid, d.encounterDate || d.createdAt || ''),
          }))
          .sort((a, b) => b.date.localeCompare(a.date)));
      } catch { /* refresh is best-effort; the success screen still renders */ }

      setLastPayment({
        reference: referenceBase,
        amount: paidTotal,
        billCount: updates.filter(u => u.ok).length,
        failedBillIds: failed.map(f => f.id),
      });
      setStep('success');
    } catch (err) {
      console.error('[patient-portal/billing] payment failed', err);
      setPayError(t('patientPortal.paymentGenericError'));
    } finally {
      setPaying(false);
    }
  };

  if (step === 'success') {
    const refNum = lastPayment?.reference || '';
    const paidAmount = lastPayment?.amount ?? 0;
    const billCount = lastPayment?.billCount ?? 0;
    const failedCount = lastPayment?.failedBillIds.length ?? 0;
    return (
      <div className="pp-narrow" style={{ textAlign: 'center' }}>
        <div className="pp-card" style={{ padding: '36px 28px' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(21,121,92,0.10)', display: 'grid', placeItems: 'center', margin: '0 auto 16px', color: '#15795C' }}>
            <CheckCircle2 size={30} />
          </div>
          <h3 style={{ margin: '0 0 6px', fontFamily: 'var(--font-condensed)', fontSize: 19, fontWeight: 600, color: '#0E2A4A' }}>{t('patientPortal.paymentRecorded')}</h3>
          <p style={{ margin: '0 0 20px', fontSize: 13, color: '#5B6B7E' }}>
            {payMethod === 'mpesa' || payMethod === 'mtn' || payMethod === 'airtel'
              ? t('patientPortal.successMobilePrompt')
              : payMethod === 'card'
              ? t('patientPortal.successCardRedirect')
              : t('patientPortal.successBankTransfer')}
          </p>
          {failedCount > 0 && (
            <div style={{ padding: 10, borderRadius: 8, marginBottom: 14, background: 'rgba(139,46,36,0.06)', border: '1px solid rgba(139,46,36,0.3)' }}>
              <p style={{ margin: 0, fontSize: 12, color: '#8B2E24', fontWeight: 600 }}>
                {t('patientPortal.billsNotUpdated', { count: failedCount })}
              </p>
            </div>
          )}
          <div className="pp-row-detail-box" style={{ textAlign: 'left', marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
              <div><p className="pp-field-label">{t('patientPortal.reference')}</p><p className="pp-field-value" style={{ fontFamily: 'var(--font-platform-mono)', fontWeight: 600 }}>{refNum}</p></div>
              <div><p className="pp-field-label">{t('portal.amount')}</p><p className="pp-field-value" style={{ fontWeight: 600 }}>{formatMoney(paidAmount)}</p></div>
              <div><p className="pp-field-label">{t('portal.method')}</p><p className="pp-field-value">{paymentMethods.find(m => m.key === payMethod)?.name}</p></div>
              <div><p className="pp-field-label">{t('patientPortal.bills')}</p><p className="pp-field-value">{t('patientPortal.itemCount', { count: billCount })}</p></div>
            </div>
            {payMethod === 'bank' && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #EDF2F7' }}>
                <p style={{ margin: '0 0 6px', fontFamily: 'var(--font-condensed)', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#00897B' }}>{t('patientPortal.bankTransferDetails')}</p>
                {bankDetails ? (
                  <>
                    {bankDetails.split('\n').map((line, i) => (
                      <p key={i} style={{ margin: 0, fontSize: 12, color: '#0E2A4A', whiteSpace: 'pre-wrap' }}>{line}</p>
                    ))}
                    <p style={{ margin: 0, fontSize: 12, color: '#0E2A4A' }}>{t('patientPortal.refLabel')} <strong>{refNum}</strong></p>
                  </>
                ) : IS_DEMO ? (
                  <>
                    <p style={{ margin: 0, fontSize: 12, color: '#0E2A4A' }}>{t('patientPortal.bankLabel')} <strong>KCB Bank South Sudan</strong></p>
                    <p style={{ margin: 0, fontSize: 12, color: '#0E2A4A' }}>{t('patientPortal.accountLabel')} <strong>720-184-2930</strong></p>
                    <p style={{ margin: 0, fontSize: 12, color: '#0E2A4A' }}>{t('patientPortal.nameLabel')} <strong>TamamHealth Health Services</strong></p>
                    <p style={{ margin: 0, fontSize: 12, color: '#0E2A4A' }}>{t('patientPortal.refLabel')} <strong>{refNum}</strong></p>
                  </>
                ) : (
                  <p style={{ margin: 0, fontSize: 12, color: '#0E2A4A' }}>{t('patientPortal.bankTransferContactBilling')}</p>
                )}
              </div>
            )}
          </div>
          <button type="button" className="pp-btn pp-btn-primary" onClick={() => { setStep('bills'); setSelectedBills([]); setPayMethod(null); setLastPayment(null); }}>{t('patientPortal.done')}</button>
        </div>
      </div>
    );
  }

  if (step === 'confirm') {
    const method = paymentMethods.find(m => m.key === payMethod)!;
    return (
      <div className="pp-narrow">
        <button type="button" className="pp-back-link" onClick={() => setStep('method')}>← {t('action.back')}</button>
        <div className="pp-card" style={{ padding: 18 }}>
          <h3 style={{ margin: '0 0 14px', fontFamily: 'var(--font-condensed)', fontSize: 17, fontWeight: 600, color: '#0E2A4A' }}>{t('patientPortal.confirmPayment')}</h3>
          <div className="pp-row-detail-box" style={{ marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
              <div><p className="pp-field-label">{t('patientPortal.totalAmount')}</p><p className="pp-field-value" style={{ fontWeight: 600 }}>{formatMoney(selectedTotal)}</p></div>
              <div><p className="pp-field-label">{t('patientPortal.paymentMethod')}</p><p className="pp-field-value">{method.name}</p></div>
              <div><p className="pp-field-label">{t('patientPortal.items')}</p><p className="pp-field-value">{t('patientPortal.billCount', { count: selectedBills.length })}</p></div>
              {(payMethod === 'mpesa' || payMethod === 'mtn' || payMethod === 'airtel') && (
                <div><p className="pp-field-label">{t('patient.phone')}</p><p className="pp-field-value">{payPhone}</p></div>
              )}
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <p className="pp-field-label" style={{ margin: '0 0 6px' }}>{t('patientPortal.billsIncluded')}</p>
            {safeBills.filter(b => selectedBills.includes(b.id)).map(b => (
              <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: '1px solid #EDF2F7' }}>
                <span style={{ fontSize: 12, color: '#0E2A4A' }}>{b.description}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#0E2A4A', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(b.amount - b.paid)}</span>
              </div>
            ))}
          </div>
          {(payMethod === 'mpesa' || payMethod === 'mtn' || payMethod === 'airtel') && (
            <div style={{ padding: 10, borderRadius: 8, background: '#EFF8FD', border: '1px solid #52ADDE', marginBottom: 14 }}>
              <p style={{ margin: 0, fontSize: 11.5, color: '#013D6B', fontWeight: 600 }}>{t('patientPortal.paymentPromptNotice', { phone: payPhone })}</p>
            </div>
          )}
          {payError && (
            <div style={{ padding: 10, borderRadius: 8, background: 'rgba(139,46,36,0.06)', border: '1px solid rgba(139,46,36,0.3)', marginBottom: 14 }}>
              <p style={{ margin: 0, fontSize: 12, color: '#8B2E24', fontWeight: 600 }}>{payError}</p>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="pp-btn pp-btn-secondary" style={{ flex: 1 }} onClick={() => setStep('method')} disabled={paying}>{t('action.cancel')}</button>
            <button type="button" className="pp-btn pp-btn-primary" style={{ flex: 1 }} onClick={() => { void submitPayment(); }} disabled={paying}>
              {paying ? t('patientPortal.recording') : t('patientPortal.payAmount', { amount: `${selectedTotal.toLocaleString()} SSP` })}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'method') {
    return (
      <div className="pp-narrow">
        <button type="button" className="pp-back-link" onClick={() => setStep('bills')}>← {t('portal.backToBillsBtn')}</button>
        <div className="pp-card" style={{ padding: 18 }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-condensed)', fontSize: 17, fontWeight: 600, color: '#0E2A4A' }}>{t('portal.choosePaymentMethod')}</h3>
          <p style={{ margin: '4px 0 16px', fontSize: 12, color: '#5B6B7E' }}>{t('patientPortal.totalLabel')} <strong style={{ color: '#0E2A4A' }}>{formatMoney(selectedTotal)}</strong> {t('patientPortal.forBills', { count: selectedBills.length })}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {paymentMethods.map(m => {
              const on = payMethod === m.key;
              return (
                <button key={m.key} type="button" onClick={() => setPayMethod(m.key)} style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 14px',
                  borderRadius: 8, border: on ? '1px solid var(--accent-primary)' : '1px solid #E3EBF2',
                  boxShadow: on ? 'inset 0 0 0 1px var(--accent-primary)' : 'none',
                  background: on ? '#EFF8FD' : '#FFFFFF',
                  cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-platform)',
                }}>
                  <span style={{ width: 34, height: 34, borderRadius: 8, background: `color-mix(in srgb, ${m.color} 12%, transparent)`, display: 'grid', placeItems: 'center', flexShrink: 0, color: m.color }}>
                    <m.icon size={16} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#0E2A4A' }}>{m.name}</b>
                    <small style={{ display: 'block', fontSize: 11.5, color: '#5B6B7E' }}>{m.desc}</small>
                  </span>
                  {on && <CheckCircle2 size={18} color="var(--accent-primary)" />}
                </button>
              );
            })}
          </div>
          {payMethod && (payMethod === 'mpesa' || payMethod === 'mtn' || payMethod === 'airtel') && (
            <div style={{ marginBottom: 16 }}>
              <p className="pp-field-label" style={{ margin: '0 0 4px' }}>{t('patientPortal.phoneNumber')}</p>
              <input type="tel" value={payPhone} onChange={e => setPayPhone(e.target.value)} placeholder={t('patientPortal.payPhonePlaceholder')}
                style={{ width: '100%', height: 38, padding: '0 13px', borderRadius: 8, border: '1px solid #E3EBF2', background: '#F7FAFC', color: '#0E2A4A', fontSize: 13, outline: 'none', fontFamily: 'var(--font-platform)' }} />
            </div>
          )}
          <button type="button" className="pp-btn pp-btn-primary" style={{ width: '100%' }} onClick={() => payMethod && setStep('confirm')} disabled={!payMethod}>
            {t('patientPortal.continueToConfirm')}
          </button>
        </div>
      </div>
    );
  }

  /* Bills list (default step) */
  const isLoading = bills === null;

  const header = (
    <div className="pp-head">
      <div>
        <h1>{t('patientPortal.tabBilling')}</h1>
        <p className="pp-head-note">Bills from your visits, and how to pay them.</p>
      </div>
    </div>
  );

  // Loading skeleton — keeps the page visually quiet until the PouchDB query
  // resolves, instead of flashing an empty state.
  if (isLoading) {
    return (
      <div>
        {header}
        <div className="pp-card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ margin: 0, fontSize: 13, color: '#5B6B7E' }}>{t('patientPortal.loadingBills')}</p>
        </div>
      </div>
    );
  }

  // Hard-error state (PouchDB query threw). Loadable but useless without
  // the data, so we surface this rather than pretending all bills are
  // settled.
  if (loadError && safeBills.length === 0) {
    return (
      <div>
        {header}
        <div className="pp-card" style={{ textAlign: 'center', padding: 40 }}>
          <Receipt size={44} style={{ color: '#8B2E24', opacity: 0.6, margin: '0 auto 10px' }} />
          <p style={{ margin: 0, fontSize: 13, color: '#5B6B7E' }}>{loadError}</p>
        </div>
      </div>
    );
  }

  // Friendly empty state — distinguishes "no bills on file" from a load
  // error, so a brand-new patient doesn't see scary copy.
  if (safeBills.length === 0) {
    return (
      <div>
        {header}
        <div className="pp-card" style={{ textAlign: 'center', padding: 40 }}>
          <Receipt size={44} style={{ color: '#94A3B8', opacity: 0.5, margin: '0 auto 10px' }} />
          <p style={{ margin: 0, fontSize: 13, color: '#5B6B7E' }}>{t('patientPortal.noBillsOnFile')}</p>
        </div>
      </div>
    );
  }

  const stats = [
    { label: t('patientPortal.totalBilled'), value: formatMoney(totalBilled), color: '#0E2A4A' },
    { label: t('portal.totalPaid'), value: formatMoney(totalPaid), color: '#15795C' },
    { label: t('patientPortal.outstanding'), value: formatMoney(totalOwed), color: totalOwed > 0 ? '#9C5E16' : '#0E2A4A' },
    { label: t('patientPortal.overdue'), value: formatMoney(totalOverdue), color: totalOverdue > 0 ? '#8B2E24' : '#0E2A4A' },
  ];

  return (
    <div>
      {header}

      <div className="pp-tiles" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        {stats.map(s => (
          <div key={s.label} className="pp-tile">
            <p className="pp-tile-label">{s.label}</p>
            <p className="pp-tile-value" style={{ fontSize: 20, color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="pp-grid2">
        {/* Bills */}
        <div className="pp-card">
          <div className="pp-card-head"><h2>{t('portal.yourBills')}</h2></div>
          {safeBills.map(bill => {
            const remaining = bill.amount - bill.paid;
            const chip = billChip(bill.status);
            return (
              <div key={bill.id} className="pp-row">
                <div className="pp-row-main">
                  <b style={{ fontSize: 13 }}>{bill.description}</b>
                  <span style={{ fontSize: 11.5 }}>{bill.department} · {shortDate(bill.date)}{bill.status === 'partial' ? ` · ${formatMoney(bill.paid)} paid` : ''}</span>
                </div>
                <span style={{ flex: 'none', fontFamily: 'var(--font-condensed)', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#0E2A4A' }}>
                  {formatMoney(remaining > 0 ? remaining : bill.amount)}
                </span>
                {remaining > 0 && bill.status !== 'unpaid' && (
                  <span className={`pp-chip pp-chip--${chip.tone}`}>{chip.label}</span>
                )}
                {remaining > 0 ? (
                  <button type="button" className="pp-row-pay"
                    onClick={() => { setSelectedBills([bill.id]); setStep('method'); }}>
                    Pay
                  </button>
                ) : (
                  <span className={`pp-chip pp-chip--${chip.tone}`}>{chip.label}</span>
                )}
              </div>
            );
          })}
          {outstandingBills.length > 1 && (
            <button type="button" className="pp-card-foot"
              onClick={() => { setSelectedBills(outstandingBills.map(b => b.id)); setStep('method'); }}>
              Pay all outstanding — {formatMoney(totalOwed)} ›
            </button>
          )}
        </div>

        {/* Accepted payment methods */}
        <div className="pp-card" style={{ alignSelf: 'start' }}>
          <div className="pp-card-head"><h2>{t('portal.acceptedPaymentMethods')}</h2></div>
          {paymentMethods.map(m => (
            <div key={m.key} className="pp-row">
              <span style={{ flex: 'none', width: 34, height: 34, display: 'grid', placeItems: 'center', background: '#EFF8FD', borderRadius: 8, color: 'var(--accent-primary)' }}>
                <m.icon size={16} strokeWidth={1.7} />
              </span>
              <div className="pp-row-main">
                <b style={{ fontSize: 13 }}>{m.name}</b>
                <span style={{ fontSize: 11.5 }}>{m.desc}</span>
              </div>
            </div>
          ))}
          <div style={{ padding: '10px 14px' }}>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--ehr-muted)', lineHeight: 1.5 }}>
              <strong style={{ color: '#5B6B7E' }}>{t('patientPortal.needHelpLabel')}</strong> {t('patientPortal.needHelpBody')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Helpers ─── */

// Chip tones from the design's CHIP map — see .pp-chip--* in globals.css.
type ChipTone = 'green' | 'yellow' | 'red' | 'blue' | 'neutral';

function Empty({ icon: Icon, text, action, onAction }: { icon: typeof User; text: string; action?: string; onAction?: () => void }) {
  return (
    <div className="pp-card" style={{ textAlign: 'center', padding: 40 }}>
      <Icon size={44} style={{ color: '#94A3B8', opacity: 0.5, margin: '0 auto 10px' }} />
      <p style={{ margin: 0, fontSize: 13, color: '#5B6B7E' }}>{text}</p>
      {action && onAction && (
        <button type="button" onClick={onAction} className="pp-btn pp-btn-primary" style={{ marginTop: 14 }}>
          <Plus size={14} /> {action}
        </button>
      )}
    </div>
  );
}

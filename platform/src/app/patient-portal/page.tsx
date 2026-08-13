'use client';

import Link from 'next/link';
import { useState, useEffect, useMemo, useCallback } from 'react';
import Modal from '@/components/Modal';
import {
  User, Calendar, FileText, FlaskConical, Syringe,
  HeartPulse, Pill, Scan,
  ChevronRight, ChevronDown, Search, AlertTriangle,
  MessageSquare, ArrowRight, Activity,
  Plus, X, LogOut, Send, Building2,
  Wallet, CreditCard, Phone, Banknote,
  Clock, CheckCircle2, Stethoscope,
  Thermometer, Weight, Droplets, Eye, EyeOff, Lock,
  Receipt,
  UserCircle,
  Upload, FileUp, ClipboardList, Video,
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
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : t('patientPortal.bookingRequestError'));
    } finally {
      setBookingSubmitting(false);
    }
  };

  const [chatDepartment, setChatDepartment] = useState('General / OPD');

  const mainTabs: { key: Tab; label: string; icon: typeof User; count?: number }[] = [
    { key: 'overview', label: t('patientPortal.tabOverview'), icon: Activity },
    { key: 'records', label: t('patientPortal.tabMedicalRecords'), icon: FileText, count: records.length },
    { key: 'prescriptions', label: t('patientPortal.tabPrescriptions'), icon: Pill },
    { key: 'lab', label: t('patientPortal.tabLabResults'), icon: FlaskConical, count: labResults.filter(l => l.status === 'pending').length },
    { key: 'radiology', label: t('patientPortal.tabRadiology'), icon: Scan },
    { key: 'immunizations', label: t('patientPortal.tabImmunizations'), icon: Syringe },
  ];
  const actionTabs: { key: Tab; label: string; icon: typeof User; count?: number }[] = [
    { key: 'appointments', label: t('patientPortal.tabAppointments'), icon: Calendar, count: upcomingApts.length },
    { key: 'billing', label: t('patientPortal.tabBilling'), icon: Wallet },
    { key: 'chat', label: t('patientPortal.tabMessages'), icon: MessageSquare },
    { key: 'profile', label: t('patientPortal.tabMyProfile'), icon: UserCircle },
  ];
  const tabs = [...mainTabs, ...actionTabs];

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
  const [navMenuOpen, setNavMenuOpen] = useState(false);
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
  const activeTabDef = tabs.find(tb => tb.key === activeTab) || tabs[0];
  const ActiveTabIcon = activeTabDef.icon;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <style dangerouslySetInnerHTML={{ __html: patientPortalCSS }} />

      {/* ── Top rail — the SAME layout as the clinical-officer EHR shell,
          reusing the shared .ehr-top-* classes: navy grid of brand · module
          menu · centered facility · search · labeled user chip. The section
          navigation lives in the module-menu dropdown, exactly like staff.
          Overridden to `sticky` (the EHR shell offsets a fixed rail; here the
          rail just sits in normal flow) and given the shell's page-inset var. */}
      <header className="ehr-top-rail" style={{ position: 'sticky', top: 0, ['--ehr-page-inset']: '12px' } as React.CSSProperties}>
        <button type="button" className="ehr-top-brand" onClick={() => setActiveTab('overview')} aria-label="Patient portal home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="ehr-top-brand-logo-full" src="/assets/tamamhealth-logo-full-white.svg" alt="Tamam Healthcare System" />
        </button>

        <nav className="ehr-top-modules" aria-label="Patient portal sections">
          <button type="button" className={`ehr-module-trigger ${navMenuOpen ? 'active' : ''}`}
            onClick={() => { setNavMenuOpen(o => !o); setUserMenuOpen(false); }}
            aria-expanded={navMenuOpen} aria-haspopup="menu" title="Open section menu">
            <ActiveTabIcon className="w-5 h-5" />
            <ChevronDown className="w-3 h-3 ehr-module-chevron" />
          </button>
          {navMenuOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 79 }} onClick={() => setNavMenuOpen(false)} />
              <div className="ehr-user-menu" role="menu" style={{ left: 'var(--ehr-page-inset, 12px)', right: 'auto', width: 'min(230px, calc(100vw - 24px))' }}>
                {tabs.map(tab => {
                  const on = activeTab === tab.key;
                  return (
                    <button key={tab.key} type="button" role="menuitem"
                      onClick={() => { setActiveTab(tab.key); setNavMenuOpen(false); }}
                      style={on ? { background: 'var(--ehr-blue-light)', color: 'var(--ehr-blue)' } : undefined}>
                      <tab.icon size={16} color={on ? 'var(--ehr-blue)' : 'var(--ehr-muted)'} />
                      <span>{tab.label}</span>
                      {tab.count ? <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: on ? 'var(--ehr-blue)' : 'var(--ehr-muted)' }}>{tab.count}</span> : null}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* Inline section shortcuts — the primary health-record sections as
              icon buttons beside the module menu, exactly like the staff rail's
              quick-nav cluster. Collapse into the module menu on small screens. */}
          <span className="hidden lg:flex" style={{ alignItems: 'center', gap: 4 }}>
            {mainTabs.map(tab => {
              const on = activeTab === tab.key;
              return (
                <button key={tab.key} type="button" title={tab.label} aria-label={tab.label}
                  aria-current={on ? 'page' : undefined} onClick={() => setActiveTab(tab.key)}
                  style={on ? { background: 'rgba(255,255,255,0.16)' } : undefined}>
                  <tab.icon className="w-5 h-5" />
                </button>
              );
            })}
          </span>
        </nav>

        {/* Facility name overlaid on the rail's exact center — same as staff. */}
        <div className="ehr-top-center">
          <div className="ehr-top-facility" title={patientFacilityName}><span>{patientFacilityName}</span></div>
        </div>

        {/* Search — indexes this patient's own records and jumps to the tab. */}
        <div className="ehr-top-search">
          <Search className="w-4 h-4" />
          <input
            value={searchQ}
            onChange={e => { setSearchQ(e.target.value); setSearchOpen(e.target.value.trim().length >= 2); }}
            onFocus={() => setSearchOpen(searchQ.trim().length >= 2)}
            placeholder="Search your records, results, medications"
            aria-label="Search your records"
            type="search"
          />
          {searchQ && (
            <button type="button" onClick={() => { setSearchQ(''); setSearchOpen(false); }} aria-label="Clear search"><X className="w-3.5 h-3.5" /></button>
          )}
          {searchOpen && (
            <div className="ehr-top-search-menu">
              {searchResults.length === 0 ? (
                <p>No matches in your records.</p>
              ) : searchResults.map(r => (
                <button key={r.key} type="button" onMouseDown={e => { e.preventDefault(); setActiveTab(r.tab); setSearchQ(''); setSearchOpen(false); }}>
                  <strong>{r.title}</strong>
                  <small>{r.sub}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ehr-top-actions">
          {/* Right-side action shortcuts — the communication / billing sections
              as icon buttons, like the staff rail's right action cluster. */}
          <span className="hidden sm:flex" style={{ alignItems: 'center', gap: 4 }}>
            {actionTabs.filter(tab => tab.key !== 'profile').map(tab => {
              const on = activeTab === tab.key;
              return (
                <button key={tab.key} type="button" title={tab.label} aria-label={tab.label}
                  aria-current={on ? 'page' : undefined} onClick={() => setActiveTab(tab.key)}
                  style={on ? { background: 'rgba(255,255,255,0.16)' } : undefined}>
                  <tab.icon className="w-5 h-5" />
                </button>
              );
            })}
          </span>
          <div className="ehr-user-menu-wrap">
            <button type="button" className={`ehr-avatar ehr-avatar--labeled ${userMenuOpen ? 'active' : ''}`}
              onClick={() => { setUserMenuOpen(o => !o); setNavMenuOpen(false); }}
              aria-expanded={userMenuOpen} aria-haspopup="menu" title={`${patient.firstName} ${patient.surname}`}>
              <span className="ehr-avatar-mark">{initials}</span>
              <span className="ehr-avatar-role">Patient</span>
            </button>
            {userMenuOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 79 }} onClick={() => setUserMenuOpen(false)} />
                <div className="ehr-user-menu" role="menu">
                  <div className="ehr-user-menu-identity" aria-hidden>
                    <span className="ehr-user-menu-name">{patient.firstName} {patient.surname}</span>
                    <span className="ehr-user-menu-facility"><Building2 className="w-3 h-3" /> {patient.hospitalNumber} · {patientFacilityName}</span>
                  </div>
                  <button type="button" role="menuitem" onClick={() => { setActiveTab('profile'); setUserMenuOpen(false); }}>
                    <User className="w-4 h-4" /><span>{t('patientPortal.tabMyProfile')}</span>
                  </button>
                  <button type="button" role="menuitem" className="danger" onClick={onLogout}>
                    <LogOut className="w-4 h-4" /><span>{t('patientPortal.signOut')}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, padding: '20px 24px', width: '100%', maxWidth: 1240, margin: '0 auto' }}>

          {/* ── Chat Panel ── */}
      {/* ═══ Chat / Messages ═══ */}
      {activeTab === 'chat' && (
        <div>
          {/* Hospital & department selector */}
          <div className="card-elevated" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 4 }}>{t('patientPortal.hospital')}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, background: 'var(--overlay-subtle)', border: '1px solid var(--border-medium)' }}>
                  <Building2 size={14} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{patientFacilityName}</span>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 4 }}>{t('patientPortal.department')}</label>
                <Select value={chatDepartment} onChange={e => setChatDepartment(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', background: 'var(--bg-card-solid)', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>
                  {['General / OPD', 'Internal Medicine', 'Obstetrics', 'Pediatrics', 'Surgery', 'Laboratory', 'Pharmacy', 'Dental', 'Emergency'].map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </Select>
              </div>
            </div>
          </div>

          {/* Chat area */}
          <div className="card-elevated" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-medium)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <MessageSquare size={15} style={{ color: 'var(--accent-primary)' }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{chatDepartment}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>&middot; {patientFacilityName}</span>
            </div>
            <div style={{ height: 380, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {chatMessages.map((msg, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: msg.from === 'patient' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '75%', padding: '10px 14px', borderRadius: 12,
                    background: msg.from === 'patient' ? 'var(--accent-primary)' : 'var(--overlay-subtle)',
                    color: msg.from === 'patient' ? 'var(--color-white)' : 'var(--text-primary)',
                    fontSize: 13, lineHeight: 1.5,
                    borderBottomRightRadius: msg.from === 'patient' ? 4 : 12,
                    borderBottomLeftRadius: msg.from === 'system' ? 4 : 12,
                  }}>
                    <p>{msg.text}</p>
                    <p style={{ fontSize: 9, marginTop: 4, opacity: 0.6, textAlign: 'right' }}>{msg.time}</p>
                  </div>
                </div>
              ))}
            </div>
            {chatError && (
              <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border-medium)', background: 'var(--color-danger-bg)', color: 'var(--color-danger-text)', fontSize: 12 }}>
                {chatError}
              </div>
            )}
            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-medium)', display: 'flex', gap: 8 }}>
              <input
                type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { void handleSendChat(); } }}
                placeholder={t('patientPortal.messagePlaceholder', { department: chatDepartment })}
                disabled={chatSending}
                style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border-medium)', background: 'var(--bg-card-solid)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', opacity: chatSending ? 0.6 : 1 }}
              />
              <button
                onClick={() => { void handleSendChat(); }}
                disabled={chatSending || !chatInput.trim()}
                aria-label={t('patientPortal.sendMessage')}
                style={{
                  padding: '10px 14px', borderRadius: 8, border: 'none',
                  cursor: chatSending || !chatInput.trim() ? 'not-allowed' : 'pointer',
                  background: 'var(--accent-primary)', color: 'var(--color-white)',
                  display: 'flex', alignItems: 'center',
                  opacity: chatSending || !chatInput.trim() ? 0.6 : 1,
                }}
              >
                <Send size={16} color="var(--color-white)" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Overview ═══ */}
      {activeTab === 'overview' && (() => {
        /* Extract latest vitals from most recent record */
        const sortedRecs = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const latestRec = sortedRecs[0] as unknown as Record<string, unknown> | undefined;
        const vitals = (latestRec?.vitalSigns || {}) as Record<string, string | number>;
        const latestDate = latestRec?.createdAt ? String(latestRec.createdAt).slice(0, 10) : null;

        /* Prescriptions from service */
        const activeRx = prescriptions.slice(0, 4);

        /* Recent activity timeline */
        type TimelineItem = { date: string; type: string; title: string; detail: string; icon: typeof User; color: string };
        const timeline: TimelineItem[] = [];
        records.slice(0, 3).forEach(rec => {
          const r = rec as unknown as Record<string, unknown>;
          timeline.push({ date: rec.createdAt?.slice(0, 10) || '', type: 'visit', title: (r.visitType as string) || t('patientPortal.consultation'), detail: ((r.diagnoses as Array<{name:string}>) || []).map(d => d.name).join(', ') || t('patientPortal.generalCheckup'), icon: Stethoscope, color: 'var(--accent-primary)' });
        });
        labResults.slice(0, 3).forEach(lab => {
          timeline.push({ date: (lab.orderedAt || lab.createdAt).slice(0, 10), type: 'lab', title: lab.testName, detail: lab.status === 'completed' ? (lab.abnormal ? t('patientPortal.abnormalResult') : t('patientPortal.normalResult')) : t('patientPortal.pending'), icon: FlaskConical, color: lab.abnormal ? 'var(--color-danger)' : 'var(--color-success)' });
        });
        timeline.sort((a, b) => b.date.localeCompare(a.date));

        const pendingLabs = labResults.filter(l => l.status === 'pending').length;
        // Seed/registration data uses 'None' / 'None known' as explicit
        // placeholders — those are the *absence* of an alert, not an alert.
        const realAllergies = (patient.allergies || []).filter(a => a && !/^none\b/i.test(a));
        const realConditions = (patient.chronicConditions || []).filter(c => c && !/^none\b/i.test(c));

        return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: '100%' }}>

          {/* ── Greeting strip — identity lives here now that there is no
              sidebar; the primary action rides on the right. ── */}
          <div className="card-elevated" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'var(--accent-light)', border: '2px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {patient.photoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={patient.photoUrl} alt="" style={{ width: 46, height: 46, borderRadius: '50%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent-hover)' }}>{initials}</span>
              }
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>{t('patientPortal.welcomeBack')}</p>
              <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)', lineHeight: 1.25 }}>{patient.firstName} {patient.surname}</h2>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{patient.hospitalNumber} &middot; {patientFacilityName}</p>
            </div>
            <button onClick={() => setShowBooking(true)} className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <Plus size={14} color="var(--color-white)" /> {t('patientPortal.bookAppointment')}
            </button>
          </div>

          {/* ── Latest Vitals — the clinical at-a-glance strip sits first. ── */}
          <div className="card-elevated" style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <SH icon={Activity} title={t('patientPortal.latestVitals')} />
              {latestDate && <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>{t('patientPortal.recordedDate', { date: latestDate })}</span>}
            </div>
            {Object.keys(vitals).length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginTop: 12 }}>
                {[
                  { key: 'bloodPressure', label: t('patientPortal.bloodPressure'), icon: HeartPulse, unit: 'mmHg' },
                  { key: 'heartRate', label: t('patientPortal.heartRate'), icon: Activity, unit: 'bpm' },
                  { key: 'temperature', label: t('patientPortal.temperature'), icon: Thermometer, unit: '°C' },
                  { key: 'weight', label: t('patientPortal.weight'), icon: Weight, unit: 'kg' },
                  { key: 'respiratoryRate', label: t('patientPortal.respRate'), icon: Droplets, unit: '/min' },
                  { key: 'oxygenSaturation', label: 'SpO₂', icon: Eye, unit: '%' },
                ].filter(v => vitals[v.key]).map(v => (
                  <div key={v.key} style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--overlay-subtle)', border: '1px solid var(--border-medium)', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 6 }}>
                      <v.icon size={12} style={{ color: 'var(--accent-primary)' }} />
                      <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{v.label}</span>
                    </div>
                    <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{String(vitals[v.key])}</p>
                    <p style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{v.unit}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>{t('patientPortal.noVitals')}</p>
            )}
          </div>

          {/* ── Row 1: Upcoming Appointments + Health Alerts (equal height) ──
              Personal info and the visit/prescription/lab counts live on the
              Profile and respective tabs; they are not repeated here. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'stretch' }}>
            {/* Upcoming Appointments */}
            <div className="card-elevated" style={{ padding: 18, display: 'flex', flexDirection: 'column' }}>
              <SH icon={Calendar} title={t('patientPortal.upcomingAppointments')} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', marginTop: 10 }}>
                {upcomingApts.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                    {upcomingApts.slice(0, 3).map((apt, i) => (
                      <div key={apt._id} style={{ padding: 12, borderRadius: 10, background: i === 0 ? 'var(--accent-light)' : 'var(--overlay-subtle)', border: `1px solid ${i === 0 ? 'var(--accent-border)' : 'var(--border-medium)'}`, flex: i === 0 ? 'none' : 'none' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                          <div>
                            <p style={{ fontSize: 14, fontWeight: 700, color: i === 0 ? 'var(--accent-primary)' : 'var(--text-primary)', marginBottom: 2 }}>{t('patientPortal.dateAtTime', { date: apt.appointmentDate, time: apt.appointmentTime })}</p>
                            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{apt.reason || apt.appointmentType}</p>
                            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{/^dr\.?\s/i.test(apt.providerName || '') ? apt.providerName : `${t('patientPortal.drPrefix')} ${apt.providerName}`} &middot; {apt.department}</p>
                          </div>
                          {i === 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: 'var(--accent-primary)', color: 'var(--color-white)', textTransform: 'uppercase', flexShrink: 0 }}>{t('patientPortal.next')}</span>}
                        </div>
                      </div>
                    ))}
                    {upcomingApts.length > 3 && (
                      <button onClick={() => setActiveTab('appointments')} style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-primary)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'center', padding: '6px 0', marginTop: 'auto' }}>
                        {t('patientPortal.moreCount', { count: upcomingApts.length - 3 })}
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px 0' }}>
                    <Calendar size={44} style={{ color: 'var(--text-muted)', opacity: 0.3, marginBottom: 8 }} />
                    <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>{t('patientPortal.noUpcomingAppointments')}</p>
                    <button onClick={() => setShowBooking(true)} style={{ fontSize: 12, fontWeight: 600, padding: '8px 16px', borderRadius: 8, background: 'var(--accent-primary)', color: 'var(--color-white)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Plus size={12} />{t('patientPortal.bookAppointment')}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Health Alerts */}
            <div className="card-elevated" style={{ padding: 18, display: 'flex', flexDirection: 'column' }}>
              <SH icon={AlertTriangle} title={t('patientPortal.healthAlerts')} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, flex: 1 }}>
                {realAllergies.length > 0 && (
                  <AlertRow color="var(--color-danger)" text={t('patientPortal.allergiesList', { list: realAllergies.join(', ') })} />
                )}
                {realConditions.map((c, i) => (
                  <AlertRow key={i} color="var(--color-warning)" text={c} />
                ))}
                {pendingLabs > 0 && (
                  <AlertRow color="var(--accent-primary)" text={t('patientPortal.pendingLabResults', { count: pendingLabs })} />
                )}
                {labResults.some(l => l.critical) && (
                  <AlertRow color="var(--color-danger)" text={t('patientPortal.criticalLabAlert')} />
                )}
                {realAllergies.length === 0 && realConditions.length === 0 && pendingLabs === 0 && (
                  <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--color-success-bg)', border: '1px solid color-mix(in srgb, var(--color-success) 20%, transparent)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CheckCircle2 size={14} color="var(--color-success)" />
                    <span style={{ fontSize: 12, color: 'var(--color-success-text)', fontWeight: 600 }}>{t('patientPortal.noHealthAlerts')}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Row 2: Current Medications + Recent Activity (equal height) ──
              Grows to fill the leftover height so the overview reaches the
              bottom of the viewport instead of leaving a dead background gap. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'stretch', flex: 1 }}>
            {/* Current Medications */}
            <div className="card-elevated" style={{ padding: 18, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <SH icon={Pill} title={t('patient.medications')} />
                {activeRx.length > 0 && <button onClick={() => setActiveTab('prescriptions')} style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-primary)', background: 'none', border: 'none', cursor: 'pointer' }}>{t('patientPortal.viewAll')}</button>}
              </div>
              <div style={{ flex: 1, marginTop: 10 }}>
                {activeRx.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {activeRx.map((rx, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--overlay-subtle)' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{rx.medication}</p>
                          <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatRxSig(rx)}</p>
                        </div>
                        <Badge text={rx.status} color={rx.status === 'dispensed' ? 'var(--color-success)' : 'var(--color-warning)'} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('patientPortal.noMedications')}</p>
                  </div>
                )}
              </div>
            </div>
            {/* Recent Activity */}
            <div className="card-elevated" style={{ padding: 18, display: 'flex', flexDirection: 'column' }}>
              <SH icon={Clock} title={t('patientPortal.recentActivity')} />
              <div style={{ flex: 1, marginTop: 12 }}>
                {timeline.length > 0 ? (
                  <div style={{ position: 'relative', paddingLeft: 20 }}>
                    <div style={{ position: 'absolute', left: 7, top: 4, bottom: 4, width: 2, background: 'var(--border-medium)' }} />
                    {timeline.slice(0, 5).map((item, i) => (
                      <div key={i} style={{ position: 'relative', marginBottom: i < Math.min(timeline.length, 5) - 1 ? 14 : 0 }}>
                        <div style={{ position: 'absolute', left: -16, top: 2, width: 16, height: 16, borderRadius: '50%', background: `color-mix(in srgb, ${item.color} 15%, transparent)`, border: `2px solid ${item.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: item.color }} />
                        </div>
                        <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 1 }}>{item.date}</p>
                        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{item.title}</p>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.detail}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('patientPortal.noRecentActivity')}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ═══ Appointments ═══ */}
      {activeTab === 'appointments' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{t('patientPortal.yourAppointments', { count: appointments.length })}</h2>
            <button onClick={() => setShowBooking(true)} className="btn btn-primary btn-sm" style={{ gap: 4 }}><Plus size={13} /> {t('patientPortal.bookNew')}</button>
          </div>
          {appointments.length === 0 ? (
            <Empty icon={Calendar} text={t('patientPortal.noAppointmentsYet')} action={t('patientPortal.bookAppointment')} onAction={() => setShowBooking(true)} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {appointments.sort((a, b) => b.appointmentDate.localeCompare(a.appointmentDate)).map(apt => {
                const isPast = apt.status === 'completed' || apt.status === 'cancelled' || apt.status === 'no_show';
                return (
                  <div key={apt._id} className="card-elevated" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ minWidth: 48, textAlign: 'center' }}>
                      <div className="stat-value" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{formatClockTime(apt.appointmentTime)}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{apt.appointmentDate}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{apt.reason || apt.appointmentType}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{/^dr\.?\s/i.test(apt.providerName || '') ? apt.providerName : `${t('patientPortal.drPrefix')} ${apt.providerName}`} &middot; {apt.department}</div>
                    </div>
                    {(() => {
                      // KAN-124: the server attaches a join path only for live
                      // telehealth appointments with a usable session — this
                      // button is the patient's entry point to the video visit.
                      const joinPath = (apt as AppointmentDoc & { telehealth?: { joinPath: string } }).telehealth?.joinPath;
                      if (!joinPath || isPast) return null;
                      return (
                        <a
                          href={joinPath}
                          style={{
                            fontSize: 12, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap',
                            background: 'var(--accent-primary)', borderRadius: 8, padding: '7px 12px',
                            display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none',
                          }}
                        >
                          <Video style={{ width: 14, height: 14 }} />
                          {t('patientPortal.joinVideoVisit')}
                        </a>
                      );
                    })()}
                    <Badge text={apt.status.replace('_', ' ')} color={isPast ? 'var(--text-muted)' : apt.status === 'confirmed' ? 'var(--color-success)' : 'var(--accent-primary)'} />
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
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>{t('patientPortal.medicalRecordsCount', { count: records.length })}</h2>
          {records.length === 0 ? (
            <Empty icon={FileText} text={t('patientPortal.noMedicalRecords')} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(rec => (
                <div key={rec._id} className="card-elevated" style={{ overflow: 'hidden' }}>
                  <button onClick={() => setExpandedId(expandedId === rec._id ? null : rec._id)} style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                    background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                  }}>
                    <div style={{ minWidth: 70, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{rec.createdAt?.slice(0, 10)}</div>
                    <FileText size={14} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {(rec as unknown as Record<string, unknown>).visitType as string || t('patientPortal.consultation')}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {((rec as unknown as Record<string, unknown>).diagnoses as Array<{name: string}> || []).map(d => d.name).join(', ') || t('patientPortal.noDiagnosisRecorded')}
                      </div>
                    </div>
                    <ChevronRight size={14} style={{ color: 'var(--text-muted)', transform: expandedId === rec._id ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                  </button>
                  {expandedId === rec._id && (
                    <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border-medium)', paddingTop: 12 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', alignItems: 'stretch', gap: 10 }}>
                        {((rec as unknown as Record<string, unknown>).vitalSigns as Record<string, unknown>) && (
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>{t('patientPortal.vitalSigns')}</div>
                            {Object.entries((rec as unknown as Record<string, unknown>).vitalSigns as Record<string, unknown>).filter(([, v]) => v).map(([k, v]) => (
                              <div key={k} style={{ fontSize: 12, color: 'var(--text-primary)' }}>{k}: <strong>{String(v)}</strong></div>
                            ))}
                          </div>
                        )}
                        {((rec as unknown as Record<string, unknown>).prescriptions as Array<{medication: string; dosage: string}> || []).length > 0 && (
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>{t('patientPortal.tabPrescriptions')}</div>
                            {((rec as unknown as Record<string, unknown>).prescriptions as Array<{medication: string; dosage: string}>).map((rx, i) => (
                              <div key={i} style={{ fontSize: 12, color: 'var(--text-primary)' }}>{rx.medication} — {rx.dosage}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ Lab Results ═══ */}
      {activeTab === 'lab' && (
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>{t('patientPortal.labResultsCount', { count: labResults.length })}</h2>
          {labResults.length === 0 ? (
            <Empty icon={FlaskConical} text={t('patientPortal.noLabResults')} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {labResults.sort((a, b) => (b.orderedAt || b.createdAt).localeCompare(a.orderedAt || a.createdAt)).map(lab => (
                <div key={lab._id} className="card-elevated" style={{ overflow: 'hidden' }}>
                  <button onClick={() => setExpandedId(expandedId === lab._id ? null : lab._id)} style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                    background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                  }}>
                    <div style={{ minWidth: 70, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{(lab.orderedAt || lab.createdAt).slice(0, 10)}</div>
                    <FlaskConical size={14} color={lab.status === 'pending' ? 'var(--color-warning)' : lab.abnormal ? 'var(--color-danger)' : 'var(--color-success)'} style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{lab.testName}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{lab.specimen} &middot; {lab.orderedBy}</div>
                    </div>
                    <Badge text={lab.status === 'completed' ? (lab.abnormal ? t('patientPortal.abnormal') : t('patientPortal.normal')) : lab.status}
                      color={lab.status === 'pending' ? 'var(--color-warning)' : lab.abnormal ? 'var(--color-danger)' : 'var(--color-success)'} />
                    <ChevronRight size={14} style={{ color: 'var(--text-muted)', transform: expandedId === lab._id ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                  </button>
                  {expandedId === lab._id && lab.status === 'completed' && (
                    <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border-medium)', paddingTop: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 'var(--card-radius)', background: lab.abnormal ? 'var(--color-danger-bg)' : 'var(--color-success-bg)' }}>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t('patientPortal.result')}</div>
                          <div className="stat-value" style={{ fontSize: 15, fontWeight: 700, color: lab.abnormal ? 'var(--color-danger-text)' : 'var(--text-primary)' }}>{lab.result}</div>
                        </div>
                        {lab.referenceRange && (
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t('patientPortal.reference')}</div>
                            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{lab.referenceRange} {lab.unit}</div>
                          </div>
                        )}
                      </div>
                      {lab.critical && (
                        <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 'var(--card-radius)', background: 'var(--color-danger-bg)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <AlertTriangle size={12} style={{ color: 'var(--color-danger)' }} />
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-danger-text)' }}>{t('patientPortal.criticalResult')}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ Prescriptions ═══ */}
      {activeTab === 'prescriptions' && (
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>{t('patientPortal.prescriptionsCount', { count: prescriptions.length })}</h2>
          {prescriptions.length === 0 ? (
            <Empty icon={Pill} text={t('patientPortal.noPrescriptions')} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {prescriptions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(rx => (
                <div key={rx._id} className="card-elevated" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{rx.medication}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatRxSig(rx)}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{t('patientPortal.prescribedBy', { name: rx.prescribedBy })}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <Badge text={rx.status} color={rx.status === 'dispensed' ? 'var(--color-success)' : 'var(--color-warning)'} />
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{rx.createdAt.slice(0, 10)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ Radiology & Imaging ═══ */}
      {activeTab === 'radiology' && (
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>{t('patientPortal.tabRadiology')}</h2>
          {/* Honesty note: these are imaging-related order/report records pulled
              from lab results — NOT the actual scan images (no PACS viewer). */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', marginBottom: 14, borderRadius: 8, background: 'var(--overlay-subtle)', border: '1px solid var(--border-medium)' }}>
            <AlertTriangle size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>{t('patientPortal.imagingDisclaimer')}</p>
          </div>
          {/* Imaging-related entries derived from lab results (e.g. ordered X-rays,
              ultrasound/CT/MRI reports). This is record/report metadata, not the
              scan images themselves. */}
          {(() => {
            const imagingTests = labResults.filter(l =>
              /x-ray|xray|mri|ct scan|ultrasound|radiology|imaging|echo|mammogram/i.test(l.testName || '')
            );
            return imagingTests.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {imagingTests.map(img => (
                  <div key={img._id} className="card-elevated" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{img.testName}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{(img.orderedAt || img.createdAt).slice(0, 10)} · {img.orderedBy}</div>
                    </div>
                    <Badge text={img.status} color={img.status === 'pending' ? 'var(--color-warning)' : 'var(--accent-primary)'} />
                  </div>
                ))}
              </div>
            ) : (
              <div>
                <Empty icon={Scan} text={t('patientPortal.noImagingResults')} />
                <div className="card-elevated" style={{ padding: 18, marginTop: 14 }}>
                  <SH icon={Scan} title={t('patientPortal.availableImagingServices')} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                    {['X-Ray', 'Ultrasound', 'CT Scan', 'MRI', 'Echocardiogram', 'Mammogram'].map(svc => (
                      <div key={svc} style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--overlay-subtle)', border: '1px solid var(--border-medium)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Scan size={13} style={{ color: 'var(--accent-primary)' }} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{svc}</span>
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
                    {t('patientPortal.imagingNotice')}
                  </p>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ═══ Billing & Payments ═══ */}
      {activeTab === 'billing' && <BillingTab patient={patient} sessionToken={sessionToken} />}

      {/* ═══ Immunizations ═══ */}
      {activeTab === 'immunizations' && (
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>{t('patientPortal.immunizationRecordCount', { count: immunizations.length })}</h2>
          {immunizations.length === 0 ? (
            <div>
              <Empty icon={Syringe} text={t('patientPortal.noImmunizations')} />
              <div className="card-elevated" style={{ padding: 18, marginTop: 14 }}>
                <SH icon={Syringe} title={t('patientPortal.aboutImmunizations')} />
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.6 }}>
                  {t('patientPortal.immunizationNotice')}
                </p>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {immunizations.sort((a, b) => b.dateGiven.localeCompare(a.dateGiven)).map(imm => (
                <div key={imm._id} className="card-elevated" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{imm.vaccine} — {t('patientPortal.doseNumber', { number: imm.doseNumber })}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('patientPortal.siteBatch', { site: imm.site, batch: imm.batchNumber })}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{t('patientPortal.administeredBy', { name: imm.administeredBy, facility: imm.facilityName })}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{imm.dateGiven}</div>
                    {imm.nextDueDate && <div style={{ fontSize: 10, color: 'var(--color-warning-text)', marginTop: 2 }}>{t('patientPortal.nextDue', { date: imm.nextDueDate })}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
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
                <Building2 size={14} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
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
      </div>
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
    { label: t('patientPortal.dateOfBirth'), value: patient.dateOfBirth || `~${patient.estimatedAge} years` },
    { label: t('patient.gender'), value: patient.gender },
    { label: t('patient.bloodType'), value: patient.bloodType || '—' },
    { label: t('patient.phone'), value: patient.phone || '—' },
    { label: t('patientPortal.geocodeId'), value: patient.geocodeId || '—' },
    { label: t('patientPortal.county'), value: patient.county || '—' },
    { label: t('patientPortal.state'), value: patient.state || '—' },
    { label: t('patient.hospitalNumber'), value: patient.hospitalNumber || '—' },
    { label: t('patientPortal.registrationHospital'), value: facilityName },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{t('patientPortal.tabMyProfile')}</h2>
      </div>

      {/* Profile header */}
      <div className="card-elevated" style={{ padding: 20, marginBottom: 16, textAlign: 'center' }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--accent-light)', border: '3px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
          {patient.photoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={patient.photoUrl} alt="" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover' }} />
            : <User size={44} style={{ color: 'var(--accent-primary)' }} />
          }
        </div>
        <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{patient.firstName} {patient.surname}</p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{patient.hospitalNumber} · {facilityName}</p>
      </div>

      {/* Fields grid */}
      <div className="card-elevated" style={{ padding: 18 }}>
        <SH icon={User} title={t('patientPortal.personalDetails')} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
          {fields.map((f, i) => (
            <div key={i}>
              <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{f.label}</p>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{f.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Emergency contact */}
      <div className="card-elevated" style={{ padding: 18, marginTop: 14 }}>
        <SH icon={Phone} title={t('patientPortal.emergencyContact')} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
          <Info label={t('patientPortal.name')} value={patient.nokName || '—'} />
          <Info label={t('patient.phone')} value={patient.nokPhone || '—'} />
          <Info label={t('patientPortal.relationship')} value={patient.nokRelationship || '—'} />
        </div>
      </div>

      {/* Allergies & chronic conditions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
        <div className="card-elevated" style={{ padding: 18 }}>
          <SH icon={AlertTriangle} title={t('patient.allergies')} />
          <div style={{ marginTop: 10 }}>
            {(patient.allergies || []).length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {patient.allergies.map((a, i) => (
                  <span key={i} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 6, background: 'var(--color-danger-bg)', color: 'var(--color-danger-text)', border: '1px solid color-mix(in srgb, var(--color-danger) 20%, transparent)' }}>{a}</span>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('patientPortal.noKnownAllergies')}</p>
            )}
          </div>
        </div>
        <div className="card-elevated" style={{ padding: 18 }}>
          <SH icon={HeartPulse} title={t('patient.chronicConditions')} />
          <div style={{ marginTop: 10 }}>
            {(patient.chronicConditions || []).length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {patient.chronicConditions.map((c, i) => (
                  <span key={i} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 6, background: 'var(--color-warning-bg)', color: 'var(--color-warning-text)', border: '1px solid color-mix(in srgb, var(--color-warning) 20%, transparent)' }}>{c}</span>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('patientPortal.noChronicConditions')}</p>
            )}
          </div>
        </div>
      </div>

      {/* Note about editable fields */}
      <div className="card-elevated" style={{ padding: 14, marginTop: 14, background: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {t('patientPortal.protectedFieldsNote')}
        </p>
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
  const totalOwed = safeBills.reduce((s, b) => s + (b.amount - b.paid), 0);
  const totalPaid = safeBills.reduce((s, b) => s + b.paid, 0);
  const selectedTotal = safeBills.filter(b => selectedBills.includes(b.id)).reduce((s, b) => s + (b.amount - b.paid), 0);

  const statusColor = (s: BillItem['status']) => {
    switch (s) {
      case 'paid': return 'var(--color-success)';
      case 'partial': return 'var(--color-warning)';
      case 'unpaid': return 'var(--accent-primary)';
      case 'overdue': return 'var(--color-danger)';
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
      <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
        <div className="card-elevated" style={{ padding: '40px 28px', borderTop: '4px solid var(--color-success)' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--color-success-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <CheckCircle2 size={56} color="var(--color-success)" />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>{t('patientPortal.paymentRecorded')}</h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            {payMethod === 'mpesa' || payMethod === 'mtn' || payMethod === 'airtel'
              ? t('patientPortal.successMobilePrompt')
              : payMethod === 'card'
              ? t('patientPortal.successCardRedirect')
              : t('patientPortal.successBankTransfer')}
          </p>
          {failedCount > 0 && (
            <div style={{ padding: 10, borderRadius: 8, marginBottom: 14, background: 'var(--color-danger-bg)', border: '1px solid color-mix(in srgb, var(--color-danger) 20%, transparent)' }}>
              <p style={{ fontSize: 12, color: 'var(--color-danger-text)', fontWeight: 600 }}>
                {t('patientPortal.billsNotUpdated', { count: failedCount })}
              </p>
            </div>
          )}
          <div style={{ padding: 16, borderRadius: 10, background: 'var(--overlay-subtle)', border: '1px solid var(--border-medium)', textAlign: 'left', marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t('patientPortal.reference')}</p><p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{refNum}</p></div>
              <div><p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t('portal.amount')}</p><p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{formatMoney(paidAmount)}</p></div>
              <div><p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t('portal.method')}</p><p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{paymentMethods.find(m => m.key === payMethod)?.name}</p></div>
              <div><p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t('patientPortal.bills')}</p><p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{t('patientPortal.itemCount', { count: billCount })}</p></div>
            </div>
            {payMethod === 'bank' && (
              <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: 'rgba(0,137,123,0.06)', border: '1px solid rgba(0,137,123,0.15)' }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#00897B', marginBottom: 6 }}>{t('patientPortal.bankTransferDetails')}</p>
                {bankDetails ? (
                  <>
                    {bankDetails.split('\n').map((line, i) => (
                      <p key={i} style={{ fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{line}</p>
                    ))}
                    <p style={{ fontSize: 12, color: 'var(--text-primary)' }}>{t('patientPortal.refLabel')} <strong>{refNum}</strong></p>
                  </>
                ) : IS_DEMO ? (
                  <>
                    <p style={{ fontSize: 12, color: 'var(--text-primary)' }}>{t('patientPortal.bankLabel')} <strong>KCB Bank South Sudan</strong></p>
                    <p style={{ fontSize: 12, color: 'var(--text-primary)' }}>{t('patientPortal.accountLabel')} <strong>720-184-2930</strong></p>
                    <p style={{ fontSize: 12, color: 'var(--text-primary)' }}>{t('patientPortal.nameLabel')} <strong>TamamHealth Health Services</strong></p>
                    <p style={{ fontSize: 12, color: 'var(--text-primary)' }}>{t('patientPortal.refLabel')} <strong>{refNum}</strong></p>
                  </>
                ) : (
                  <p style={{ fontSize: 12, color: 'var(--text-primary)' }}>{t('patientPortal.bankTransferContactBilling')}</p>
                )}
              </div>
            )}
          </div>
          <button onClick={() => { setStep('bills'); setSelectedBills([]); setPayMethod(null); setLastPayment(null); }} style={{ fontSize: 13, fontWeight: 600, padding: '10px 24px', borderRadius: 8, background: 'var(--accent-primary)', color: 'var(--color-white)', border: 'none', cursor: 'pointer' }}>{t('patientPortal.done')}</button>
        </div>
      </div>
    );
  }

  if (step === 'confirm') {
    const method = paymentMethods.find(m => m.key === payMethod)!;
    return (
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <button onClick={() => setStep('method')} style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-primary)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4 }}>← {t('action.back')}</button>
        <div className="card-elevated" style={{ padding: 20, borderTop: `4px solid ${method.color}` }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>{t('patientPortal.confirmPayment')}</h3>
          <div style={{ padding: 14, borderRadius: 10, background: 'var(--overlay-subtle)', border: '1px solid var(--border-medium)', marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Info label={t('patientPortal.totalAmount')} value={formatMoney(selectedTotal)} />
              <Info label={t('patientPortal.paymentMethod')} value={method.name} />
              <Info label={t('patientPortal.items')} value={t('patientPortal.billCount', { count: selectedBills.length })} />
              {(payMethod === 'mpesa' || payMethod === 'mtn' || payMethod === 'airtel') && <Info label={t('patient.phone')} value={payPhone} />}
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>{t('patientPortal.billsIncluded')}</p>
            {safeBills.filter(b => selectedBills.includes(b.id)).map(b => (
              <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-medium)' }}>
                <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{b.description}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{formatMoney(b.amount - b.paid)}</span>
              </div>
            ))}
          </div>
          {(payMethod === 'mpesa' || payMethod === 'mtn' || payMethod === 'airtel') && (
            <div style={{ padding: 10, borderRadius: 8, background: `color-mix(in srgb, ${method.color} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${method.color} 20%, transparent)`, marginBottom: 14 }}>
              <p style={{ fontSize: 11, color: method.color, fontWeight: 600 }}>{t('patientPortal.paymentPromptNotice', { phone: payPhone })}</p>
            </div>
          )}
          {payError && (
            <div style={{ padding: 10, borderRadius: 8, background: 'var(--color-danger-bg)', border: '1px solid color-mix(in srgb, var(--color-danger) 20%, transparent)', marginBottom: 14 }}>
              <p style={{ fontSize: 12, color: 'var(--color-danger-text)', fontWeight: 600 }}>{payError}</p>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setStep('method')}
              disabled={paying}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 8, border: '1px solid var(--border-medium)',
                background: 'var(--bg-card-solid)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600,
                cursor: paying ? 'not-allowed' : 'pointer', opacity: paying ? 0.6 : 1,
              }}
            >{t('action.cancel')}</button>
            <button
              onClick={() => { void submitPayment(); }}
              disabled={paying}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 8, border: 'none', background: method.color,
                color: 'var(--color-white)', fontSize: 13, fontWeight: 700, cursor: paying ? 'not-allowed' : 'pointer',
                opacity: paying ? 0.6 : 1,
              }}
            >{paying ? t('patientPortal.recording') : t('patientPortal.payAmount', { amount: `${selectedTotal.toLocaleString()} SSP` })}</button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'method') {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <button onClick={() => setStep('bills')} style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-primary)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4 }}>← {t('portal.backToBillsBtn')}</button>
        <div className="card-elevated" style={{ padding: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{t('portal.choosePaymentMethod')}</h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>{t('patientPortal.totalLabel')} <strong style={{ color: 'var(--text-primary)' }}>{formatMoney(selectedTotal)}</strong> {t('patientPortal.forBills', { count: selectedBills.length })}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {paymentMethods.map(m => (
              <button key={m.key} onClick={() => setPayMethod(m.key)} style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 16px',
                borderRadius: 10, border: payMethod === m.key ? `2px solid ${m.color}` : '1px solid var(--border-medium)',
                background: payMethod === m.key ? `color-mix(in srgb, ${m.color} 8%, transparent)` : 'var(--bg-card-solid)',
                cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
              }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: `color-mix(in srgb, ${m.color} 12%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <m.icon size={44} color={m.color} />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{m.name}</p>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.desc}</p>
                </div>
                {payMethod === m.key && <CheckCircle2 size={44} color={m.color} />}
              </button>
            ))}
          </div>
          {payMethod && (payMethod === 'mpesa' || payMethod === 'mtn' || payMethod === 'airtel') && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>{t('patientPortal.phoneNumber')}</label>
              <input type="tel" value={payPhone} onChange={e => setPayPhone(e.target.value)} placeholder={t('patientPortal.payPhonePlaceholder')}
                style={{ width: '100%', padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border-medium)', background: 'var(--bg-card-solid)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }} />
            </div>
          )}
          <button onClick={() => payMethod && setStep('confirm')} disabled={!payMethod}
            style={{ width: '100%', padding: '12px 0', borderRadius: 8, border: 'none', background: payMethod ? 'var(--accent-primary)' : 'var(--border-medium)', color: 'var(--color-white)', fontSize: 14, fontWeight: 700, cursor: payMethod ? 'pointer' : 'not-allowed', opacity: payMethod ? 1 : 0.5 }}>
            {t('patientPortal.continueToConfirm')}
          </button>
        </div>
      </div>
    );
  }

  /* Bills list (default step) */
  const isLoading = bills === null;

  // Loading skeleton — keeps the page visually quiet until the PouchDB query
  // resolves, instead of flashing an empty state.
  if (isLoading) {
    return (
      <div className="card-elevated" style={{ textAlign: 'center', padding: 40 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('patientPortal.loadingBills')}</p>
      </div>
    );
  }

  // Hard-error state (PouchDB query threw). Loadable but useless without
  // the data, so we surface this rather than pretending all bills are
  // settled.
  if (loadError && safeBills.length === 0) {
    return (
      <div className="card-elevated" style={{ textAlign: 'center', padding: 40 }}>
        <Receipt size={56} style={{ color: 'var(--color-danger)', opacity: 0.6, margin: '0 auto 10px' }} />
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>{loadError}</p>
      </div>
    );
  }

  // Friendly empty state — distinguishes "no bills on file" from a load
  // error, so a brand-new patient doesn't see scary copy.
  if (safeBills.length === 0) {
    return (
      <div>
        <div className="hero-banner hero-banner--compact" style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.7, marginBottom: 4 }}>{t('patientPortal.accountSummary')}</p>
          <p style={{ fontSize: 28, fontWeight: 700 }}>0 <span style={{ fontSize: 14, opacity: 0.7 }}>SSP</span></p>
          <p style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase' }}>{t('patientPortal.outstandingBalance')}</p>
        </div>
        <div className="card-elevated" style={{ textAlign: 'center', padding: 40 }}>
          <Receipt size={56} style={{ color: 'var(--text-muted)', opacity: 0.3, margin: '0 auto 10px' }} />
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {t('patientPortal.noBillsOnFile')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Balance banner */}
      <div className="hero-banner hero-banner--compact" style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.7, marginBottom: 4 }}>{t('patientPortal.accountSummary')}</p>
        <div style={{ display: 'flex', gap: 30, flexWrap: 'wrap', marginTop: 8 }}>
          <div>
            <p style={{ fontSize: 28, fontWeight: 700 }}>{totalOwed.toLocaleString()} <span style={{ fontSize: 14, opacity: 0.7 }}>SSP</span></p>
            <p style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase' }}>{t('patientPortal.outstandingBalance')}</p>
          </div>
          <div>
            <p style={{ fontSize: 28, fontWeight: 700 }}>{totalPaid.toLocaleString()} <span style={{ fontSize: 14, opacity: 0.7 }}>SSP</span></p>
            <p style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase' }}>{t('portal.totalPaid')}</p>
          </div>
          <div>
            <p style={{ fontSize: 28, fontWeight: 700 }}>{safeBills.length}</p>
            <p style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase' }}>{t('patientPortal.totalBills')}</p>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'stretch', gap: 14 }}>
        {/* Bills list */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{t('portal.yourBills')}</h3>
            {selectedBills.length > 0 && (
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-primary)' }}>{t('patientPortal.selectedCount', { count: selectedBills.length })}</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {safeBills.map(bill => {
              const remaining = bill.amount - bill.paid;
              const isSelectable = remaining > 0;
              const isSelected = selectedBills.includes(bill.id);
              return (
                <div key={bill.id} className="card-elevated" style={{
                  padding: '14px 16px', borderTop: `3px solid ${statusColor(bill.status)}`,
                  opacity: bill.status === 'paid' ? 0.7 : 1,
                  cursor: isSelectable ? 'pointer' : 'default',
                  outline: isSelected ? `2px solid var(--accent-primary)` : 'none',
                  outlineOffset: -2,
                }} onClick={() => {
                  if (!isSelectable) return;
                  setSelectedBills(prev => prev.includes(bill.id) ? prev.filter(id => id !== bill.id) : [...prev, bill.id]);
                }}>
                  <div style={{ display: 'flex', alignItems: 'start', gap: 12 }}>
                    {isSelectable && (
                      <div style={{
                        width: 20, height: 20, borderRadius: 4, marginTop: 2, flexShrink: 0,
                        border: isSelected ? 'none' : '2px solid var(--border-medium)',
                        background: isSelected ? 'var(--accent-primary)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {isSelected && <CheckCircle2 size={14} color="var(--color-white)" />}
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 4 }}>
                        <div>
                          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{bill.description}</p>
                          <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{bill.department} &middot; {bill.date}</p>
                        </div>
                        <Badge text={bill.status} color={statusColor(bill.status)} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('patientPortal.totalAmountSsp', { amount: bill.amount.toLocaleString() })}</span>
                        {remaining > 0 ? (
                          <span style={{ fontSize: 14, fontWeight: 700, color: statusColor(bill.status) }}>{t('patientPortal.amountDue', { amount: remaining.toLocaleString() })}</span>
                        ) : (
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-success-text)' }}>{t('patientPortal.fullyPaid')}</span>
                        )}
                      </div>
                      {bill.status === 'partial' && (
                        <div style={{ marginTop: 6, height: 4, borderRadius: 2, background: 'var(--border-medium)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${(bill.paid / bill.amount) * 100}%`, background: 'var(--color-warning)', borderRadius: 2 }} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Payment sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Pay selected */}
          <div className="card-elevated" style={{ padding: 18, borderTop: '3px solid var(--accent-primary)' }}>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
              {selectedBills.length > 0 ? t('patientPortal.paySelectedBills') : t('patientPortal.selectBillsToPay')}
            </h4>
            {selectedBills.length > 0 ? (
              <>
                <div style={{ padding: 12, borderRadius: 8, background: 'var(--accent-light)', border: '1px solid var(--accent-border)', marginBottom: 12, textAlign: 'center' }}>
                  <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>{t('portal.amountToPay')}</p>
                  <p style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-primary)' }}>{selectedTotal.toLocaleString()} <span style={{ fontSize: 12 }}>SSP</span></p>
                </div>
                <button onClick={() => setStep('method')} style={{ width: '100%', padding: '12px 0', borderRadius: 8, border: 'none', background: 'var(--accent-primary)', color: 'var(--color-white)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  {t('patientPortal.proceedToPay')}
                </button>
              </>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('patientPortal.tapToSelect')}</p>
            )}
            {safeBills.filter(b => b.amount - b.paid > 0).length > 0 && selectedBills.length === 0 && (
              <button onClick={() => setSelectedBills(safeBills.filter(b => b.amount - b.paid > 0).map(b => b.id))} style={{ width: '100%', marginTop: 10, padding: '10px 0', borderRadius: 8, border: '1px solid var(--accent-primary)', background: 'transparent', color: 'var(--accent-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {t('patientPortal.selectAllOutstanding')}
              </button>
            )}
          </div>

          {/* Payment methods info */}
          <div className="card-elevated" style={{ padding: 18 }}>
            <SH icon={CreditCard} title={t('portal.acceptedPaymentMethods')} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
              {paymentMethods.map(m => (
                <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--overlay-subtle)' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: `color-mix(in srgb, ${m.color} 12%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <m.icon size={13} color={m.color} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{m.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Payment history summary */}
          <div className="card-elevated" style={{ padding: 18, background: 'var(--accent-hover)', border: 'none' }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>{t('patientPortal.paymentSummary')}</p>
            {[
              { label: t('patientPortal.totalBilled'), value: formatMoney(safeBills.reduce((s, b) => s + b.amount, 0)) },
              { label: t('portal.totalPaid'), value: formatMoney(totalPaid) },
              { label: t('patientPortal.outstanding'), value: formatMoney(totalOwed) },
              { label: t('patientPortal.overdue'), value: formatMoney(safeBills.filter(b => b.status === 'overdue').reduce((s, b) => s + (b.amount - b.paid), 0)) },
            ].map((row, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < 3 ? '1px solid rgba(255,255,255,0.08)' : 'none' }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{row.label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-white)' }}>{row.value}</span>
              </div>
            ))}
          </div>

          {/* Help */}
          <div className="card-elevated" style={{ padding: 14 }}>
            <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              <strong>{t('patientPortal.needHelpLabel')}</strong> {t('patientPortal.needHelpBody')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Helpers ─── */
function SH({ icon: Icon, title }: { icon: typeof User; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <Icon size={14} style={{ color: 'var(--accent-primary)' }} />
      <span style={{ fontFamily: "var(--font-platform)", fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</span>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

// Both helpers accept `color` as either a hex literal or a CSS `var(--x)`
// reference. Alpha-tinted backgrounds are computed with `color-mix()` rather
// than string-concatenating a hex alpha suffix onto `color` — the latter
// silently produces an invalid value (e.g. `var(--color-danger)12`) whenever
// a var() reference is passed in, leaving the background transparent.
function AlertRow({ color, text }: { color: string; text: string }) {
  return (
    <div style={{
      padding: '8px 10px', borderRadius: 'var(--card-radius)',
      background: `color-mix(in srgb, ${color} 8%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 18%, transparent)`,
      display: 'flex', alignItems: 'center', gap: 7,
    }}>
      <span style={{ fontSize: 12, color }}>{text}</span>
    </div>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, color,
      background: `color-mix(in srgb, ${color} 14%, transparent)`, textTransform: 'capitalize',
    }}>{text}</span>
  );
}

function Empty({ icon: Icon, text, action, onAction }: { icon: typeof User; text: string; action?: string; onAction?: () => void }) {
  return (
    <div className="card-elevated" style={{ textAlign: 'center', padding: 40 }}>
      <Icon size={56} style={{ color: 'var(--text-muted)', opacity: 0.3, margin: '0 auto 10px' }} />
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: action ? 10 : 0 }}>{text}</p>
      {action && onAction && <button onClick={onAction} className="btn btn-primary btn-sm" style={{ gap: 4 }}><Plus size={13} /> {action}</button>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PATIENT PORTAL STYLES — matches main landing page design
   ═══════════════════════════════════════════════════════════════ */
const patientPortalCSS = `
/* The portal header, section menu, search, and user menu reuse the shared
   .ehr-top-* classes from globals.css — the same rail the clinical-officer
   shell uses — so no portal-specific header CSS is needed here. */
`;

'use client';

import { useState, useEffect, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, ChevronRight, X, WifiOff } from '@/components/icons/lucide';
import { Icon } from '@/components/icons';
import { useAuth } from '@/lib/context';
import { resolveLandingPage } from '@/lib/user-prefs';
import type { UserRole } from '@/lib/db-types';

// Tamam brand accent — sourced from the shared theme tokens.
const ACCENT = 'var(--accent-primary)';
const ACCENT_DEEP = 'var(--accent-hover)';

// Real display names for each demo account (from the seed roster).
const ACCOUNT_NAME: Record<string, string> = {
  'desk.amira': 'Amira Juma Hassan',
  'reg.clerk': 'Grace Poni Lukudu',
  'clinic.clerk': 'Joseph Taban Lado',
  'cashier.deng': 'Deng Akec Ring',
  'biller.nyandeng': 'Nyandeng Chol Atem',
  'triage.mary': 'Mary Nyaruai Gai',
  'rooming.sara': 'Sara Aluel Bol',
  'nurse.stella': 'Stella Keji Lemi',
  'midwife.nyakong': 'Nyakong Gatkuoth',
  'co.deng': 'Deng Mabior Kuol',
  'clinician.peter': 'Dr. Peter Garang Deng',
  'lab.gatluak': 'Gatluak Puok',
  'rad.tamamhealth': 'Ladu Soro',
  'pharma.rose': 'Rose Gbudue',
  'nutr.nyabol': 'Nyabol Koang Jal',
  'data.ayen': 'Ayen Dut Malual',
  'hmis.john': 'John Majok Chol',
  'org.admin': 'Mercy Org Administrator',
  'county.lopez': 'Dr. Lopez Lokai Modi',
  'admin': 'Ministry of Health',
  'superadmin': 'TamamHealth Platform Admin',
};

// Hero-image pool — every user's sign-in screen gets a distinct photo. With more
// accounts than photos a few repeat, but never adjacent within a group.
const IMAGE_POOL = [
  '/assets/patients/community-health-worker.jpg',
  '/assets/community-health-worker.jpg',
  '/assets/patients/portrait-man-camera.jpg',
  '/assets/patients/portrait-man-beanie.jpg',
  '/assets/health-data.jpg',
  '/assets/patients/doctor-writing-notes.jpg',
  '/assets/patients/african-nurse.jpg',
  '/assets/african-nurse.jpg',
  '/assets/patients/doctor-nurse-consultation.jpg',
  '/assets/doctor-nurse-consultation.jpg',
  '/assets/patients/doctor-prescription.jpg',
  '/assets/patients/doctor-tablet-review.jpg',
  '/assets/doctor-tablet-smiling.jpg',
  '/assets/patients/doctor-tablet-smiling.jpg',
  '/assets/patients/founder-teny.jpg',
  '/assets/patients/founder-ekow.jpg',
  '/assets/patients/founder-toye.jpg',
  '/assets/moh.jpg',
  '/assets/landing-img.jpg',
];

// Demo roster — passwords are fetched at runtime from /api/demo-credentials.
// One login per distinct role: no duplicates. The workflow-station roles from
// the EHR Clinical Flow doc are the source of truth; the older overlapping
// roles (Doctor, HRIO, Med. Superintendent) map onto Clinician, Records/HMIS
// Officer, and Facility Administrator respectively. The Medical Receptionist
// (front_desk) is surfaced explicitly so its Reception dashboard is reachable.
// Batched by facility, escalating up the health system: Juba Teaching Hospital
// carries the full patient journey start-to-finish (reception → registration →
// triage → consult → diagnostics → pharmacy → billing → records), then the
// other facilities, then group/county oversight, ending at the Ministry of
// Health and platform admin. The `group` drives the section headers.
const demoAccounts: { role: string; roleKey: UserRole; user: string; desc: string; hospital: string; group: string }[] = [
  // 1 ── Juba Teaching Hospital: the whole journey at one facility, in the
  //      order a patient meets each role.
  { group: 'Juba Teaching Hospital',    role: 'Medical Receptionist',   roleKey: 'front_desk',                 user: 'desk.amira',       desc: 'Juba Teaching Hospital',    hospital: 'hosp-001' },
  { group: 'Juba Teaching Hospital',    role: 'Registration Clerk',     roleKey: 'central_registration_clerk', user: 'reg.clerk',        desc: 'Juba Teaching Hospital',    hospital: 'hosp-001' },
  { group: 'Juba Teaching Hospital',    role: 'Clinic Clerk',           roleKey: 'clinic_clerk',               user: 'clinic.clerk',     desc: 'Juba Teaching Hospital',    hospital: 'hosp-001' },
  { group: 'Juba Teaching Hospital',    role: 'Triage Nurse',           roleKey: 'triage_nurse',               user: 'triage.mary',      desc: 'Juba Teaching Hospital',    hospital: 'hosp-001' },
  { group: 'Juba Teaching Hospital',    role: 'Rooming Nurse',          roleKey: 'rooming_nurse',              user: 'rooming.sara',     desc: 'Juba Teaching Hospital',    hospital: 'hosp-001' },
  { group: 'Juba Teaching Hospital',    role: 'Doctor',                 roleKey: 'clinician',                  user: 'clinician.peter',  desc: 'Juba Teaching Hospital',    hospital: 'hosp-001' },
  { group: 'Juba Teaching Hospital',    role: 'Radiologist',            roleKey: 'radiologist',                user: 'rad.tamamhealth',  desc: 'Juba Teaching Hospital',    hospital: 'hosp-001' },
  { group: 'Juba Teaching Hospital',    role: 'Pharmacist',             roleKey: 'pharmacist',                 user: 'pharma.rose',      desc: 'Juba Teaching Hospital',    hospital: 'hosp-001' },
  { group: 'Juba Teaching Hospital',    role: 'Nutritionist',           roleKey: 'nutritionist',               user: 'nutr.nyabol',      desc: 'Juba Teaching Hospital',    hospital: 'hosp-001' },
  { group: 'Juba Teaching Hospital',    role: 'Cashier',                roleKey: 'cashier',                    user: 'cashier.deng',     desc: 'Juba Teaching Hospital',    hospital: 'hosp-001' },
  { group: 'Juba Teaching Hospital',    role: 'Medical Biller',         roleKey: 'medical_biller',             user: 'biller.nyandeng',  desc: 'Juba Teaching Hospital',    hospital: 'hosp-001' },
  { group: 'Juba Teaching Hospital',    role: 'Data Entry Clerk',       roleKey: 'data_entry_clerk',           user: 'data.ayen',        desc: 'Juba Teaching Hospital',    hospital: 'hosp-001' },
  { group: 'Juba Teaching Hospital',    role: 'Records / HMIS Officer', roleKey: 'records_hmis_officer',       user: 'hmis.john',        desc: 'Juba Teaching Hospital',    hospital: 'hosp-001' },

  // 2 ── Wau State Hospital.
  { group: 'Wau State Hospital',        role: 'Clinical Officer',       roleKey: 'clinical_officer',           user: 'co.deng',          desc: 'Wau State Hospital',        hospital: 'hosp-002' },

  // 3 ── Malakal Teaching Hospital.
  { group: 'Malakal Teaching Hospital', role: 'Nurse',                  roleKey: 'nurse',                      user: 'nurse.stella',     desc: 'Malakal Teaching Hospital', hospital: 'hosp-003' },
  { group: 'Malakal Teaching Hospital', role: 'Midwife',                roleKey: 'midwife',                    user: 'midwife.nyakong',  desc: 'Malakal Teaching Hospital', hospital: 'hosp-003' },

  // 4 ── Bentiu State Hospital.
  { group: 'Bentiu State Hospital',     role: 'Lab Tech',               roleKey: 'lab_tech',                   user: 'lab.gatluak',      desc: 'Bentiu State Hospital',     hospital: 'hosp-004' },

  // 5 ── Oversight above the facility: hospital group → county.
  { group: 'Mercy Hospital Group',      role: 'Org Admin',              roleKey: 'org_admin',                  user: 'org.admin',        desc: 'Mercy Hospital Group',      hospital: '' },
  { group: 'County Health Office',      role: 'County Health Director', roleKey: 'county_health_director',     user: 'county.lopez',     desc: 'County Health Office',      hospital: '' },

  // 6 ── Ministry of Health & platform: national reporting, then platform admin.
  { group: 'Ministry of Health',        role: 'Government',             roleKey: 'government',                 user: 'admin',            desc: 'National MoH oversight',    hospital: '' },
  { group: 'Ministry of Health',        role: 'Super Admin',            roleKey: 'super_admin',                user: 'superadmin',       desc: 'Platform-wide access',      hospital: '' },
];

type Account = typeof demoAccounts[number];

const imageForIndex = (i: number) => IMAGE_POOL[i % IMAGE_POOL.length];
const emailFor = (user: string) => `${user}@tamamhealth.ss`;

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, currentUser, dbReady } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [demoCreds, setDemoCreds] = useState<Record<string, string>>({});
  // The user the visitor tapped. `null` = show the account list. The string
  // 'manual' = blank, fully-editable form for non-demo / production sign-in.
  const [selected, setSelected] = useState<Account | 'manual' | null>(null);
  const [hospitalId, setHospitalId] = useState('');
  const demoEnabled = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';

  // Pull freshly-generated demo passwords from the server (one-time per load).
  useEffect(() => {
    if (!demoEnabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/demo-credentials', { cache: 'no-store' });
        if (!res.ok) return;
        const body = await res.json() as { profiles: { username: string; password: string | null }[] };
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const p of body.profiles) if (p.password) map[p.username] = p.password;
        setDemoCreds(map);
      } catch { /* demo creds are a convenience; fail silently */ }
    })();
    return () => { cancelled = true; };
  }, [demoEnabled]);

  useEffect(() => {
    if (isAuthenticated && currentUser) router.push(resolveLandingPage(currentUser.role));
  }, [isAuthenticated, currentUser, router]);

  // Open a demo user's sign-in screen with their credentials pre-filled.
  const pickUser = (acc: Account) => {
    setError('');
    setUsername(acc.user);
    setPassword(demoCreds[acc.user] || '');
    setHospitalId(acc.hospital || '');
    setShowPassword(false);
    setSelected(acc);
  };

  const openManual = () => {
    setError('');
    setUsername('');
    setPassword('');
    setHospitalId('');
    setShowPassword(false);
    setSelected('manual');
  };

  const backToList = () => { setSelected(null); setError(''); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(username, password, hospitalId || undefined);
      if (result) router.push(resolveLandingPage(result));
      else { setError('Invalid credentials. Please try again.'); setLoading(false); }
    } catch { setError('Login failed. Please try again.'); setLoading(false); }
  };

  if (isAuthenticated) {
    return (
      <div className="tl-loading">
        <div className="tl-loading-mark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/tamam-icon.svg" alt="" aria-hidden width={40} height={40} />
        </div>
        <p>Redirecting to your dashboard…</p>
        <style jsx>{`
          .tl-loading { min-height: 100vh; display: flex; flex-direction: column; gap: 16px; align-items: center; justify-content: center; background: var(--bg-app, #fff); }
          .tl-loading-mark { animation: tl-pulse 1.2s ease-in-out infinite; }
          .tl-loading p { color: ${ACCENT_DEEP}; font-size: 14px; font-weight: 600; }
          @keyframes tl-pulse { 0%,100% { opacity: .55; transform: scale(.96);} 50% { opacity: 1; transform: scale(1);} }
        `}</style>
      </div>
    );
  }

  // ─────────────────────────── Per-user split sign-in ───────────────────────────
  if (selected) {
    const acc = selected === 'manual' ? null : selected;
    const idx = acc ? demoAccounts.findIndex(a => a.user === acc.user) : -1;
    const hero = acc ? imageForIndex(idx) : '/assets/landing-img.jpg';
    const fullName = acc ? (ACCOUNT_NAME[acc.user] || acc.role) : '';
    const email = acc ? emailFor(acc.user) : '';

    return (
      <div className="tl-shell">
        <div className="tl-split">
          {/* ── Left: form ── */}
          <section className="tl-pane tl-form-pane">
            {/* Close/back — shown on small screens where the hero (and its X) is hidden. */}
            <button type="button" onClick={backToList} aria-label="Close" className="tl-form-close"><X size={18} /></button>
            <header className="tl-brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/assets/tamamhealth-logo-full.svg" alt="Tamam Healthcare System" className="tl-brand-logo" />
            </header>

            <div className="tl-form-wrap">
              <h1 className="tl-title">{acc ? 'Welcome back' : 'Sign in'}</h1>
              <p className="tl-subtitle">
                {acc ? `${acc.role} · ${acc.desc}` : 'Enter your account credentials'}
              </p>

              {!dbReady && (
                <div className="tl-db-banner"><span className="tl-spin" /> Initializing offline database…</div>
              )}

              <form onSubmit={handleSubmit} className="tl-form">
                {/* Full name */}
                <div className="tl-field">
                  <label htmlFor="tl-name">Full name</label>
                  <input id="tl-name" type="text" value={acc ? fullName : username}
                    onChange={acc ? undefined : (e) => setUsername(e.target.value)}
                    readOnly={!!acc} placeholder={acc ? '' : 'Username or Staff ID'}
                    className="tl-input" autoComplete={acc ? 'off' : 'username'} />
                </div>

                {/* Email */}
                <div className="tl-field">
                  <label htmlFor="tl-email">Email</label>
                  <input id="tl-email" type="text" value={acc ? email : ''}
                    readOnly placeholder={acc ? '' : '—'} className="tl-input" />
                </div>

                {/* Password */}
                <div className="tl-field">
                  <label htmlFor="tl-password">Password</label>
                  <div className="tl-input-wrap">
                    <input id="tl-password" type={showPassword ? 'text' : 'password'} value={password}
                      onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••••"
                      autoComplete="current-password" className="tl-input tl-input-password" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'} className="tl-input-eye">
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {error && <div role="alert" className="tl-error">{error}</div>}

                <button type="submit" disabled={loading || !dbReady} className="tl-submit">
                  {loading ? (<span className="tl-submit-loading"><span className="tl-spin tl-spin-light" /> Signing in…</span>) : 'Submit'}
                </button>

                {/* Social — Google intentionally omitted (not enabled). SSO is
                    shown for parity but single sign-on isn't wired yet. */}
                <button type="button" className="tl-social"
                  onClick={() => setError('Single sign-on isn’t enabled yet — use your account password above.')}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 7h3a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-3"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                  Continue with SSO
                </button>
              </form>

              <p className="tl-foot">
                {acc ? (
                  <button type="button" className="tl-link" onClick={openManual}>Use a different account</button>
                ) : (
                  <a href="/patient-portal" className="tl-link">Sign in as a patient</a>
                )}
                <span className="tl-foot-sep">·</span>
                <a href="/signup" className="tl-link">Request an account</a>
                <span className="tl-foot-sep">·</span>
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="tl-link">Terms &amp; Conditions</a>
              </p>
            </div>
          </section>

          {/* ── Right: hero ── */}
          <section className="tl-hero" style={{ backgroundImage: `url(${hero})` }}>
            <button type="button" onClick={backToList} aria-label="Close" className="tl-hero-close"><X size={18} /></button>

            {/* Floating promo cards. Same three card shapes as the original
                hero, but each one now carries a product claim instead of the
                invented appointments, fixed calendar dates, and stock-photo
                faces they used to show. */}
            <div className="tl-chip tl-chip-task">
              <div className="tl-chip-title"><WifiOff size={13} /> Works offline</div>
              <div className="tl-chip-time">Syncs the moment you reconnect</div>
            </div>

            {/* Replaces the old week strip — advertising copy, not a calendar. */}
            <div className="tl-tagline">
              <span className="tl-tagline-eyebrow">Tamam Healthcare System</span>
              <strong className="tl-tagline-line">One patient record,<br />every facility.</strong>
            </div>

            <div className="tl-meeting">
              <div className="tl-meeting-top">
                <span className="tl-meeting-title">HMIS-ready reporting</span>
              </div>
              <div className="tl-meeting-time">Built for national programmes</div>
            </div>
          </section>
        </div>
        {sharedStyles}
      </div>
    );
  }

  // ─────────────────────────── Account list ───────────────────────────
  return (
    <div className="tl-shell">
      <div className="tl-list-card">
        <header className="tl-brand tl-brand-list">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/tamamhealth-logo-full.svg" alt="Tamam Healthcare System" className="tl-brand-logo" />
        </header>

        <div className="tl-list-head">
          <h1 className="tl-title">Choose your account</h1>
          <p className="tl-subtitle">Select a user to open their sign-in screen.</p>
        </div>

        {!dbReady && (
          <div className="tl-db-banner"><span className="tl-spin" /> Initializing offline database…</div>
        )}

        <div className="tl-list">
          {demoEnabled ? demoAccounts.map((acc, i) => {
            const showHeader = i === 0 || demoAccounts[i - 1].group !== acc.group;
            const name = ACCOUNT_NAME[acc.user] || acc.role;
            return (
              <Fragment key={acc.user}>
                {showHeader && <div className="tl-group">{acc.group}</div>}
                <button type="button" onClick={() => pickUser(acc)} className="tl-user">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageForIndex(i)} alt="" aria-hidden className="tl-user-avatar" />
                  <div className="tl-user-meta">
                    <span className="tl-user-name">{name}</span>
                    {/* The group header already names the facility — only repeat
                        desc when it adds something (e.g. MoH rows). */}
                    <span className="tl-user-role">{acc.desc === acc.group ? acc.role : `${acc.role} · ${acc.desc}`}</span>
                  </div>
                  <ChevronRight size={16} className="tl-user-chev" />
                </button>
              </Fragment>
            );
          }) : null}
          {!demoEnabled && (
            <button type="button" onClick={openManual} className="tl-user">
              <span className="tl-user-avatar tl-user-avatar-icon"><Icon name="user" size={18} color={ACCENT_DEEP} /></span>
              <div className="tl-user-meta">
                <span className="tl-user-name">Sign in</span>
                <span className="tl-user-role">Enter your account credentials</span>
              </div>
              <ChevronRight size={16} className="tl-user-chev" />
            </button>
          )}
        </div>

        <div className="tl-list-foot">
          <a href="/patient-portal" className="tl-link"><Icon name="patient" size={15} color={ACCENT_DEEP} /> Sign in as a patient</a>
          <a href="/signup" className="tl-link">Request an account</a>
          {demoEnabled && <button type="button" className="tl-link" onClick={openManual}>Other account</button>}
        </div>
      </div>
      {sharedStyles}
    </div>
  );
}

// Shared styled-jsx for both views (blue + lavender theme).
const sharedStyles = (
  <style jsx global>{`
    .tl-shell {
      min-height: 100vh; padding: 24px;
      display: flex; align-items: center; justify-content: center;
      background: var(--bg-app);
    }
    .tl-brand { display: flex; align-items: center; gap: 9px; }
    .tl-brand-logo { height: 30px; width: auto; }
    .tl-title { font-family: var(--font-platform); font-size: 28px; font-weight: 800; letter-spacing: -0.03em; color: var(--text-primary); margin: 0; }
    .tl-subtitle { font-size: 13.5px; color: var(--text-muted); margin: 6px 0 0; }
    .tl-db-banner { margin: 14px 0 0; padding: 8px 12px; font-size: 11.5px; color: ${ACCENT_DEEP}; background: var(--accent-light); border: 1px solid var(--accent-border); border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 6px; }

    /* ── Account list ── */
    .tl-list-card {
      width: 100%; max-width: 540px; max-height: calc(100vh - 48px);
      display: flex; flex-direction: column;
      background: var(--bg-card-solid); border: 1px solid var(--border-light);
      border-radius: 24px; box-shadow: none;
      padding: 26px 26px 18px; overflow: hidden;
    }
    .tl-brand-list { justify-content: center; }
    .tl-list-head { text-align: center; margin-top: 16px; }
    .tl-list-head .tl-subtitle { margin-top: 4px; }
    .tl-list { margin-top: 16px; overflow-y: auto; padding-right: 4px; display: flex; flex-direction: column; gap: 4px; }
    .tl-group { position: sticky; top: 0; z-index: 1; padding: 10px 4px 5px; font-size: 10px; font-weight: 800; letter-spacing: 0.07em; text-transform: uppercase; color: ${ACCENT}; background: var(--bg-card-solid); }
    .tl-user { display: flex; align-items: center; gap: 13px; padding: 9px 11px; background: var(--bg-card-solid); border: 1px solid var(--border-light); border-radius: 14px; cursor: pointer; text-align: left; transition: background .14s, border-color .14s, transform .14s; }
    .tl-user:hover { background: var(--overlay-subtle); border-color: var(--border-medium); transform: translateX(2px); }
    .tl-user-avatar { width: 42px; height: 42px; border-radius: 50%; object-fit: cover; flex-shrink: 0; background: var(--border-light); }
    .tl-user-avatar-icon { display: inline-flex; align-items: center; justify-content: center; background: var(--accent-light); }
    .tl-user-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .tl-user-name { font-size: 14px; font-weight: 700; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tl-user-role { font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tl-user-chev { color: var(--text-muted); flex-shrink: 0; }
    .tl-list-foot { display: flex; align-items: center; justify-content: center; gap: 16px; padding-top: 14px; margin-top: 8px; border-top: 1px solid var(--border-light); }

    /* ── Split sign-in ── */
    .tl-split {
      width: 100%; max-width: 1080px; height: min(680px, calc(100vh - 48px));
      display: grid; grid-template-columns: 1fr 1.05fr;
      background: var(--bg-card-solid); border: 1px solid var(--border-light);
      border-radius: 28px; box-shadow: none; overflow: hidden;
    }
    .tl-pane { padding: 30px 38px; display: flex; flex-direction: column; overflow-y: auto; }
    .tl-form-wrap { margin: auto 0; width: 100%; max-width: 380px; align-self: center; }
    .tl-form-pane { position: relative; }
    /* Keep the logo in the same centered 380px column as the form body so its
       left edge lines up with "Welcome back" and the fields (not the pane edge). */
    .tl-form-pane .tl-brand { width: 100%; max-width: 380px; align-self: center; }
    .tl-form-close { display: none; position: absolute; top: 18px; right: 18px; z-index: 3; width: 38px; height: 38px; align-items: center; justify-content: center; border-radius: 50%; border: 1px solid var(--border-light); background: var(--bg-card-solid); color: var(--text-primary); cursor: pointer; box-shadow: none; }
    .tl-form-close:hover { background: var(--overlay-subtle); }
    .tl-form-wrap .tl-title { margin-top: 4px; }
    .tl-form { display: flex; flex-direction: column; gap: 14px; margin-top: 22px; }
    .tl-field { display: flex; flex-direction: column; gap: 7px; }
    .tl-field label { font-size: 12.5px; font-weight: 600; color: var(--text-secondary); }
    .tl-input-wrap { position: relative; display: flex; align-items: center; }
    .tl-input { width: 100%; padding: 13px 16px; font-size: 14.5px; color: var(--text-primary); background: var(--overlay-subtle); border: 1.5px solid transparent; border-radius: 999px; outline: none; transition: border-color .15s, background .15s, box-shadow .15s; }
    .tl-input::placeholder { color: var(--text-muted); }
    .tl-input:focus { border-color: ${ACCENT}; background: var(--bg-card-solid); box-shadow: none; }
    .tl-input[readonly] { cursor: default; }
    .tl-input-password { padding-right: 46px; }
    .tl-input-eye { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: none; background: transparent; color: var(--text-muted); cursor: pointer; border-radius: 6px; }
    .tl-input-eye:hover { color: ${ACCENT_DEEP}; }
    .tl-error { padding: 10px 13px; font-size: 12.5px; color: var(--color-danger); background: var(--color-danger-bg); border: 1px solid color-mix(in srgb, var(--color-danger) 22%, transparent); border-radius: 10px; }
    .tl-submit { width: 100%; padding: 14px 24px; margin-top: 4px; font-size: 15px; font-weight: 700; color: var(--color-white); background: var(--accent-primary); border: none; border-radius: 999px; cursor: pointer; transition: transform .12s, box-shadow .15s, opacity .15s; box-shadow: none; }
    .tl-submit:hover:not(:disabled) { transform: translateY(-1px); box-shadow: none; }
    .tl-submit:disabled { opacity: .6; cursor: not-allowed; }
    .tl-submit-loading { display: inline-flex; align-items: center; gap: 8px; }
    .tl-social { width: 100%; padding: 12px 24px; display: inline-flex; align-items: center; justify-content: center; gap: 9px; font-size: 14px; font-weight: 600; color: var(--text-primary); background: var(--bg-card-solid); border: 1.5px solid var(--border-light); border-radius: 999px; cursor: pointer; transition: background .15s, border-color .15s; }
    .tl-social:hover { background: var(--overlay-subtle); border-color: var(--border-medium); }
    .tl-foot { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 22px; font-size: 12.5px; }
    .tl-foot-sep { color: var(--border-medium); }
    .tl-link { display: inline-flex; align-items: center; gap: 5px; color: ${ACCENT_DEEP}; font-weight: 600; text-decoration: none; background: none; border: none; padding: 0; cursor: pointer; font-family: inherit; font-size: 12.5px; }
    .tl-link:hover { text-decoration: underline; }

    /* ── Hero ── */
    .tl-hero { position: relative; background-size: cover; background-position: center; }
    .tl-hero::after { content: ''; position: absolute; inset: 0; background: color-mix(in srgb, var(--accent-hover) 18%, transparent); }
    .tl-hero-close { position: absolute; top: 18px; right: 18px; z-index: 3; width: 38px; height: 38px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; border: none; background: var(--bg-card-solid); color: var(--text-primary); cursor: pointer; box-shadow: none; }
    .tl-hero-close:hover { background: var(--bg-card-solid); }
    /* Value panel over the hero photo: a readable scrim rather than floating
       cards, so the copy stays legible on any background image. */
    /* Floating hero cards: accent chip (top-left), glass tagline (right),
       white claim card (bottom-left). A scrim keeps every card legible
       whatever the hero photograph is doing behind it. */
    .tl-hero::before { content: ''; position: absolute; inset: 0; z-index: 1; background: linear-gradient(180deg, rgba(2, 26, 45, 0.45) 0%, rgba(2, 26, 45, 0.20) 42%, rgba(2, 26, 45, 0.72) 100%); }
    .tl-chip { position: absolute; z-index: 2; backdrop-filter: blur(6px); }
    .tl-chip-task { top: 64px; left: 34px; background: ${ACCENT}; color: var(--color-white); border-radius: 14px; padding: 11px 15px; }
    .tl-chip-title { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 700; }
    .tl-chip-time { font-size: 11.5px; opacity: 0.92; margin-top: 3px; }
    .tl-tagline { position: absolute; z-index: 2; right: 30px; bottom: 150px; max-width: 250px; padding: 15px 17px; border-radius: 16px; background: color-mix(in srgb, var(--color-white) 18%, transparent); border: 1px solid color-mix(in srgb, var(--color-white) 42%, transparent); backdrop-filter: blur(10px); color: var(--color-white); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3); }
    .tl-tagline-eyebrow { display: block; font-size: 11px; font-weight: 700; letter-spacing: 0.01em; opacity: 0.88; }
    .tl-tagline-line { display: block; margin-top: 7px; font-family: var(--font-platform); font-size: 19px; line-height: 1.25; font-weight: 800; letter-spacing: -0.01em; }
    .tl-meeting { position: absolute; z-index: 2; left: 30px; bottom: 36px; width: 244px; padding: 15px 17px; border-radius: 18px; background: var(--bg-card-solid); }
    .tl-meeting-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .tl-meeting-title { font-size: 14px; font-weight: 700; color: var(--text-primary); }
    .tl-meeting-time { font-size: 12px; color: var(--text-muted); margin-top: 3px; }

    .tl-spin { width: 13px; height: 13px; border: 2px solid var(--accent-border); border-top-color: ${ACCENT}; border-radius: 50%; display: inline-block; animation: tl-rot .7s linear infinite; }
    .tl-spin-light { border-color: color-mix(in srgb, var(--color-white) 40%, transparent); border-top-color: var(--color-white); }
    @keyframes tl-rot { to { transform: rotate(360deg); } }

    @media (max-width: 860px) {
      .tl-split { grid-template-columns: 1fr; height: auto; max-width: 460px; }
      .tl-hero { display: none; }
      .tl-pane { padding: 28px 26px; }
      .tl-form-close { display: inline-flex; }
    }
  `}</style>
);

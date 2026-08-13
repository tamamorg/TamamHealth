'use client';

import { useState, useEffect, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, ChevronRight, X } from '@/components/icons/lucide';
import { Icon } from '@/components/icons';
import { useAuth } from '@/lib/context';
import { resolveLandingPage } from '@/lib/user-prefs';
import { ROLE_ROUTE_TABLE } from '@/lib/role-routes';
import { getRoleConfig } from '@/lib/permissions';
import type { UserRole } from '@/lib/db-types';

// Role picker options — every role in the platform, labeled like the rest of
// the UI. Everyone signs in as their assigned role; only the platform
// super-admin may pick a different one and enter that role's workspace.
const ROLE_OPTIONS = (Object.keys(ROLE_ROUTE_TABLE) as UserRole[])
  .map((value) => ({ value, label: getRoleConfig(value).label }))
  .sort((a, b) => a.label.localeCompare(b.label));

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
  // '' = sign in as the account's own role; a value = requested role
  // (honoured by the server only for the super-admin).
  const [roleChoice, setRoleChoice] = useState<UserRole | ''>('');
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
    setRoleChoice(acc.roleKey);
    setShowPassword(false);
    setSelected(acc);
  };

  const openManual = () => {
    setError('');
    setUsername('');
    setPassword('');
    setHospitalId('');
    setRoleChoice('');
    setShowPassword(false);
    setSelected('manual');
  };

  const backToList = () => { setSelected(null); setError(''); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(username, password, hospitalId || undefined, roleChoice || undefined);
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
                {acc ? acc.desc : 'Enter your account credentials'}
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

                {/* Role — everyone signs in as their own role; the platform
                    super-admin may pick any role and enter its workspace. */}
                <div className="tl-field">
                  <label htmlFor="tl-role">Role</label>
                  <select id="tl-role" value={roleChoice} className="tl-input"
                    onChange={(e) => setRoleChoice(e.target.value as UserRole | '')}>
                    <option value="">Your assigned role</option>
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
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
                  {loading ? (<span className="tl-submit-loading"><span className="tl-spin tl-spin-light" /> Signing in…</span>) : 'Sign in'}
                </button>

              </form>

              <p className="tl-foot">
                {acc ? (
                  <button type="button" className="tl-link" onClick={openManual}>Use a different account</button>
                ) : (
                  <a href="/patient-portal" className="tl-link">Sign in as a patient</a>
                )}
                <span className="tl-foot-sep">·</span>
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="tl-link">Terms &amp; Conditions</a>
              </p>
            </div>
          </section>

          {/* ── Right: hero ── */}
          <section className="tl-hero" style={{ backgroundImage: `url(${hero})` }}>
            <button type="button" onClick={backToList} aria-label="Close" className="tl-hero-close"><X size={18} /></button>

            {/* One composed poster block on a single left axis. */}
            <div className="tl-hero-panel">
              <span className="tl-hero-eyebrow">Tamam Healthcare System</span>
              <strong className="tl-hero-line">One patient record,<br />every facility.</strong>
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
    /* Sentence case — the global label rule force-uppercases and letter-spaces
       every label in the app; quiet it back down inside the login namespace. */
    .tl-shell .tl-field label { font-size: 12.5px; font-weight: 600; color: var(--text-secondary); text-transform: none; letter-spacing: 0; }
    .tl-input-wrap { position: relative; display: flex; align-items: center; }
    /* Scoped under .tl-shell: globals.css styles input[type=...] directly, which
       outranks a bare class and squashes these fields to the square app-wide look. */
    .tl-shell .tl-input { width: 100%; height: 52px; padding: 0 18px; font-size: 14.5px; color: var(--text-primary); background: var(--overlay-subtle); border: 1.5px solid var(--border-light); border-radius: 999px; outline: none; transition: border-color .15s, background .15s, box-shadow .15s; }
    .tl-shell .tl-input::placeholder { color: var(--text-muted); }
    .tl-shell .tl-input:hover:not(:focus):not([readonly]) { border-color: var(--border-medium); }
    .tl-shell .tl-input:focus { border-color: ${ACCENT}; background: var(--bg-card-solid); box-shadow: 0 0 0 3px var(--accent-light) !important; }
    .tl-shell .tl-input[readonly] { cursor: default; }
    .tl-shell .tl-input-password { padding-right: 46px; }
    .tl-input-eye { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: none; background: transparent; color: var(--text-muted); cursor: pointer; border-radius: 6px; }
    .tl-input-eye:hover { color: ${ACCENT_DEEP}; }
    .tl-error { padding: 10px 13px; font-size: 12.5px; color: var(--color-danger); background: var(--color-danger-bg); border: 1px solid color-mix(in srgb, var(--color-danger) 22%, transparent); border-radius: 10px; }
    .tl-submit { width: 100%; height: 52px; padding: 0 24px; margin-top: 4px; font-size: 15px; font-weight: 700; color: var(--color-white); background: var(--accent-primary); border: none; border-radius: 999px; cursor: pointer; transition: transform .12s, box-shadow .15s, opacity .15s; box-shadow: none; }
    .tl-submit:hover:not(:disabled) { background: ${ACCENT_DEEP}; transform: translateY(-1px); box-shadow: none; }
    .tl-submit:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-border); }
    .tl-submit:disabled { opacity: .6; cursor: not-allowed; }
    .tl-submit-loading { display: inline-flex; align-items: center; gap: 8px; }
    .tl-foot { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 22px; font-size: 12.5px; }
    .tl-foot-sep { color: var(--border-medium); }
    .tl-link { display: inline-flex; align-items: center; gap: 5px; color: ${ACCENT_DEEP}; font-weight: 600; text-decoration: none; background: none; border: none; padding: 0; cursor: pointer; font-family: inherit; font-size: 12.5px; }
    .tl-link:hover { text-decoration: underline; }

    /* ── Hero ── */
    .tl-hero { position: relative; background-size: cover; background-position: center; }
    /* Brand duotone wash + a bottom-weighted scrim: the photo stays light up
       top and settles into deep ink where the copy sits, so the white text
       passes contrast on any photo in the pool. Flat — no blur, no glass. */
    .tl-hero::after { content: ''; position: absolute; inset: 0; background: color-mix(in srgb, var(--accent-hover) 14%, transparent); }
    .tl-hero::before { content: ''; position: absolute; inset: 0; z-index: 1; background: linear-gradient(180deg, rgba(2, 26, 45, 0.38) 0%, rgba(2, 26, 45, 0.10) 34%, rgba(2, 26, 45, 0.50) 64%, rgba(2, 26, 45, 0.92) 100%); }
    .tl-hero-close { position: absolute; top: 18px; right: 18px; z-index: 3; width: 38px; height: 38px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.35); background: rgba(2, 26, 45, 0.40); color: var(--color-white); cursor: pointer; box-shadow: none; transition: background .15s; }
    .tl-hero-close:hover { background: rgba(2, 26, 45, 0.65); }
    .tl-hero-panel { position: absolute; z-index: 2; left: 34px; right: 34px; bottom: 100px; color: var(--color-white); text-shadow: 0 1px 2px rgba(2, 26, 45, 0.35); }
    .tl-hero-eyebrow { display: block; font-size: 12px; font-weight: 700; letter-spacing: 0.01em; color: rgba(255, 255, 255, 0.88); }
    .tl-hero-line { display: block; margin-top: 9px; font-family: var(--font-platform); font-size: 30px; line-height: 1.16; font-weight: 800; letter-spacing: -0.02em; }

    /* Icons follow their container's color — the global svg.lucide rule would
       otherwise pin them to the app icon color (dark glyphs on the dark hero). */
    .tl-shell .tl-hero-close svg.lucide, .tl-shell .tl-form-close svg.lucide,
    .tl-shell .tl-input-eye svg.lucide { color: inherit; stroke: currentColor; }

    .tl-spin { width: 13px; height: 13px; border: 2px solid var(--accent-border); border-top-color: ${ACCENT}; border-radius: 50%; display: inline-block; animation: tl-rot .7s linear infinite; }
    .tl-spin-light { border-color: color-mix(in srgb, var(--color-white) 40%, transparent); border-top-color: var(--color-white); }
    @keyframes tl-rot { to { transform: rotate(360deg); } }

    @media (max-width: 860px) {
      .tl-split { grid-template-columns: 1fr; height: auto; max-width: 460px; }
      .tl-hero { display: none; }
      .tl-pane { padding: 28px 26px; }
      .tl-form-close { display: inline-flex; }
    }
    @media (prefers-reduced-motion: reduce) {
      .tl-user, .tl-submit, .tl-input, .tl-hero-close { transition: none; }
      .tl-user:hover, .tl-submit:hover:not(:disabled) { transform: none; }
    }
  `}</style>
);

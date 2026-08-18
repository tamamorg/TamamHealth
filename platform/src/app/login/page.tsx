'use client';

/**
 * Staff sign-in, drawn in the marketing site's login language
 * (tamamhealth.org/login): centred logo bar, a two-column body with the form
 * on the left and a blueprint product panel on the right, square-cornered
 * fields with registration marks, and the site's Barlow typography (loaded by
 * this route's layout).
 *
 * The look is the website's; the behaviour is the platform's. This page holds
 * a real session — the site's copy is a mock that only flips a success line —
 * so the fields are the ones auth actually needs (username, optional role,
 * password) and every state the platform has (offline-database boot, the
 * demo-mode roster, error and loading) keeps working.
 */

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { resolveLandingPage } from '@/lib/user-prefs';
import { ROLE_ROUTE_TABLE } from '@/lib/role-routes';
import { getRoleConfig } from '@/lib/permissions';
import type { UserRole } from '@/lib/db-types';

// Role picker options — every role in the platform, labeled like the rest of
// the UI. Everyone signs in as their assigned role; only the platform
// super-admin may pick a different one and enter that role's workspace.
// Some roles share a display label (e.g. `doctor` and `clinician` are both
// "Doctor"); those get the role key appended so the picker stays unambiguous.
const ROLE_OPTIONS = (() => {
  const labelCounts = new Map<string, number>();
  for (const value of Object.keys(ROLE_ROUTE_TABLE) as UserRole[]) {
    const label = getRoleConfig(value).label;
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  return (Object.keys(ROLE_ROUTE_TABLE) as UserRole[])
    .map((value) => {
      const label = getRoleConfig(value).label;
      return { value, label: (labelCounts.get(label) ?? 0) > 1 ? `${label} (${value})` : label };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
})();

/**
 * The seeded demo roster, shown only where `NEXT_PUBLIC_DEMO_MODE` is on (the
 * tamamhealth-v6 deployment). Passwords are never hard-coded — they are minted
 * per environment and fetched at runtime from `/api/demo-credentials`, which
 * only answers in demo mode.
 *
 * One login per distinct role, batched by facility and escalating up the health
 * system: Juba Teaching Hospital carries the whole patient journey in the order
 * a patient meets each role (reception → registration → triage → consult →
 * diagnostics → pharmacy → billing → records), then the other facilities, then
 * group and county oversight, ending at the Ministry of Health and the platform
 * admin. `group` drives the section headers.
 */
const DEMO_ACCOUNTS: { group: string; role: string; user: string }[] = [
  { group: 'Juba Teaching Hospital',    role: 'Medical Receptionist',   user: 'desk.amira' },
  { group: 'Juba Teaching Hospital',    role: 'Registration Clerk',     user: 'reg.clerk' },
  { group: 'Juba Teaching Hospital',    role: 'Clinic Clerk',           user: 'clinic.clerk' },
  { group: 'Juba Teaching Hospital',    role: 'Triage Nurse',           user: 'triage.mary' },
  { group: 'Juba Teaching Hospital',    role: 'Rooming Nurse',          user: 'rooming.sara' },
  { group: 'Juba Teaching Hospital',    role: 'Doctor',                 user: 'clinician.peter' },
  { group: 'Juba Teaching Hospital',    role: 'Radiologist',            user: 'rad.tamamhealth' },
  { group: 'Juba Teaching Hospital',    role: 'Pharmacist',             user: 'pharma.rose' },
  { group: 'Juba Teaching Hospital',    role: 'Nutritionist',           user: 'nutr.nyabol' },
  { group: 'Juba Teaching Hospital',    role: 'Cashier',                user: 'cashier.deng' },
  { group: 'Juba Teaching Hospital',    role: 'Medical Biller',         user: 'biller.nyandeng' },
  { group: 'Juba Teaching Hospital',    role: 'Data Entry Clerk',       user: 'data.ayen' },
  { group: 'Juba Teaching Hospital',    role: 'Records / HMIS Officer', user: 'hmis.john' },
  { group: 'Wau State Hospital',        role: 'Clinical Officer',       user: 'co.deng' },
  { group: 'Malakal Teaching Hospital', role: 'Nurse',                  user: 'nurse.stella' },
  { group: 'Malakal Teaching Hospital', role: 'Midwife',                user: 'midwife.nyakong' },
  { group: 'Bentiu State Hospital',     role: 'Lab Tech',               user: 'lab.gatluak' },
  { group: 'Mercy Hospital Group',      role: 'Org Admin',              user: 'org.admin' },
  { group: 'County Health Office',      role: 'County Health Director', user: 'county.lopez' },
  { group: 'Ministry of Health',        role: 'Government',             user: 'admin' },
  { group: 'Ministry of Health',        role: 'Super Admin',            user: 'superadmin' },
];

const DEMO_GROUPS = Array.from(new Set(DEMO_ACCOUNTS.map(a => a.group)));

/** The blueprint frame's four registration marks (the site's `Corners`). */
function Corners() {
  return (
    <>
      <i className="lg-corner tl" />
      <i className="lg-corner tr" />
      <i className="lg-corner bl" />
      <i className="lg-corner br" />
    </>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, currentUser, dbReady } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  // '' = sign in as the account's own role; a value = requested role
  // (honoured by the server only for the super-admin).
  const [roleChoice, setRoleChoice] = useState<UserRole | ''>('');
  // The role combobox: what's typed in the field (a filter while the menu is
  // open, the chosen role's label once picked) and whether the menu shows.
  const [roleQuery, setRoleQuery] = useState('');
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  // Demo-only account picker. Off unless the deployment says it is a demo, so
  // production never advertises a roster of accounts.
  const demoEnabled = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
  const [demoCreds, setDemoCreds] = useState<Record<string, string>>({});

  // Username handed over from the marketing site's login (?u=). Read from
  // window rather than useSearchParams — the same pattern the patients and
  // appointments pages use for their deep links, and it keeps this route out
  // of a Suspense boundary. Only the username ever travels, never a password,
  // and the param is stripped once read so it does not linger in the address
  // bar, history or a referrer header.
  const handedOffRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || handedOffRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const handed = params.get('u');
    if (!handed) return;
    handedOffRef.current = true;
    setUsername(handed.slice(0, 64));
    params.delete('u');
    const qs = params.toString();
    window.history.replaceState(window.history.state, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, []);

  // Passwords are minted per environment; pull them once per load rather than
  // shipping any in the bundle.
  useEffect(() => {
    if (!demoEnabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/demo-credentials', { cache: 'no-store' });
        if (!res.ok) return;
        const body = await res.json() as { profiles?: { username: string; password: string | null }[] };
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const p of body.profiles || []) if (p.password) map[p.username] = p.password;
        setDemoCreds(map);
      } catch { /* the picker is a convenience — the manual form still works */ }
    })();
    return () => { cancelled = true; };
  }, [demoEnabled]);

  const roleLabelFor = (value: UserRole | '') =>
    value ? (ROLE_OPTIONS.find(r => r.value === value)?.label || '') : '';

  // Typing filters; a query that exactly equals the current choice's label
  // means "just reopened" and shows the full list again.
  const roleMatches = (() => {
    const q = roleQuery.trim().toLowerCase();
    if (!q || q === roleLabelFor(roleChoice).toLowerCase()) return ROLE_OPTIONS;
    return ROLE_OPTIONS.filter(r => r.label.toLowerCase().includes(q));
  })();

  const selectRole = (option: { value: UserRole; label: string } | null) => {
    setRoleChoice(option?.value ?? '');
    setRoleQuery(option?.label ?? '');
    setRoleMenuOpen(false);
  };

  useEffect(() => {
    if (isAuthenticated && currentUser) router.push(resolveLandingPage(currentUser.role));
  }, [isAuthenticated, currentUser, router]);

  /** One tap = filled form + signed in, so a demo never stalls on a password. */
  const signInAsDemo = async (user: string) => {
    const pw = demoCreds[user];
    setUsername(user);
    setPassword(pw || '');
    setRoleChoice('');
    setRoleQuery('');
    if (!pw) { setError('Demo credentials are still loading — try that account again in a moment.'); return; }
    setError('');
    setLoading(true);
    try {
      const result = await login(user, pw);
      if (result) router.push(resolveLandingPage(result));
      else { setError('That demo account could not sign in.'); setLoading(false); }
    } catch { setError('Login failed. Please try again.'); setLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(username, password, undefined, roleChoice || undefined);
      if (result) router.push(resolveLandingPage(result));
      else { setError('Invalid credentials. Please try again.'); setLoading(false); }
    } catch { setError('Login failed. Please try again.'); setLoading(false); }
  };

  if (isAuthenticated) {
    return (
      <div className="lg-redirect">
        <span className="lg-redirect-mark" />
        <p>Redirecting to your dashboard…</p>
        {loginStyles}
      </div>
    );
  }

  return (
    <div className="lg-root">
      {/* ── Logo bar ── */}
      <header className="lg-topbar">
        <a href="https://tamamhealth.org" className="lg-topbar-link">
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed-height SVG logo */}
          <img src="/assets/tamamhealth-logo-full.svg" alt="Tamam Healthcare System" className="lg-topbar-logo" />
        </a>
      </header>

      <div className="lg-grid">
        {/* ── Left: the form ── */}
        <div className="lg-col">
          <div>
            <h1 className="lg-h1">Log in</h1>
            <p className="lg-lede">Enter the username and password issued by your facility administrator.</p>
          </div>

          {!dbReady && (
            <div className="lg-boot"><span className="lg-spin" /> Initializing offline database…</div>
          )}

          <form onSubmit={handleSubmit} className="lg-form">
            <div className="lg-field">
              <label htmlFor="tl-name">Username or Staff ID</label>
              <input
                id="tl-name"
                type="text"
                className="lg-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. desk.amira"
                autoComplete="username"
              />
            </div>

            {/* Role — everyone signs in as their own role; the platform
                super-admin may pick any role and enter its workspace.
                Searchable: typing filters the list, picking fills it. */}
            <div className="lg-field lg-field--rel">
              <label htmlFor="tl-role">Role</label>
              <div className="lg-inputwrap">
                <svg className="lg-inputicon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" /><path d="m20 20-4.2-4.2" />
                </svg>
                <input
                  id="tl-role"
                  type="text"
                  className="lg-input lg-input--bare"
                  role="combobox"
                  aria-expanded={roleMenuOpen}
                  aria-controls="tl-role-menu"
                  aria-autocomplete="list"
                  autoComplete="off"
                  placeholder="Search your role — doctor, nurse, pharmacist…"
                  value={roleQuery}
                  onChange={(e) => {
                    setRoleQuery(e.target.value);
                    setRoleMenuOpen(true);
                    if (!e.target.value.trim()) setRoleChoice('');
                  }}
                  onFocus={() => setRoleMenuOpen(true)}
                  onBlur={() => { setRoleMenuOpen(false); setRoleQuery(roleLabelFor(roleChoice)); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setRoleMenuOpen(false);
                    if (e.key === 'Enter' && roleMenuOpen && roleQuery.trim()
                      && roleQuery.trim().toLowerCase() !== roleLabelFor(roleChoice).toLowerCase()) {
                      e.preventDefault();
                      if (roleMatches[0]) selectRole(roleMatches[0]);
                    }
                  }}
                />
                {roleQuery && (
                  <button
                    type="button"
                    className="lg-clear"
                    aria-label="Clear role"
                    onMouseDown={(e) => { e.preventDefault(); selectRole(null); }}
                  >
                    ×
                  </button>
                )}
              </div>
              {roleMenuOpen && (
                <div id="tl-role-menu" className="lg-rolelist" role="listbox" aria-label="Roles">
                  {/* onMouseDown (not click) so picking wins the race against
                      the input's blur closing the menu. */}
                  <button
                    type="button" role="option" aria-selected={roleChoice === ''}
                    className={`lg-rolerow${roleChoice === '' ? ' is-selected' : ''}`}
                    onMouseDown={(e) => { e.preventDefault(); selectRole(null); }}
                  >
                    <span className="lg-rolerow-name">Your assigned role</span>
                    <span className="lg-rolerow-scope">Sign in as whatever your account carries</span>
                  </button>
                  {roleMatches.map((r) => (
                    <button
                      key={r.value}
                      type="button" role="option" aria-selected={roleChoice === r.value}
                      className={`lg-rolerow${roleChoice === r.value ? ' is-selected' : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); selectRole(r); }}
                    >
                      <span className="lg-rolerow-name">{r.label}</span>
                    </button>
                  ))}
                  {roleMatches.length === 0 && (
                    <span className="lg-rolelist-empty">
                      No role matches that. Ask your facility administrator which role your account carries.
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="lg-field">
              <label htmlFor="tl-password">Password</label>
              <div className="lg-inputwrap">
                <input
                  id="tl-password"
                  type={showPassword ? 'text' : 'password'}
                  className="lg-input lg-input--bare"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="lg-eye"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.6" />
                  </svg>
                </button>
              </div>
            </div>

            <label className="lg-keep">
              <input type="checkbox" checked={keepSignedIn} onChange={(e) => setKeepSignedIn(e.target.checked)} />
              Keep me signed in on this device
            </label>

            {error && <div role="alert" className="lg-error">{error}</div>}

            <button type="submit" disabled={loading || !dbReady} className="lg-btn blueprint">
              {loading ? 'Signing in…' : 'Log in'}
              <Corners />
            </button>
          </form>

          <div className="lg-links">
            <a href="/patient-portal">Patient portal</a>
            <a href={`mailto:support.tamam@gmail.com?subject=${encodeURIComponent('Trouble signing in')}`}>Trouble signing in?</a>
          </div>

          <span className="lg-offline">
            Works offline: once signed in on a facility device, the record keeps working through power cuts and
            network gaps and syncs when connection returns.
          </span>

        </div>

        {/* ── Right: the demo roster on demo deployments, the product panel
              everywhere else. The roster takes the whole column so every
              account is on screen beside the form rather than below the fold.
              Grouped by facility and ordered the way a patient meets each
              role, so a visitor can walk the journey without knowing a
              username. */}
        {demoEnabled ? (
          <aside className="lg-demo blueprint" aria-labelledby="lg-demo-title">
            <Corners />
            <h2 id="lg-demo-title">Choose a demo account</h2>
            <p>One tap signs you in — seeded data, no real patients.</p>
            {DEMO_GROUPS.map(group => (
              <div className="lg-demo-group" key={group}>
                <p className="lg-demo-group-name">{group}</p>
                <div className="lg-demo-rows">
                  {DEMO_ACCOUNTS.filter(a => a.group === group).map(acct => (
                    <button
                      key={acct.user}
                      type="button"
                      className="lg-demo-row"
                      disabled={loading || !dbReady}
                      onClick={() => signInAsDemo(acct.user)}
                    >
                      <span className="lg-demo-role">{acct.role}</span>
                      <span className="lg-demo-user">{acct.user}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </aside>
        ) : (
          <aside className="lg-aside blueprint">
            <Corners />
            <span className="lg-eyebrow">One record, every level of care</span>
            <h2 className="lg-h2">Registration, consultation, lab, pharmacy — one patient story</h2>
            <p className="lg-aside-copy">
              Every visit adds to the same record and rolls up into facility dashboards and DHIS2-ready national reports.
            </p>
            <a className="lg-aside-link" href="https://tamamhealth.org/products">See the products &nbsp;›</a>
            <div className="lg-shot blueprint">
              <Corners />
              {/* eslint-disable-next-line @next/next/no-img-element -- photograph, cropped by CSS */}
              <img src="/assets/doctor-at-workstation.jpg" alt="A doctor at a workstation, reading a patient's record on screen" />
            </div>
          </aside>
        )}
      </div>

      <footer className="lg-footer">
        <a href="/terms">Terms &amp; Conditions</a>
        <a href="/terms">Privacy Policy</a>
        <a href="https://tamamhealth.org">Back to tamamhealth.org</a>
      </footer>

      {loginStyles}
    </div>
  );
}

/* The marketing site's login tokens, kept local to this route so the platform
   palette is untouched. Values mirror website/src/app/globals.css. */
const loginStyles = (
  <style jsx global>{`
    .lg-root {
      --lg-text: #0E2A4A;
      --lg-divider: rgba(14, 42, 74, 0.3);
      --lg-surface: #F2F8FC;
      --lg-accent: #2191D0;
      --lg-accent-100: #F5FBFE;
      --lg-accent-700: #015697;
      --lg-cta: #E8863A;
      --lg-cta-hover: #D2712A;
      --lg-neutral-600: #6C7C8E;
      --lg-neutral-700: #5B6B7E;
      --lg-neutral-800: #3D5166;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background: #FFFFFF;
      color: var(--lg-text);
      font-family: var(--lg-font-body), 'Barlow', system-ui, sans-serif;
    }
    .lg-root h1, .lg-root h2 {
      font-family: var(--lg-font-heading), 'Barlow Condensed', system-ui, sans-serif;
      font-weight: 600;
      line-height: 1.12;
      letter-spacing: -0.015em;
      margin: 0 0 7px;
    }

    /* Blueprint frame + its four registration marks. */
    .blueprint { position: relative; border: 1px solid var(--lg-divider); border-radius: 0; }
    .lg-corner { position: absolute; width: 11px; height: 11px; color: rgba(14, 42, 74, 0.55); }
    .lg-corner::before, .lg-corner::after { content: ''; position: absolute; background: currentColor; }
    .lg-corner::before { left: 5px; top: 0; width: 1px; height: 100%; }
    .lg-corner::after { top: 5px; left: 0; width: 100%; height: 1px; }
    .lg-corner.tl { top: -6px; left: -6px; }
    .lg-corner.tr { top: -6px; right: -6px; }
    .lg-corner.bl { bottom: -6px; left: -6px; }
    .lg-corner.br { bottom: -6px; right: -6px; }

    .lg-topbar { border-bottom: 1px solid var(--lg-divider); padding: 22px 32px; display: flex; justify-content: center; }
    .lg-topbar-link { display: flex; align-items: center; gap: 11px; text-decoration: none; }
    .lg-topbar-logo { height: 27px; width: auto; display: block; }

    .lg-grid {
      flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 56px;
      max-width: 1320px; width: 100%; margin: 0 auto; padding: 64px 32px 60px; align-items: start;
    }
    /* With the roster in the right column, trade headroom for roster room. */
    .lg-grid:has(.lg-demo) { padding-top: 24px; }
    .lg-col { display: flex; flex-direction: column; gap: 20px; }
    .lg-h1 { font-size: 36px; margin: 0 0 4px; }
    .lg-h2 { font-size: 30px; margin: 0; }
    .lg-lede { margin: 0; font-size: 15px; color: var(--lg-neutral-700); }

    .lg-form { display: flex; flex-direction: column; gap: 20px; }
    .lg-field { display: block; }
    .lg-field--rel { position: relative; }
    .lg-field > label { display: block; font-size: 12px; margin-bottom: 5px; color: rgba(14, 42, 74, 0.7); text-transform: none; letter-spacing: normal; }
    /* The .lg-root scoping is load-bearing: globals.css paints every
       input[type=...] with --bg-card-solid at specificity 0,1,1, which
       outranks a bare .lg-input and left the fields a pale grey. The site's
       fields are white. */
    .lg-root .lg-input {
      width: 100%; min-height: 46px; padding: 6px 12px; font: inherit; font-size: 14px;
      color: var(--lg-text); caret-color: var(--lg-accent); background: #FFFFFF;
      border: 1px solid var(--lg-divider); border-radius: 0; box-shadow: none;
    }
    .lg-input:hover { border-color: rgba(14, 42, 74, 0.45); }
    .lg-input:focus, .lg-input:focus-visible { border-color: var(--lg-accent); outline: none; box-shadow: none; }
    .lg-input::placeholder { color: rgba(14, 42, 74, 0.45); }
    .lg-inputwrap { display: flex; align-items: center; border: 1px solid var(--lg-divider); background: #FFFFFF; }
    .lg-inputwrap:focus-within { border-color: var(--lg-accent); }
    .lg-input--bare { border: 0 !important; background: transparent !important; }
    .lg-inputicon { margin-left: 13px; flex-shrink: 0; color: var(--lg-neutral-600); }
    .lg-clear, .lg-eye {
      appearance: none; border: 0; background: none; cursor: pointer; height: 44px;
      display: grid; place-items: center;
    }
    .lg-clear { width: 40px; color: var(--lg-neutral-600); font-size: 17px; }
    .lg-eye { width: 44px; color: var(--lg-accent-700); }

    .lg-rolelist {
      position: absolute; top: 100%; left: 0; right: 0; z-index: 40; background: #FFFFFF;
      border: 1px solid var(--lg-divider); border-top: 0; max-height: 232px; overflow-y: auto;
      box-shadow: 0 3px 10px rgba(43, 43, 45, 0.16);
    }
    .lg-rolerow {
      appearance: none; border: 0; border-bottom: 1px solid var(--lg-divider); background: #FFFFFF;
      cursor: pointer; width: 100%; text-align: left; padding: 11px 14px;
      display: flex; flex-direction: column; gap: 2px; font: inherit;
    }
    .lg-rolerow:hover, .lg-rolerow.is-selected { background: var(--lg-accent-100); }
    .lg-rolerow-name { font-family: var(--lg-font-heading), 'Barlow Condensed', system-ui, sans-serif; font-weight: 600; font-size: 15px; color: var(--lg-text); }
    .lg-rolerow-scope { font-size: 12.5px; color: var(--lg-neutral-600); }
    .lg-rolelist-empty { display: block; padding: 14px; font-size: 13.5px; color: var(--lg-neutral-600); }

    /* text-transform guard: globals.css uppercases every label. */
    .lg-keep { display: flex; align-items: center; gap: 9px; font-size: 14px; color: var(--lg-neutral-800); text-transform: none; letter-spacing: normal; }
    .lg-keep input { width: 16px; height: 16px; accent-color: var(--lg-accent-700); }

    /* Amber on navy ink, the site's primary call to action (.btn-primary in
       website/globals.css). Every other blue on this screen is structural —
       the links, the headings, the field focus ring — so the one button that
       submits is the one warm colour on the page. White text on amber misses
       4.5:1; navy ink carries it. */
    .lg-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      width: 100%; padding: 15px 0; font-family: var(--lg-font-heading), 'Barlow Condensed', system-ui, sans-serif;
      font-weight: 600; font-size: 16px; color: #0E2A4A; background: var(--lg-cta);
      border: 1px solid var(--lg-cta); border-radius: 0; cursor: pointer;
    }
    .lg-btn:hover:not(:disabled) { background: var(--lg-cta-hover); border-color: var(--lg-cta-hover); }
    .lg-btn:disabled { opacity: 0.45; cursor: not-allowed; }

    /* The platform's danger token, not the site's own red: an auth failure is
       the same alarm here as anywhere else in the app. */
    .lg-error { font-size: 14px; line-height: 1.55; color: var(--color-danger); border-left: 3px solid var(--color-danger); padding-left: 12px; }
    .lg-boot { display: flex; align-items: center; gap: 9px; font-size: 13.5px; color: var(--lg-neutral-700); }
    .lg-spin, .lg-redirect-mark {
      width: 14px; height: 14px; border: 2px solid rgba(14, 42, 74, 0.2);
      border-top-color: var(--lg-accent-700); border-radius: 50%; animation: lg-spin 0.8s linear infinite;
    }
    @keyframes lg-spin { to { transform: rotate(360deg); } }

    .lg-links { display: flex; gap: 24px; flex-wrap: wrap; padding-top: 4px; }
    .lg-links a { font-size: 14.5px; font-weight: 700; color: var(--lg-accent-700); text-underline-offset: 3px; }
    .lg-offline { font-size: 13px; line-height: 1.55; color: var(--lg-neutral-600); border-top: 1px solid var(--lg-divider); padding-top: 14px; }

    /* Demo roster — fills the right column on demo deployments (the aside's
       surface language) so the whole roster sits beside the form instead of
       below the fold. Compact paddings are deliberate: 21 accounts across 7
       facilities should fit a 900px-tall laptop viewport. */
    .lg-demo { background: var(--lg-surface); padding: 16px 20px 18px; align-self: start; }
    .lg-demo h2 { font-size: 19px; margin: 0; }
    .lg-demo > p { margin: 2px 0 8px; font-size: 13px; color: var(--lg-neutral-600); }
    .lg-demo-group + .lg-demo-group { margin-top: 8px; }
    .lg-demo-group-name { margin: 0 0 3px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--lg-neutral-600); }
    .lg-demo-rows { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 4px; }
    /* Stacked like the role-list rows (name over detail): uniform card height
       keeps the 21-account roster inside one laptop viewport. */
    .lg-demo-row {
      display: flex; flex-direction: column; gap: 1px;
      padding: 5px 10px; border: 1px solid var(--lg-divider); background: #FFFFFF;
      cursor: pointer; font: inherit; text-align: left;
    }
    .lg-demo-row:hover:not(:disabled) { background: var(--lg-accent-100); border-color: var(--lg-accent); }
    .lg-demo-row:disabled { opacity: 0.5; cursor: not-allowed; }
    .lg-demo-role { font-size: 13px; line-height: 1.25; font-weight: 600; color: var(--lg-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lg-demo-user { font-size: 10.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--lg-neutral-600); }

    .lg-aside { background: var(--lg-surface); padding: 30px 32px 32px; display: flex; flex-direction: column; gap: 14px; }
    .lg-eyebrow { font-size: 11.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--lg-accent-700); }
    .lg-aside-copy { margin: 0; font-size: 15px; line-height: 1.6; color: var(--lg-neutral-800); }
    .lg-aside-link { font-family: var(--lg-font-heading), 'Barlow Condensed', system-ui, sans-serif; font-weight: 600; font-size: 16px; color: var(--lg-accent-700); text-decoration: none; }
    /* A photograph, not a screenshot of the app: the panel argues what the
       record is for, and the person signing in is about to see the interface
       anyway. A fixed height with an object-fit crop so a landscape frame
       sits as a band under the copy rather than setting the column height. */
    .lg-shot { margin-top: 10px; height: 232px; background: #FFFFFF; overflow: hidden; }
    .lg-shot img { width: 100%; height: 100%; object-fit: cover; object-position: center 38%; display: block; }

    .lg-footer {
      border-top: 1px solid var(--lg-divider); padding: 22px 32px; display: flex;
      justify-content: center; gap: 28px; font-size: 13.5px; flex-wrap: wrap;
    }
    .lg-footer a { color: var(--lg-accent-700); text-underline-offset: 3px; }

    .lg-redirect {
      min-height: 100vh; display: flex; flex-direction: column; gap: 16px;
      align-items: center; justify-content: center; background: #FFFFFF;
    }
    .lg-redirect-mark { width: 26px; height: 26px; border-width: 3px; }
    .lg-redirect p { color: var(--lg-accent-700, #015697); font-size: 14px; font-weight: 600; }

    /* One column below the split — the product panel follows the form. */
    @media (max-width: 900px) {
      .lg-grid { grid-template-columns: 1fr; gap: 36px; padding: 40px 20px 48px; }
    }
  `}</style>
);

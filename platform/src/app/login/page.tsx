'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Eye, EyeOff } from '@/components/icons/lucide';
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

// Tamam brand accent — sourced from the shared theme tokens.
const ACCENT = 'var(--accent-primary)';
const ACCENT_DEEP = 'var(--accent-hover)';

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


export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, currentUser, dbReady } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
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
      <div className="tl-loading">
        <div className="tl-loading-mark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/tamam-icon.svg" alt="" aria-hidden width={40} height={40} />
        </div>
        <p>Redirecting to your dashboard…</p>
        <style jsx>{`
          .tl-loading { min-height: 100vh; display: flex; flex-direction: column; gap: 16px; align-items: center; justify-content: center; background: var(--bg-app, #EFF8FD); }
          .tl-loading-mark { animation: tl-pulse 1.2s ease-in-out infinite; }
          .tl-loading p { color: ${ACCENT_DEEP}; font-size: 14px; font-weight: 600; }
          @keyframes tl-pulse { 0%,100% { opacity: .55; transform: scale(.96);} 50% { opacity: 1; transform: scale(1);} }
        `}</style>
      </div>
    );
  }

  // ─────────────────────────── Sign-in ───────────────────────────
  return (
      <div className="tl-shell">
        <div className="tl-split">
          {/* ── Left: form ── */}
          <section className="tl-pane tl-form-pane">
            <header className="tl-brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/assets/tamamhealth-logo-full.svg" alt="Tamam Healthcare System" className="tl-brand-logo" />
            </header>

            <div className="tl-form-wrap">
              <h1 className="tl-title">Sign in</h1>
              <p className="tl-subtitle">Enter your account credentials</p>

              {!dbReady && (
                <div className="tl-db-banner"><span className="tl-spin" /> Initializing offline database…</div>
              )}

              <form onSubmit={handleSubmit} className="tl-form">
                {/* Full name */}
                <div className="tl-field">
                  <label htmlFor="tl-name">Full name</label>
                  <input id="tl-name" type="text" value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Username or Staff ID"
                    className="tl-input" autoComplete="username" />
                </div>

                {/* Role — everyone signs in as their own role; the platform
                    super-admin may pick any role and enter its workspace.
                    Searchable: typing filters the list, picking fills it. */}
                <div className="tl-field">
                  <label htmlFor="tl-role">Role</label>
                  <div className="tl-role-wrap">
                    <input id="tl-role" type="text" className="tl-input tl-role-input"
                      role="combobox" aria-expanded={roleMenuOpen} aria-controls="tl-role-menu"
                      aria-autocomplete="list" autoComplete="off"
                      placeholder="Your assigned role" value={roleQuery}
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
                      }} />
                    {/* Inline color on purpose: the global svg.lucide rule skips
                        icons that carry their own color. */}
                    <ChevronDown size={16} className="tl-role-caret" style={{ color: 'var(--text-muted)' }} aria-hidden />
                    {roleMenuOpen && (
                      <ul id="tl-role-menu" className="tl-role-menu" role="listbox" aria-label="Roles">
                        <li>
                          {/* onMouseDown (not click) so picking wins the race
                              against the input's blur closing the menu. */}
                          <button type="button" role="option" aria-selected={roleChoice === ''}
                            className={roleChoice === '' ? 'is-selected' : ''}
                            onMouseDown={(e) => { e.preventDefault(); selectRole(null); }}>
                            Your assigned role
                          </button>
                        </li>
                        {roleMatches.map((r) => (
                          <li key={r.value}>
                            <button type="button" role="option" aria-selected={roleChoice === r.value}
                              className={roleChoice === r.value ? 'is-selected' : ''}
                              onMouseDown={(e) => { e.preventDefault(); selectRole(r); }}>
                              {r.label}
                            </button>
                          </li>
                        ))}
                        {roleMatches.length === 0 && (
                          <li className="tl-role-empty">No role matches “{roleQuery.trim()}”.</li>
                        )}
                      </ul>
                    )}
                  </div>
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

              {/* ── Demo accounts ──
                  Only rendered where the deployment declares itself a demo.
                  Grouped by facility and ordered the way a patient meets each
                  role, so a visitor can walk the journey without knowing a
                  single username. */}
              {demoEnabled && (
                <section className="tl-demo" aria-labelledby="tl-demo-title">
                  <div className="tl-demo-head">
                    <h2 id="tl-demo-title">Choose a demo account</h2>
                    <p>One tap signs you in — seeded data, no real patients.</p>
                  </div>
                  {DEMO_GROUPS.map(group => (
                    <div className="tl-demo-group" key={group}>
                      <p className="tl-demo-group-name">{group}</p>
                      <div className="tl-demo-rows">
                        {DEMO_ACCOUNTS.filter(a => a.group === group).map(acct => (
                          <button
                            key={acct.user}
                            type="button"
                            className="tl-demo-row"
                            disabled={loading || !dbReady}
                            onClick={() => signInAsDemo(acct.user)}
                          >
                            <span className="tl-demo-role">{acct.role}</span>
                            <span className="tl-demo-user">{acct.user}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              )}

              <p className="tl-foot">
                <a href="/patient-portal" className="tl-link">Sign in as a patient</a>
                <span className="tl-foot-sep">·</span>
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="tl-link">Terms &amp; Conditions</a>
              </p>
            </div>
          </section>

          {/* ── Right: hero ── */}
          <section className="tl-hero" style={{ backgroundImage: "url(/assets/landing-img.jpg)" }}>
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

// Styled-jsx for the sign-in screen (blue + lavender theme).
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

    /* ── Role combobox ── */
    .tl-role-wrap { position: relative; }
    .tl-shell .tl-role-input { padding-right: 44px; }
    .tl-role-caret { position: absolute; right: 18px; top: 50%; transform: translateY(-50%); pointer-events: none; }
    .tl-role-menu { position: absolute; z-index: 20; top: calc(100% + 6px); left: 0; right: 0; margin: 0; padding: 6px; list-style: none; background: var(--bg-card-solid); border: 1px solid var(--border-light); border-radius: 16px; box-shadow: 0 12px 28px color-mix(in srgb, var(--accent-hover) 14%, transparent); max-height: 242px; overflow-y: auto; }
    .tl-role-menu li { list-style: none; }
    .tl-role-menu button { display: block; width: 100%; text-align: left; padding: 9px 12px; font-size: 14px; font-family: inherit; color: var(--text-primary); background: transparent; border: none; border-radius: 10px; cursor: pointer; }
    .tl-role-menu button:hover { background: var(--overlay-subtle); }
    .tl-role-menu button.is-selected { color: ${ACCENT_DEEP}; font-weight: 700; }
    .tl-role-empty { padding: 9px 12px; font-size: 13px; color: var(--text-muted); }
    .tl-input-eye { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: none; background: transparent; color: var(--text-muted); cursor: pointer; border-radius: 6px; }
    .tl-input-eye:hover { color: ${ACCENT_DEEP}; }
    .tl-error { padding: 10px 13px; font-size: 12.5px; color: var(--color-danger); background: var(--color-danger-bg); border: 1px solid color-mix(in srgb, var(--color-danger) 22%, transparent); border-radius: 10px; }
    .tl-submit { width: 100%; height: 52px; padding: 0 24px; margin-top: 4px; font-size: 15px; font-weight: 700; color: var(--color-white); background: var(--accent-primary); border: none; border-radius: 999px; cursor: pointer; transition: transform .12s, box-shadow .15s, opacity .15s; box-shadow: none; }
    .tl-submit:hover:not(:disabled) { background: ${ACCENT_DEEP}; transform: translateY(-1px); box-shadow: none; }
    .tl-submit:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-border); }
    .tl-submit:disabled { opacity: .6; cursor: not-allowed; }
    .tl-submit-loading { display: inline-flex; align-items: center; gap: 8px; }
    /* ── Demo account picker (demo deployments only) ──
       A quiet panel under the form: the roster is a shortcut, not the primary
       way in, so it reads as a list of links rather than a wall of buttons. */
    .tl-demo { margin-top: 26px; padding-top: 20px; border-top: 1px solid var(--border-light); }
    .tl-demo-head h2 { margin: 0; font-size: 14px; font-weight: 700; color: var(--text-primary); }
    .tl-demo-head p { margin: 3px 0 14px; font-size: 12px; color: var(--text-muted); }
    .tl-demo-group + .tl-demo-group { margin-top: 14px; }
    .tl-demo-group-name { margin: 0 0 6px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
    .tl-demo-rows { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px; }
    .tl-demo-row {
      display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
      padding: 8px 10px; border: 1px solid var(--border-light); border-radius: 8px;
      background: var(--bg-card-solid); cursor: pointer; font-family: inherit; text-align: left;
      transition: border-color .15s ease, background .15s ease;
    }
    .tl-demo-row:hover:not(:disabled) { border-color: ${ACCENT}; background: var(--overlay-subtle); }
    .tl-demo-row:disabled { opacity: .55; cursor: not-allowed; }
    .tl-demo-role { font-size: 12.5px; font-weight: 600; color: var(--text-primary); }
    .tl-demo-user { font-size: 10.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text-muted); }
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
    .tl-hero-panel { position: absolute; z-index: 2; left: 34px; right: 34px; bottom: 100px; color: var(--color-white); text-shadow: 0 1px 2px rgba(2, 26, 45, 0.35); }
    .tl-hero-eyebrow { display: block; font-size: 12px; font-weight: 700; letter-spacing: 0.01em; color: rgba(255, 255, 255, 0.88); }
    .tl-hero-line { display: block; margin-top: 9px; font-family: var(--font-platform); font-size: 30px; line-height: 1.16; font-weight: 800; letter-spacing: -0.02em; }

    /* Icons follow their container's color — the global svg.lucide rule would
       otherwise pin them to the app icon color (dark glyphs on the dark hero). */
    .tl-shell .tl-input-eye svg.lucide { color: inherit; stroke: currentColor; }

    .tl-spin { width: 13px; height: 13px; border: 2px solid var(--accent-border); border-top-color: ${ACCENT}; border-radius: 50%; display: inline-block; animation: tl-rot .7s linear infinite; }
    .tl-spin-light { border-color: color-mix(in srgb, var(--color-white) 40%, transparent); border-top-color: var(--color-white); }
    @keyframes tl-rot { to { transform: rotate(360deg); } }

    @media (max-width: 860px) {
      .tl-split { grid-template-columns: 1fr; height: auto; max-width: 460px; }
      .tl-hero { display: none; }
      .tl-pane { padding: 28px 26px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .tl-submit, .tl-input { transition: none; }
      .tl-submit:hover:not(:disabled) { transform: none; }
    }
  `}</style>
);

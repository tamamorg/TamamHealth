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
 * password) and every state the platform has (offline-database boot, error
 * and loading) keeps working.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { resolveLandingPage } from '@/lib/user-prefs';
import { ROLE_ROUTE_TABLE } from '@/lib/role-routes';
import { getRoleConfig } from '@/lib/permissions';
import type { UserRole } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Corners, loginStyles } from '@/components/login/login-chrome';

// Role picker options — every role in the platform, labeled like the rest of
// the UI. Everyone signs in as their assigned role; only the platform
// super-admin may pick a different one and enter that role's workspace.
//
// Two roles can share a display label. `doctor` and `clinician` are both
// "Doctor", and their route tables are character-for-character the same, so
// the picker used to offer "Doctor (doctor)" and "Doctor (clinician)" — two
// rows, one destination, and a key nobody outside the codebase has ever seen.
// This question ("which workspace do you want to enter?") has one answer for
// both, so they collapse to one row.
//
// The collapse is conditional on purpose: same label but a DIFFERENT route set
// would be two genuinely different workspaces wearing one name, and hiding one
// of them would make a workspace unreachable. Those keep the disambiguating
// suffix, which is the only case it was ever for.
const ROLE_OPTIONS = (() => {
  const roles = Object.keys(ROLE_ROUTE_TABLE) as UserRole[];
  const workspaceOf = (value: UserRole) =>
    `${ROLE_ROUTE_TABLE[value].defaultDashboard}|${[...ROLE_ROUTE_TABLE[value].allowed].sort().join(',')}`;

  const byLabel = new Map<string, UserRole[]>();
  for (const value of roles) {
    const label = getRoleConfig(value).label;
    byLabel.set(label, [...(byLabel.get(label) ?? []), value]);
  }

  const options: { value: UserRole; label: string }[] = [];
  for (const [label, sharing] of byLabel) {
    // Group the roles under this label by the workspace they open. One group
    // means one row; more than one means the label is genuinely ambiguous.
    const byWorkspace = new Map<string, UserRole[]>();
    for (const value of sharing) {
      const key = workspaceOf(value);
      byWorkspace.set(key, [...(byWorkspace.get(key) ?? []), value]);
    }
    const ambiguous = byWorkspace.size > 1;
    for (const group of byWorkspace.values()) {
      // First key in the table wins — it is the canonical one for that
      // workspace, and the picker only ever needs one way in.
      options.push({ value: group[0], label: ambiguous ? `${label} (${group[0]})` : label });
    }
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
})();

/**
 * One seeded demo account, as `/api/demo-credentials` returns it. The roster
 * and its passwords are per-deployment state fetched at runtime — nothing
 * here is hard-coded, and the route answers only on a standalone demo (see
 * `isStandaloneDemo` in lib/server-users.ts), so a real deployment renders
 * the product panel instead.
 */
interface DemoAccount {
  username: string;
  password: string;
  name: string;
  role: string;
  facility?: string;
  orgId?: string;
}

/** The heading an account is filed under: its facility, or the body it works
 *  for when it has none (org admins, the ministry, the platform operator). */
function demoGroupName(account: DemoAccount): string {
  if (account.facility) return account.facility;
  if (account.orgId === 'org-mercy-hospital') return 'Mercy Hospital Group';
  if (account.orgId === 'org-moh-ss') return 'Ministry of Health';
  return 'Platform';
}

export default function LoginPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { login, lastLoginFailure, isAuthenticated, currentUser, dbReady } = useAuth();
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
  // Demo-only account picker. The build-time flag decides whether to ASK;
  // the answer decides whether to show anything, so a deployment where the
  // route declines (it has a users database) keeps the product panel.
  const demoEnabled = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);
  // Second-factor step. The password has been accepted and the server is
  // holding a five-minute hand-off token; nothing is signed in yet.

  // Username handed over from the marketing site's login (?u=). Read from
  // window rather than useSearchParams — the same pattern the patients and
  // appointments pages use for their deep links, and it keeps this route out
  // of a Suspense boundary. Only the username ever travels, never a password,
  // and the param is stripped once read so it does not linger in the address
  // bar, history or a referrer header.
  // Text can reach these fields before React hydrates — a password manager
  // autofilling, or someone typing while "Initializing offline database…" is
  // still up. Those writes land straight on the DOM node, so `username` and
  // `password` never see them, and hydration does not clear the visible text.
  // The form then looks filled while submit posts empty strings, which the API
  // rejects with "Username and password are required". Adopt whatever the DOM
  // already holds, once, on mount.
  const nameInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const preHydrationName = nameInputRef.current?.value;
    const preHydrationPassword = passwordInputRef.current?.value;
    if (preHydrationName) setUsername(prev => prev || preHydrationName);
    if (preHydrationPassword) setPassword(prev => prev || preHydrationPassword);
  }, []);

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

  // Passwords are minted per deployment; pull them once per load rather than
  // shipping any in the bundle.
  useEffect(() => {
    if (!demoEnabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/demo-credentials', { cache: 'no-store' });
        if (!res.ok) return;
        const body = await res.json() as { profiles?: DemoAccount[] };
        if (!cancelled) setDemoAccounts(body.profiles ?? []);
      } catch {
        // The picker is a convenience — the manual form still signs in.
      }
    })();
    return () => { cancelled = true; };
  }, [demoEnabled]);

  // Grouped by facility, in the order the roster lists them, so every seeded
  // account is on screen and each facility's staff stay together.
  const demoGroups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, DemoAccount[]>();
    for (const account of demoAccounts) {
      const group = demoGroupName(account);
      if (!byGroup.has(group)) { byGroup.set(group, []); order.push(group); }
      byGroup.get(group)!.push(account);
    }
    return order.map(name => ({ name, accounts: byGroup.get(name)! }));
  }, [demoAccounts]);

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

  /**
   * Name the actual refusal. Every failed sign-in used to read "Invalid
   * credentials", so a stopped database or a lockout sent people back to
   * retyping a password that was already correct.
   */
  const describeLoginFailure = (fallback: string) => {
    const failure = lastLoginFailure();
    if (!failure) return fallback;

    // Codes first. A code is the most specific thing the refusal could tell us,
    // and unlike a status it says *why* rather than merely which layer said no.
    // Two of these never involve the network at all.
    switch (failure.code) {
      // Policy: the password was already verified before these were decided.
      case 'impersonation_disabled': return t('login.errorImpersonationDisabled');
      case 'role_not_permitted': return t('login.errorRoleNotPermitted');
      // Offline: the request never left the device.
      case 'offline_no_credential': return t('login.errorOfflineNoCredential');
      case 'offline_bad_password': return t('login.errorOfflineBadPassword');
      default: break;
    }

    if (failure.status === 429) {
      const minutes = failure.retryAfterSeconds ? Math.ceil(failure.retryAfterSeconds / 60) : 0;
      return minutes > 0
        ? t('login.errorTooManyAttemptsIn', { minutes })
        : t('login.errorTooManyAttempts');
    }
    if (failure.status >= 500) return t('login.errorServiceUnavailable');
    // An unrecognised 403 still beats the credentials message: the server's own
    // prose is at least about the real reason, even if it is untranslated.
    if (failure.status === 403 && failure.message) return failure.message;
    return fallback;
  };

  /** One tap = filled form + signed in, so a demo never stalls on a password. */
  const signInAsDemo = async (account: DemoAccount) => {
    setUsername(account.username);
    setPassword(account.password);
    setRoleChoice('');
    setRoleQuery('');
    setError('');
    setLoading(true);
    try {
      const result = await login(account.username, account.password);
      if (result) router.push(resolveLandingPage(result));
      else { setError(describeLoginFailure('That demo account could not sign in.')); setLoading(false); }
    } catch { setError('Login failed. Please try again.'); setLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(username, password, undefined, roleChoice || undefined);
      if (result) { router.push(resolveLandingPage(result)); return; }

      setError(describeLoginFailure(t('login.errorInvalidCredentials')));
      setLoading(false);
    } catch { setError(t('login.errorLoginFailed')); setLoading(false); }
  };

  if (isAuthenticated) {
    return (
      <div className="lg-redirect">
        <span className="lg-redirect-mark" />
        <p>{t('login.redirectingDashboard')}</p>
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
            <h1 className="lg-h1">{t('login.logIn')}</h1>
            <p className="lg-lede">{t('login.subheadingIssued')}</p>
          </div>

          {/* Informational only. This used to also DISABLE the submit button,
              which held every sign-in hostage to the demo seed finishing —
              41 measured seconds on a fresh device — even though sign-in is
              server-first and reads none of what was being written. Only the
              offline fallback needs the local store, and its own error copy
              already explains that case. */}
          {!dbReady && (
            <div className="lg-boot"><span className="lg-spin" /> {t('login.initializingOffline')}</div>
          )}

          <form onSubmit={handleSubmit} className="lg-form">
            <div className="lg-field">
              <label htmlFor="tl-name">{t('login.usernameLabel')}</label>
              <input
                id="tl-name"
                ref={nameInputRef}
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
              <label htmlFor="tl-role">{t('login.roleLabel')}</label>
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
                  placeholder={t('login.rolePlaceholder')}
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
                    <span className="lg-rolerow-name">{t('login.roleAssigned')}</span>
                    <span className="lg-rolerow-scope">{t('login.roleAnyHint')}</span>
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
              <label htmlFor="tl-password">{t('login.passwordLabel')}</label>
              <div className="lg-inputwrap">
                <input
                  id="tl-password"
                  ref={passwordInputRef}
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
              {t('login.keepSignedIn')}
            </label>

            {error && <div role="alert" className="lg-error">{error}</div>}

            <button type="submit" disabled={loading} className="lg-btn blueprint">
              {loading ? t('login.signingIn') : t('login.logIn')}
              <Corners />
            </button>
          </form>

          <div className="lg-links">
            <a href="/patient-portal">{t('login.patientPortal')}</a>
            {/* A mailto asked someone with no account to compose an email to
                an address that cannot verify them, and the reply was a human
                copying a password into a message. This goes to a form whose
                answer is an account, routed to whoever is allowed to grant it. */}
            <a href="/request-account">{t('login.requestAccount')}</a>
            {/* The string for this existed in both locales from the day the
                login page shipped and was rendered nowhere, because there was
                no flow behind it: every forgotten password was an
                administrator reset and a credential read down a phone line. */}
            <a href="/forgot-password">{t('login.forgotPassword')}</a>
          </div>

          <span className="lg-note">
            {t('login.offlineNote')}
          </span>

        </div>

        {/* ── Right: the seeded roster on a standalone demo, the product
              panel everywhere else. A sign-in page does not offer working
              credentials to whoever loads it — but the demo deployment has no
              users database, no CouchDB and no real patients, and its whole
              purpose is to be walked through without asking anyone for a
              login. `/api/demo-credentials` decides which deployment this is;
              a server that could authenticate a real account returns nothing
              and this column stays a product panel. */}
        {demoGroups.length > 0 ? (
          <aside className="lg-demo blueprint" aria-labelledby="lg-demo-title">
            <Corners />
            <h2 id="lg-demo-title">Choose a demo account</h2>
            <p>One tap signs you in — seeded data, no real patients.</p>
            <div className="lg-demo-scroll">
              {demoGroups.map(group => (
                <div className="lg-demo-group" key={group.name}>
                  <p className="lg-demo-group-name">{group.name}</p>
                  <div className="lg-demo-rows">
                    {group.accounts.map(account => (
                      <button
                        key={account.username}
                        type="button"
                        className="lg-demo-row"
                        disabled={loading}
                        onClick={() => signInAsDemo(account)}
                      >
                        <span className="lg-demo-role">{getRoleConfig(account.role as UserRole).label}</span>
                        <span className="lg-demo-name">{account.name}</span>
                        <span className="lg-demo-user">{account.username}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        ) : (
        <aside className="lg-aside blueprint">
          <Corners />
          <span className="lg-eyebrow">{t('login.tagline')}</span>
          <h2 className="lg-h2">{t('login.promoHeadline')}</h2>
          <p className="lg-aside-copy">
            {t('login.promoBody')}
          </p>
          <a className="lg-aside-link" href="https://tamamhealth.org/products">{t('login.seeProducts')} &nbsp;›</a>
          <div className="lg-shot blueprint">
            <Corners />
            {/* eslint-disable-next-line @next/next/no-img-element -- photograph, cropped by CSS */}
            <img src="/assets/doctor-at-workstation.jpg" alt="A doctor at a workstation, reading a patient's record on screen" />
          </div>
        </aside>
        )}
      </div>

      <footer className="lg-footer">
        <a href="/terms">{t('login.termsAndConditions')}</a>
        <a href="/privacy">{t('login.privacyPolicy')}</a>
        <a href="https://tamamhealth.org">{t('login.backToSite')}</a>
      </footer>

      {loginStyles}
    </div>
  );
}

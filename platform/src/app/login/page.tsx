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

import { useState, useEffect, useRef } from 'react';
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

export default function LoginPage() {
  const { t } = useTranslation();
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(username, password, undefined, roleChoice || undefined);
      if (result) router.push(resolveLandingPage(result));
      else { setError(t('login.errorInvalidCredentials')); setLoading(false); }
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

            <button type="submit" disabled={loading || !dbReady} className="lg-btn blueprint">
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
          </div>

          <span className="lg-note">
            {t('login.offlineNote')}
          </span>

        </div>

        {/* ── Right: what the platform is. This column used to hold a
              one-tap roster of seeded accounts on demo deployments. Accounts
              are issued by an administrator now — there is no roster to
              choose from, and a sign-in page that offers working credentials
              to anyone who loads it is not something to keep behind a flag. */}
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

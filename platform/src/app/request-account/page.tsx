'use client';

/**
 * "Request account" — the other half of the login page.
 *
 * Accounts here are issued by an administrator, never self-registered, so this
 * form does not create anything. It records a claim and tells the person a
 * human will look at it. Everything that decides access happens on the other
 * side, in the approver's queue.
 *
 * Drawn in the same login language (shared `lg-*` chrome) because it is the
 * same doorway: someone who clicked away from the sign-in form should not feel
 * they have left the building.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Corners, loginStyles } from '@/components/login/login-chrome';
import { getRoleConfig } from '@/lib/permissions';
import { REQUESTABLE_ROLES } from '@/lib/account-request-roles';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface Org { id: string; name: string }

const ROLE_OPTIONS = REQUESTABLE_ROLES
  .map(value => ({ value, label: getRoleConfig(value).label }))
  .sort((a, b) => a.label.localeCompare(b.label));

export default function RequestAccountPage() {
  const { t } = useTranslation();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [requestedRole, setRequestedRole] = useState('');
  const [orgId, setOrgId] = useState('');
  const [hospitalName, setHospitalName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/account-requests/options')
      .then(r => (r.ok ? r.json() : { organizations: [] }))
      .then(body => { if (!cancelled) setOrgs(body.organizations ?? []); })
      // A failed lookup must not block the form: the request still routes,
      // it just goes to the platform operator instead of an organisation's
      // own administrator.
      .catch(() => { if (!cancelled) setOrgs([]); });
    return () => { cancelled = true; };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      const res = await fetch('/api/account-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName, email, phone, requestedRole, note,
          orgId: orgId || undefined,
          orgName: orgs.find(o => o.id === orgId)?.name,
          hospitalName: hospitalName || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || 'Could not send the request. Try again.');
        return;
      }
      setSent(true);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="lg-root">
      <header className="lg-topbar">
        <a href="https://tamamhealth.org" className="lg-topbar-link">
          {/* eslint-disable-next-line @next/next/no-img-element -- brand mark, fixed size */}
          <img src="/assets/tamamhealth-logo-full.svg" alt="Tamam Healthcare System" className="lg-topbar-logo" />
        </a>
      </header>

      <div className="lg-grid">
        <div className="lg-col">
          {sent ? (
            <>
              <h1 className="lg-h1">Request sent</h1>
              <p className="lg-lede">
                An administrator will review it. If it is approved you will be emailed a username and a
                one-time password to change when you first sign in.
              </p>
              <div className="lg-links">
                <Link href="/login">Back to sign in</Link>
              </div>
            </>
          ) : (
            <>
              <h1 className="lg-h1">Request an account</h1>
              <p className="lg-lede">
                Accounts are issued by an administrator, not created here. Tell us who you are and what you
                do, and the right administrator will review it.
              </p>

              <form onSubmit={submit} className="lg-form">
                <div className="lg-field">
                  <label htmlFor="ra-name">Full name</label>
                  <input id="ra-name" className="lg-input" value={fullName} required autoComplete="name"
                    onChange={e => setFullName(e.target.value)} />
                </div>

                <div className="lg-field">
                  <label htmlFor="ra-email">Work email</label>
                  <input id="ra-email" type="email" className="lg-input" value={email} required autoComplete="email"
                    onChange={e => setEmail(e.target.value)} />
                </div>

                <div className="lg-field">
                  <label htmlFor="ra-phone">Phone <span className="lg-hint">(optional)</span></label>
                  <input id="ra-phone" className="lg-input" value={phone} autoComplete="tel"
                    onChange={e => setPhone(e.target.value)} />
                </div>

                <div className="lg-field">
                  <label htmlFor="ra-role">Role you need</label>
                  <select id="ra-role" className="lg-input" value={requestedRole} required
                    onChange={e => setRequestedRole(e.target.value)}>
                    <option value="" disabled>Choose your role…</option>
                    {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>

                {/* Choosing the organisation is what sends this to that
                    organisation's own administrator instead of the platform
                    operator. Left blank, it still arrives — just centrally. */}
                <div className="lg-field">
                  <label htmlFor="ra-org">Organisation</label>
                  <select id="ra-org" className="lg-input" value={orgId} onChange={e => setOrgId(e.target.value)}>
                    <option value="">Not listed / not sure</option>
                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>

                <div className="lg-field">
                  <label htmlFor="ra-facility">Facility you work at <span className="lg-hint">(optional)</span></label>
                  <input id="ra-facility" className="lg-input" value={hospitalName}
                    placeholder="e.g. Wau Teaching Hospital"
                    onChange={e => setHospitalName(e.target.value)} />
                </div>

                <div className="lg-field">
                  <label htmlFor="ra-note">Anything the administrator should know <span className="lg-hint">(optional)</span></label>
                  <textarea id="ra-note" className="lg-input" rows={3} value={note} maxLength={1000}
                    placeholder="Your staff ID, who your supervisor is, when you start…"
                    onChange={e => setNote(e.target.value)} />
                </div>

                {error && <div role="alert" className="lg-error">{error}</div>}

                <button type="submit" disabled={sending} className="lg-btn blueprint">
                  {sending ? 'Sending…' : 'Send request'}
                  <Corners />
                </button>
              </form>

              <div className="lg-links">
                <Link href="/login">Back to sign in</Link>
              </div>

              <span className="lg-offline">
                This form does not create an account and does not sign you in. Never enter a password here —
                the only place to enter one is the sign-in page.
              </span>
            </>
          )}
        </div>

        {/* Keep the account-request doorway paired with the same product
            story as staff sign-in. The form changes; the platform promise
            and visual landmark do not. */}
        <aside className="lg-aside blueprint">
          <Corners />
          <span className="lg-eyebrow">{t('login.tagline')}</span>
          <h2 className="lg-h2">{t('login.promoHeadline')}</h2>
          <p className="lg-aside-copy">{t('login.promoBody')}</p>
          <a className="lg-aside-link" href="https://tamamhealth.org/products">
            {t('login.seeProducts')} &nbsp;›
          </a>
          <div className="lg-shot blueprint">
            <Corners />
            {/* eslint-disable-next-line @next/next/no-img-element -- photograph, cropped by shared login CSS */}
            <img src="/assets/doctor-at-workstation.jpg" alt="A doctor at a workstation, reading a patient's record on screen" />
          </div>
        </aside>
      </div>

      {loginStyles}
    </div>
  );
}

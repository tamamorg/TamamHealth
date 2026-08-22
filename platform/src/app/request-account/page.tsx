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

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Corners, loginStyles } from '@/components/login/login-chrome';
import { getRoleConfig } from '@/lib/permissions';
import {
  REQUESTABLE_ROLES, accountRequestRoleNeedsFacility, roleRequiresRegistrationNumber,
} from '@/lib/account-request-roles';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface Org { id: string; name: string }
interface Facility { id: string; name: string; orgId: string }

const ROLE_OPTIONS = REQUESTABLE_ROLES
  .map(value => ({ value, label: getRoleConfig(value).label }))
  .sort((a, b) => a.label.localeCompare(b.label));

/**
 * The confirmation half of the flow.
 *
 * The link in the "is this really your address?" email comes back here with a
 * token. Redeeming it is what makes the request visible to an approver — until
 * then it is an unchecked claim about somebody else's mailbox, and nobody's
 * queue should be spending attention on it.
 */
function VerifyPanel({ token }: { token: string }) {
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/account-requests/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) {
          setMessage(body.message || 'Your address is confirmed.');
          setState('done');
        } else {
          setMessage(body.error || 'That confirmation link is no longer valid.');
          setState('failed');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMessage('Could not reach the server. Open the link again in a moment.');
          setState('failed');
        }
      });
    return () => { cancelled = true; };
  }, [token]);

  return (
    <>
      <h1 className="lg-h1">
        {state === 'working' ? 'Confirming…' : state === 'done' ? 'Address confirmed' : 'Link not valid'}
      </h1>
      <p className="lg-lede">
        {state === 'working' ? 'One moment.' : message}
      </p>
      <div className="lg-links">
        <Link href="/login">Back to sign in</Link>
        {state === 'failed' && <Link href="/request-account">Ask again</Link>}
      </div>
    </>
  );
}

function RequestAccountForm() {
  const { t } = useTranslation();
  const verifyToken = useSearchParams().get('verify') || '';
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [requestedRole, setRequestedRole] = useState('');
  const [orgId, setOrgId] = useState('');
  const [hospitalId, setHospitalId] = useState('');
  const [note, setNote] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const needsRegistration = roleRequiresRegistrationNumber(requestedRole);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/account-requests/options')
      .then(r => (r.ok ? r.json() : { organizations: [] }))
      .then(body => {
        if (!cancelled) {
          setOrgs(body.organizations ?? []);
          setFacilities(body.facilities ?? []);
        }
      })
      // Keep the page usable after a lookup failure. Organisation-wide roles
      // can still be routed centrally; facility-bound roles will clearly
      // require the options service before submission.
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
          hospitalId: hospitalId || undefined,
          hospitalName: facilities.find(f => f.id === hospitalId)?.name,
          professionalRegistrationNumber: needsRegistration ? registrationNumber : undefined,
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

  // Arriving from the confirmation email rather than from the login page.
  if (verifyToken) return <VerifyPanel token={verifyToken} />;

  return (
    <>
          {sent ? (
            <>
              <h1 className="lg-h1">Check your email</h1>
              <p className="lg-lede">
                We have sent a link to confirm your address. Nobody sees your request until you open
                it. Once you do, an administrator reviews it and contacts you if it is approved.
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
                  <select id="ra-org" className="lg-input" value={orgId} required={accountRequestRoleNeedsFacility(requestedRole)}
                    onChange={e => { setOrgId(e.target.value); setHospitalId(''); }}>
                    <option value="">Not listed / not sure</option>
                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>

                {accountRequestRoleNeedsFacility(requestedRole) && (
                  <div className="lg-field">
                    <label htmlFor="ra-facility">Facility you work at</label>
                    <select id="ra-facility" className="lg-input" value={hospitalId} required
                      disabled={!orgId} onChange={e => setHospitalId(e.target.value)}>
                      <option value="" disabled>{orgId ? 'Choose your facility…' : 'Choose an organisation first'}</option>
                      {facilities.filter(f => f.orgId === orgId).map(f => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Free text, and human-checked against the council register
                    rather than validated by shape — see the field's own note
                    in db-types. It exists so the approver has something real
                    to verify, not to gate the form. */}
                {needsRegistration && (
                  <div className="lg-field">
                    <label htmlFor="ra-reg">Council registration number</label>
                    <input id="ra-reg" className="lg-input" value={registrationNumber} required
                      onChange={e => setRegistrationNumber(e.target.value)}
                      placeholder="As it appears on your practising certificate" />
                    <span className="lg-hint">
                      Your administrator checks this against the register before granting clinical access.
                    </span>
                  </div>
                )}

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
    </>
  );
}

export default function RequestAccountPage() {
  const { t } = useTranslation();
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
          {/* useSearchParams needs a Suspense boundary in the App Router — the
              confirmation link arrives here with a token in the query. */}
          <Suspense fallback={<div className="lg-boot"><span className="lg-spin" /> Loading…</div>}>
            <RequestAccountForm />
          </Suspense>
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

'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';

type Org = { _id: string; name: string; slug: string; country?: string };
type Facility = { _id: string; name: string; orgId?: string };
const roles = [
  ['doctor', 'Doctor'], ['clinical_officer', 'Clinical officer'], ['nurse', 'Nurse'],
  ['midwife', 'Midwife'], ['triage_nurse', 'Triage nurse'], ['rooming_nurse', 'Rooming nurse'],
  ['front_desk', 'Reception / front desk'], ['lab_tech', 'Laboratory'], ['pharmacist', 'Pharmacy'],
  ['medical_biller', 'Medical billing'], ['org_admin', 'Organization administrator'],
] as const;

export default function SignupPage() {
  const [orgs, setOrgs] = useState<Org[]>([]); const [facilities, setFacilities] = useState<Facility[]>([]);
  const [form, setForm] = useState({ applicantName: '', email: '', phone: '', requestedRole: 'nurse', organizationId: '', facilityId: '', organizationName: '', organizationSlug: '', organizationCountry: 'South Sudan', message: '' });
  const [state, setState] = useState<'loading' | 'ready' | 'sent' | 'error'>('loading'); const [error, setError] = useState('');
  useEffect(() => { fetch('/api/account-requests?public=organizations').then(async r => { const v = await r.json(); if (!r.ok) throw new Error(v.error || 'Unable to load organizations'); return v; }).then(v => { setOrgs(v.organizations || []); setFacilities(v.facilities || []); setState('ready'); }).catch(() => { setError('Unable to load organizations.'); setState('error'); }); }, []);
  const isOrgAdmin = form.requestedRole === 'org_admin';
  const set = (key: string, value: string) => setForm(v => ({ ...v, [key]: value }));
  async function submit(e: React.FormEvent) { e.preventDefault(); setError(''); setState('loading');
    try {
      const res = await apiFetch('/api/account-requests/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const body = await res.json().catch(() => ({})); if (!res.ok) { setError(body.error || 'Please check the form and try again.'); setState('error'); return; } setState('sent');
    } catch { setError('The request could not be submitted. Check your connection and try again.'); setState('error'); }
  }
  if (state === 'sent') return <main className="min-h-screen bg-[var(--bg-app)] flex items-center justify-center p-6"><section className="max-w-lg w-full rounded-2xl border border-[var(--border-light)] bg-[var(--bg-card-solid)] p-8 text-center"><h1 className="text-2xl font-bold text-[var(--text-primary)]">Request submitted</h1><p className="mt-3 text-sm text-[var(--text-muted)]">Your request was sent to the appropriate administrator. You will receive login credentials after approval.</p><a className="inline-block mt-6 text-sm font-semibold text-[var(--accent-primary)]" href="/login">Return to sign in</a></section></main>;
  return <main className="min-h-screen bg-[var(--bg-app)] flex items-center justify-center p-6"><form onSubmit={submit} className="w-full max-w-2xl rounded-2xl border border-[var(--border-light)] bg-[var(--bg-card-solid)] p-7 shadow-sm"><div className="flex items-center justify-between mb-7"><div><h1 className="text-2xl font-bold text-[var(--text-primary)]">Request an account</h1><p className="text-sm text-[var(--text-muted)] mt-1">An administrator must approve your request before credentials are created.</p></div><a href="/login" className="text-sm text-[var(--accent-primary)]">Sign in</a></div>
    <div className="grid sm:grid-cols-2 gap-4"><label className="text-sm text-[var(--text-secondary)]">Full name<input required value={form.applicantName} onChange={e => set('applicantName', e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 bg-transparent" /></label><label className="text-sm text-[var(--text-secondary)]">Email<input required type="email" value={form.email} onChange={e => set('email', e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 bg-transparent" /></label><label className="text-sm text-[var(--text-secondary)]">Phone<input value={form.phone} onChange={e => set('phone', e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 bg-transparent" /></label><label className="text-sm text-[var(--text-secondary)]">Requested role<select value={form.requestedRole} onChange={e => set('requestedRole', e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 bg-transparent">{roles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    {!isOrgAdmin ? <><label className="text-sm text-[var(--text-secondary)] sm:col-span-2">Organization<select required value={form.organizationId} onChange={e => { set('organizationId', e.target.value); set('facilityId', ''); }} className="mt-1 w-full rounded-lg border p-2.5 bg-transparent"><option value="">Select organization</option>{orgs.map(o => <option key={o._id} value={o._id}>{o.name}</option>)}</select></label><label className="text-sm text-[var(--text-secondary)] sm:col-span-2">Facility<select required value={form.facilityId} onChange={e => set('facilityId', e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 bg-transparent"><option value="">Select facility</option>{facilities.filter(f => f.orgId === form.organizationId).map(f => <option key={f._id} value={f._id}>{f.name}</option>)}</select></label></> : <><label className="text-sm text-[var(--text-secondary)]">Organization name<input required value={form.organizationName} onChange={e => set('organizationName', e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 bg-transparent" /></label><label className="text-sm text-[var(--text-secondary)]">Organization slug<input required pattern="[a-z0-9-]+" value={form.organizationSlug} onChange={e => set('organizationSlug', e.target.value.toLowerCase())} className="mt-1 w-full rounded-lg border p-2.5 bg-transparent" /></label><label className="text-sm text-[var(--text-secondary)]">Country<input value={form.organizationCountry} onChange={e => set('organizationCountry', e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 bg-transparent" /></label></>}
    <label className="text-sm text-[var(--text-secondary)] sm:col-span-2">Message (optional)<textarea rows={3} value={form.message} onChange={e => set('message', e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 bg-transparent" placeholder="Tell the administrator what access you need" /></label></div>
    {error && <p className="mt-4 text-sm text-red-600">{error}</p>}<button disabled={state === 'loading'} className="mt-6 w-full rounded-lg bg-[var(--accent-primary)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{state === 'loading' ? 'Submitting…' : 'Submit request'}</button>
  </form></main>;
}

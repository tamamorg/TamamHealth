'use client';

import { useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { useIntakeForms } from '@/lib/hooks/useIntakeForms';
import { usePatients } from '@/lib/hooks/usePatients';
import { useUsers } from '@/lib/hooks/useUsers';
import { isRouteAllowed } from '@/lib/permissions';
import { patientFullName, patientGenderAge } from '@/lib/patient-utils';
import { formatPhoneDisplay } from '@/lib/field-formats';
import type { SmsChannel } from '@/lib/sms';
import type { PatientDoc, UserRole } from '@/lib/db-types';
import { Mail, MessageSquare, Plus, X } from '@/components/icons/lucide';

// Roles that can be the ordering/receiving provider for an intake request.
// The list is additionally gated by route access below: a provider is only
// assignable if their role can actually open /patient-intake to see the
// queue (otherwise requests would route to someone who can never act).
const PROVIDER_ROLES: UserRole[] = [
  'doctor',
  'clinical_officer',
  'medical_superintendent',
  'nutritionist',
  'radiologist',
];

/**
 * The intake packets a patient can be asked to complete, and the lines each one
 * actually collects.
 *
 * A request used to store the PACKET NAMES as its fields — a form came back
 * with one line reading "Basic Information", which matches no chart key, so
 * nothing sent from this page could ever be merged into a patient record. Only
 * the seeded demo forms, written with real field labels, worked. Expanding a
 * packet into its lines here is what puts a sent form on the same footing: the
 * labels are the ones MERGEABLE_FIELDS knows, so what the patient answers lands
 * in the chart column it belongs to.
 */
const INTAKE_PACKETS: Record<string, string[]> = {
  'Basic Information': ['Date of birth', 'Phone', 'Email', 'Address'],
  'Demographics': ['Primary Language', 'County', 'State', 'Tribe'],
  'Emergency Contact': ['Emergency contact'],
  'Financial Information': ['Payment method', 'Insurance provider'],
  'Additional Information': ['Known allergies', 'Reason for visit'],
  // Screening instruments are scored, not merged — they stay one line each and
  // are read during review rather than written to a chart column.
  'GAD-7': ['GAD-7 score'],
  'PHQ-9': ['PHQ-9 score'],
  'PCL-5': ['PCL-5 score'],
};

const INTAKE_FORM_OPTIONS = Object.keys(INTAKE_PACKETS);

/** The field lines a set of requested packets asks for, in order, deduped. */
function fieldsForPackets(packets: string[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const packet of packets) {
    for (const label of INTAKE_PACKETS[packet] || [packet]) {
      if (seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

// Matches the filter-control styling used across the intake modals.
const inputStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-light)',
  color: 'var(--text-primary)',
  borderRadius: 10,
  padding: '8px 10px',
  fontSize: 13,
  width: '100%',
};

/**
 * "Send Forms to Patient" — the create side of the intake workflow, as a
 * self-contained dialog so any surface (the intake queue's header button, a
 * dashboard's Intake Form pill) can open it in place instead of routing to
 * /patient-intake first. Render it conditionally; state resets on unmount.
 */
export default function SendIntakeFormsModal({ onClose }: { onClose: () => void }) {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { sendRequest } = useIntakeForms();
  const { patients } = usePatients();
  const { users } = useUsers();

  const [sendProviderId, setSendProviderId] = useState('');
  const [sendPatient, setSendPatient] = useState<PatientDoc | null>(null);
  const [sendPatientQuery, setSendPatientQuery] = useState('');
  const [sendForms, setSendForms] = useState<string[]>([]);
  const [sendEmail, setSendEmail] = useState(false);
  const [sendSms, setSendSms] = useState(false);
  /**
   * Which channel the text message goes out on. Defaults to WhatsApp when that
   * is the only number on file, otherwise SMS — reception should not have to
   * pick when there is nothing to pick between.
   */
  const [sendChannel, setSendChannel] = useState<SmsChannel>('sms');
  const [sending, setSending] = useState(false);

  const providerUsers = useMemo(
    () => users
      .filter(u => PROVIDER_ROLES.includes(u.role) && isRouteAllowed(u.role, '/patient-intake'))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  );

  // Patient typeahead: match name / hospital number / phone.
  const patientMatches = useMemo(() => {
    const q = sendPatientQuery.trim().toLowerCase();
    if (!q) return [];
    return patients
      .filter(p =>
        patientFullName(p).toLowerCase().includes(q) ||
        (p.hospitalNumber || '').toLowerCase().includes(q) ||
        (p.phone || '').toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [patients, sendPatientQuery]);

  const sendProviderUser = useMemo(
    () => providerUsers.find(u => u._id === sendProviderId),
    [providerUsers, sendProviderId],
  );

  function selectSendPatient(p: PatientDoc) {
    setSendPatient(p);
    setSendPatientQuery(patientFullName(p));
    setSendEmail(false);
    // Either number is reachable, so the message is on by default whenever
    // there is somewhere to send it.
    setSendSms(!!p.phone || !!p.whatsapp);
    // Default to whichever channel the patient actually has. When they have
    // both, SMS leads and the radio pair below lets reception switch — a clerk
    // should only be asked to choose when there is a choice.
    setSendChannel(!p.phone && p.whatsapp ? 'whatsapp' : 'sms');
  }

  // The number the chosen channel actually reaches. WhatsApp is its own field
  // on the chart, so this is not always the same digits as `phone`.
  const smsTarget = sendChannel === 'whatsapp'
    ? (sendPatient?.whatsapp || sendPatient?.phone)
    : (sendPatient?.phone || sendPatient?.whatsapp);

  async function handleSend() {
    if (!sendPatient || !sendProviderId || sendForms.length === 0) return;
    setSending(true);
    try {
      const willSendSms = sendSms && !!smsTarget;
      const willSendEmail = sendEmail && !!sendPatient.email;
      const result = await sendRequest(
        sendPatient._id,
        patientFullName(sendPatient),
        fieldsForPackets(sendForms).map(label => ({ label, value: '' })),
        {
          providerId: sendProviderUser?._id,
          providerName: sendProviderUser?.name,
          hospitalNumber: sendPatient.hospitalNumber,
          hospitalId: currentUser?.hospitalId,
          orgId: currentUser?.orgId,
        },
        {
          send: willSendSms,
          phone: smsTarget,
          channel: sendChannel,
          facilityName: currentUser?.hospitalName,
        },
        {
          send: willSendEmail,
          email: sendPatient.email,
          facilityName: currentUser?.hospitalName,
        },
      );

      // The request is saved either way; the toast reports per channel so the
      // clerk knows whether the patient was actually reached, and by what.
      const name = patientFullName(sendPatient);
      const delivered: string[] = [];
      const failed: string[] = [];
      const smsLabel = sendChannel === 'whatsapp' ? 'WhatsApp message' : 'SMS';
      if (willSendSms) (result.sms?.ok ? delivered : failed).push(smsLabel);
      if (willSendEmail) (result.email?.ok ? delivered : failed).push('email');

      if (failed.length > 0) {
        showToast(`Intake request saved, but the ${failed.join(' and ')} to ${name} failed to send.`, 'error');
      } else if (delivered.length > 0) {
        showToast(`Intake forms sent to ${name} by ${delivered.join(' and ')}.`, 'success');
      } else {
        showToast(`Intake forms sent to ${name}.`, 'success');
      }
      onClose();
    } catch {
      showToast('Could not send intake forms. Try again.', 'error');
    } finally {
      setSending(false);
    }
  }

  const canSend = !!sendPatient && !!sendProviderId && sendForms.length > 0;
  const availableFormOptions = INTAKE_FORM_OPTIONS.filter(o => !sendForms.includes(o));

  return (
    <Modal onClose={onClose} width={520}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Send Forms to Patient</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg"
            style={{ background: 'var(--overlay-subtle)' }}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {/* Provider */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-muted)' }}>Provider</label>
            <Select value={sendProviderId} onChange={e => setSendProviderId(e.target.value)} style={inputStyle}>
              <option value="">Select a provider</option>
              {providerUsers.map(u => <option key={u._id} value={u._id}>{u.name}</option>)}
            </Select>
          </div>

          {/* Patient typeahead */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-muted)' }}>Patient</label>
            <div className="relative">
              <input
                value={sendPatientQuery}
                onChange={e => { setSendPatientQuery(e.target.value); setSendPatient(null); }}
                placeholder="Search by name, hospital number, or phone"
                style={inputStyle}
              />
              {!sendPatient && patientMatches.length > 0 && (
                <div
                  className="absolute left-0 right-0 mt-1 rounded-lg overflow-hidden z-10 shadow-lg"
                  style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-light)', maxHeight: 240, overflowY: 'auto' }}
                >
                  {patientMatches.map(p => (
                    <button
                      key={p._id}
                      type="button"
                      onClick={() => selectSendPatient(p)}
                      className="w-full text-left px-3 py-2 text-[13px]"
                      style={{ color: 'var(--text-primary)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--overlay-subtle)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span className="font-semibold">{(p.surname || '').toUpperCase()}, {p.firstName}</span>
                      <span style={{ color: 'var(--text-muted)' }}> ({formatDate(p.dateOfBirth)} · {patientGenderAge(p)})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Patient intake packets */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-muted)' }}>Patient Intake</label>
            {sendForms.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {sendForms.map(f => (
                  <span
                    key={f}
                    className="inline-flex items-center gap-1 text-[12px] font-semibold rounded-full px-2.5 py-1"
                    style={{ background: 'var(--overlay-subtle)', color: 'var(--accent-primary)' }}
                  >
                    {f}
                    <button
                      type="button"
                      onClick={() => setSendForms(prev => prev.filter(x => x !== f))}
                      aria-label={`Remove ${f}`}
                      className="inline-flex"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <Plus className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
              <Select
                value=""
                onChange={e => { if (e.target.value) setSendForms(prev => [...prev, e.target.value]); }}
                disabled={availableFormOptions.length === 0}
                style={{ ...inputStyle, padding: '8px 10px 8px 30px' }}
              >
                <option value="">Add a form…</option>
                {availableFormOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </Select>
            </div>
          </div>

          {/* Delivery */}
          <div className="flex flex-col gap-2">
            <label
              className="inline-flex items-center gap-2 text-[13px]"
              style={{
                color: sendPatient?.email ? 'var(--text-primary)' : 'var(--text-muted)',
                cursor: sendPatient?.email ? 'pointer' : 'not-allowed',
              }}
              title={sendPatient?.email ? undefined : 'No email on file for this patient'}
            >
              <input
                type="checkbox"
                checked={sendEmail}
                disabled={!sendPatient?.email}
                onChange={e => setSendEmail(e.target.checked)}
              />
              <Mail className="w-3.5 h-3.5" />
              Email to {sendPatient?.email || 'no email on file'}
            </label>
            {/* One text message, on whichever channel the patient actually
                reads. Both are the same Twilio send, so this is a channel
                choice rather than a second delivery — and the WhatsApp
                number is its own field on the chart, because plenty of
                patients use WhatsApp on a different number from the one
                reception has for calls. */}
            <label
              className="inline-flex items-center gap-2 text-[13px]"
              style={{ color: smsTarget ? 'var(--text-primary)' : 'var(--text-muted)', cursor: smsTarget ? 'pointer' : 'not-allowed' }}
            >
              <input
                type="checkbox"
                checked={sendSms}
                disabled={!smsTarget}
                onChange={e => setSendSms(e.target.checked)}
              />
              <MessageSquare className="w-3.5 h-3.5" />
              Message {smsTarget ? formatPhoneDisplay(smsTarget) : 'no phone on file'}
            </label>
            {/* Only offered when there is a real choice to make. */}
            {sendSms && sendPatient?.phone && sendPatient?.whatsapp && (
              <div className="flex items-center gap-3 pl-6 text-[12px]">
                {(['sms', 'whatsapp'] as const).map(channel => (
                  <label key={channel} className="inline-flex items-center gap-1.5" style={{ cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="intake-sms-channel"
                      checked={sendChannel === channel}
                      onChange={() => setSendChannel(channel)}
                    />
                    {channel === 'sms' ? 'SMS' : 'WhatsApp'}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={onClose} className="btn btn-secondary flex-1">Cancel</button>
          <button onClick={handleSend} disabled={!canSend || sending} className="btn btn-primary flex-1">
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

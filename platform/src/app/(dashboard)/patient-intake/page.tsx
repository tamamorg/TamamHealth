'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/Modal';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { useIntakeForms } from '@/lib/hooks/useIntakeForms';
import { usePatients } from '@/lib/hooks/usePatients';
import { isRouteAllowed, getDefaultDashboard } from '@/lib/permissions';
import { formatPhoneDisplay } from '@/lib/field-formats';
import type {
  IntakeFormStatus,
  PatientDoc,
  PatientIntakeFormDoc,
} from '@/lib/db-types';
import { ClipboardPen, X } from '@/components/icons/lucide';
import EhrListHeader, { LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import SendIntakeFormsModal from '@/components/intake/SendIntakeFormsModal';

/**
 * The day the reception board should open on after a form is merged: the
 * patient's next booking that still expects them, today or later.
 *
 * The intake document holds no appointment reference — it is addressed to a
 * patient, not a slot — so the booking is resolved here at merge time. Returns
 * undefined when the patient has none, in which case the board keeps its own
 * default (today) rather than being sent to an arbitrary date.
 *
 * Local calendar day, not a UTC slice: the board's own `today` comes from
 * `toIsoDate(new Date())`, and comparing against a UTC date would disagree with
 * it for anyone working west of UTC in the evening.
 */
async function nextBookingDate(patientId: string): Promise<string | undefined> {
  try {
    const [{ getAppointmentsByPatient }, { APPOINTMENT_PENDING_STATUSES }, { toIsoDate }] = await Promise.all([
      import('@/lib/services/appointment-service'),
      import('@/lib/appointment-status'),
      import('@/components/ehr/EhrMiniCalendar'),
    ]);
    const today = toIsoDate(new Date());
    const upcoming = (await getAppointmentsByPatient(patientId))
      .filter(a => APPOINTMENT_PENDING_STATUSES.includes(a.status) && a.appointmentDate >= today)
      .sort((a, b) =>
        a.appointmentDate.localeCompare(b.appointmentDate)
        || (a.appointmentTime || '').localeCompare(b.appointmentTime || ''));
    return upcoming[0]?.appointmentDate;
  } catch {
    // Best-effort: a lookup failure must not cost the clerk the merge they
    // just completed. The board falls back to today.
    return undefined;
  }
}

const TABS: { key: IntakeFormStatus; label: string }[] = [
  { key: 'pending_review', label: 'Pending Review' },
  { key: 'not_submitted', label: 'Not Submitted by Patient' },
  { key: 'merged', label: 'Merged' },
];

// Labels the reviewer can confidently merge straight into the chart, mapped to
// the patient-chart key they write to. Multiple form labels can point at the
// same key (forms evolve / are authored by different people). Anything NOT in
// this map is shown for context during review but has no checkbox — it isn't
// structured enough to write back automatically.
const MERGEABLE_FIELDS: Record<string, keyof PatientDoc> = {
  'Date of birth': 'dateOfBirth',
  'Phone': 'phone',
  'Primary Phone': 'phone',
  'Phone Number': 'phone',
  'Email': 'email',
  'Address': 'address',
  'Language': 'primaryLanguage',
  'Primary Language': 'primaryLanguage',
  'County': 'county',
  'State': 'state',
  'Ethnicity': 'tribe',
  'Tribe': 'tribe',
  'Blood Type': 'bloodType',
  'Blood Group': 'bloodType',
};

/**
 * Did the patient actually answer this line? A skipped field comes back empty,
 * and a form still out with the patient carries the 'Requested' placeholder the
 * request was created with — neither is an answer, and neither may be written
 * over a chart value that is already there.
 */
function isAnswered(value?: string): boolean {
  const trimmed = (value || '').trim();
  return trimmed !== '' && trimmed.toLowerCase() !== 'requested';
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/**
 * The chart's value for a mergeable field, exactly as stored. Used to seed the
 * form — `currentChartValue` formats for reading (dd/mm/yyyy, spaced phone
 * numbers) and seeding with that would write the display text back to the
 * chart on merge.
 */
function rawChartValue(patient: PatientDoc | undefined, label: string): string {
  const key = patient ? MERGEABLE_FIELDS[label] : undefined;
  const raw = key ? patient?.[key] : undefined;
  return raw == null ? '' : String(raw);
}

/** Read the current chart value for a mergeable field, as a display string. */
function currentChartValue(patient: PatientDoc | undefined, label: string): string {
  if (!patient) return '';
  const key = MERGEABLE_FIELDS[label];
  if (!key) return '';
  const raw = patient[key];
  if (raw == null || raw === '') return '';
  if (key === 'dateOfBirth') return formatDate(String(raw));
  if (key === 'phone') return formatPhoneDisplay(String(raw));
  return String(raw);
}

// Shared inline styles so the two modals match the existing filter controls.
const inputStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-light)',
  color: 'var(--text-primary)',
  borderRadius: 10,
  padding: '8px 10px',
  fontSize: 13,
  width: '100%',
};

export default function PatientIntakePage() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { forms, loading, merge, reject, submitAnswers } = useIntakeForms();
  const { patients } = usePatients();

  const [activeTab, setActiveTab] = useState<IntakeFormStatus>('pending_review');
  const [patientQuery, setPatientQuery] = useState('');
  const [reviewing, setReviewing] = useState<PatientIntakeFormDoc | null>(null);
  const [merging, setMerging] = useState(false);
  // Which mergeable field labels the reviewer has selected to write to the chart.
  const [checkedFields, setCheckedFields] = useState<Record<string, boolean>>({});
  // --- Fill-in state: the form itself, answered at the desk or on a tablet ---
  const [filling, setFilling] = useState<PatientIntakeFormDoc | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [savingAnswers, setSavingAnswers] = useState(false);

  // The send dialog itself lives in SendIntakeFormsModal (shared with the
  // dashboards' Intake Form buttons); this page only opens and closes it.
  const [sendOpen, setSendOpen] = useState(false);

  const counts = useMemo(() => {
    const c: Record<IntakeFormStatus, number> = { pending_review: 0, not_submitted: 0, merged: 0, rejected: 0 };
    for (const f of forms) c[f.status]++;
    return c;
  }, [forms]);

  const filtered = useMemo(() => {
    const q = patientQuery.trim().toLowerCase();
    return forms
      .filter(f => f.status === activeTab)
      .filter(f => !q || f.patientName.toLowerCase().includes(q));
  }, [forms, activeTab, patientQuery]);

  function openReview(form: PatientIntakeFormDoc) {
    // Default every ANSWERED mergeable field to checked. A field the patient
    // left blank gets no checkbox at all: ticking it could only have written an
    // empty value over whatever the desk already had on the chart.
    const defaults: Record<string, boolean> = {};
    for (const field of form.fields) {
      if (MERGEABLE_FIELDS[field.label] && isAnswered(field.value)) defaults[field.label] = true;
    }
    setCheckedFields(defaults);
    setReviewing(form);
  }

  /**
   * Open the form itself. Answers already recorded are what you see and edit —
   * nothing is reset — and any line still unanswered starts from what the chart
   * already knows, so the patient is confirming their details rather than
   * dictating them again.
   */
  function openFill(form: PatientIntakeFormDoc) {
    const patient = form.patientId ? patients.find(p => p._id === form.patientId) : undefined;
    const seeded: Record<string, string> = {};
    for (const field of form.fields) {
      seeded[field.label] = isAnswered(field.value)
        ? field.value
        : rawChartValue(patient, field.label);
    }
    setAnswers(seeded);
    setFilling(form);
  }

  async function handleSaveAnswers() {
    if (!filling) return;
    setSavingAnswers(true);
    try {
      await submitAnswers(filling._id, answers, currentUser?.name || currentUser?.username);
      showToast(`${filling.patientName}'s form is ready for review.`, 'success');
      setFilling(null);
      setActiveTab('pending_review');
    } catch {
      showToast('Could not save the answers. Try again.', 'error');
    } finally {
      setSavingAnswers(false);
    }
  }

  async function handleMerge() {
    if (!reviewing) return;
    setMerging(true);
    try {
      const updates: Record<string, unknown> = {};
      for (const field of reviewing.fields) {
        const key = MERGEABLE_FIELDS[field.label];
        // Answered-only: the merge adds to the chart, it never clears it.
        if (key && checkedFields[field.label] && isAnswered(field.value)) {
          updates[key] = field.value.trim();
        }
      }
      const patientName = reviewing.patientName;
      const patientId = reviewing.patientId;
      await merge(reviewing._id, updates, currentUser?.name || currentUser?.username || 'Staff');
      showToast(`${patientName}'s form merged into their chart.`, 'success');
      setReviewing(null);

      // A merged form means the paperwork is done and the visit is next, so the
      // reviewer is handed straight to the board with this patient in front of
      // them.
      //
      // The board shows ONE day at a time and defaults to today, so the lane
      // and the search term are not enough on their own: an intake completed
      // ahead of a booking later in the week used to land the clerk on today's
      // Scheduled lane, filtered to a patient with nothing on it — a board that
      // looked empty and read as "the merge did nothing". Resolve the booking
      // the intake was for and open the board on ITS day.
      const boardDate = patientId ? await nextBookingDate(patientId) : undefined;
      const query = new URLSearchParams({ lane: 'scheduled', q: patientName });
      if (boardDate) query.set('date', boardDate);

      // Roles that cannot open reception's board still get a dashboard — their
      // own. Previously they were left sitting on the intake list with no
      // acknowledgement beyond the toast.
      if (currentUser && isRouteAllowed(currentUser.role, '/dashboard/front-desk')) {
        router.push(`/dashboard/front-desk?${query}`);
      } else if (currentUser) {
        router.push(getDefaultDashboard(currentUser.role));
      }
    } catch {
      showToast('Could not merge this form. Try again.', 'error');
    } finally {
      setMerging(false);
    }
  }

  async function handleReject() {
    if (!reviewing) return;
    setMerging(true);
    try {
      await reject(reviewing._id, currentUser?.name || currentUser?.username || 'Staff');
      showToast('Form rejected', 'success');
      setReviewing(null);
    } catch {
      showToast('Could not reject this form. Try again.', 'error');
    } finally {
      setMerging(false);
    }
  }

  const reviewPatient = useMemo(
    () => (reviewing ? patients.find(p => p._id === reviewing.patientId) : undefined),
    [patients, reviewing],
  );

  return (
    <>
      <main className="page-container page-enter">
        <div className="flex gap-5 items-start">
          {/* Status tabs */}
          <aside className="card-elevated p-2 flex-shrink-0" style={{ width: 220 }}>
            {TABS.map(tab => {
              const active = tab.key === activeTab;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className="w-full flex items-center justify-between gap-2 text-left text-[13px] font-medium rounded-lg px-3 py-2.5 mb-1"
                  style={active
                    ? { background: 'var(--overlay-subtle)', color: 'var(--accent-primary)' }
                    : { color: 'var(--text-secondary)' }}
                >
                  <span>{tab.label}</span>
                  {counts[tab.key] > 0 && (
                    <span
                      className="text-[11px] font-semibold rounded-full min-w-[20px] text-center px-1.5 py-0.5"
                      style={active
                        ? { background: 'var(--color-warning-600)', color: '#fff' }
                        : { background: 'var(--overlay-subtle)', color: 'var(--text-muted)' }}
                    >
                      {counts[tab.key]}
                    </span>
                  )}
                </button>
              );
            })}
          </aside>

          {/* Table + filters */}
          <div className="flex-1 min-w-0 card-elevated overflow-hidden flex flex-col">
            <EhrListHeader
              title="Patient Intake"
              stats={[
                { label: 'Sent', value: forms.length, color: LIST_STAT_COLORS.muted },
                { label: 'Pending review', value: counts.pending_review, color: LIST_STAT_COLORS.blue },
                { label: 'Not submitted', value: counts.not_submitted, color: LIST_STAT_COLORS.amber },
                { label: 'Merged', value: counts.merged, color: LIST_STAT_COLORS.green },
              ]}
              search={{ value: patientQuery, onChange: setPatientQuery, placeholder: 'Patient', ariaLabel: 'Search by patient' }}
              actions={
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ background: 'var(--color-warning-600)', borderColor: 'var(--color-warning-600)', color: '#fff' }}
                  onClick={() => setSendOpen(true)}
                >
                  Send Forms
                </button>
              }
            />

            <div className="ehr-list-scroll">
              {loading ? (
                <p className="text-[13px] py-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</p>
              ) : filtered.length === 0 ? (
                <p className="text-[13px] py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                  No forms in this view.
                </p>
              ) : (
                <table className="data-table" style={{ width: '100%', tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: '18%' }} />
                    <col style={{ width: '30%' }} />
                    <col style={{ width: '30%' }} />
                    <col style={{ width: '22%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Received</th>
                      <th>Patient</th>
                      <th>Care team</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(form => (
                      <tr key={form._id}>
                        <td>{formatDate(form.receivedAt || form.requestedAt)}</td>
                        <td>
                          <span className="inline-flex items-center gap-2">
                            <ClipboardPen className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                            {form.patientName}
                          </span>
                        </td>
                        <td>
                          <div className="appointment-card-provider">
                            <strong>{form.providerName || 'Clinician unassigned'}</strong>
                            <span>Review clinician</span>
                          </div>
                        </td>
                        <td className="text-right">
                          {form.status === 'pending_review' ? (
                            <span className="inline-flex gap-2">
                              {/* Answers stay editable right up to the merge —
                                  a wrong phone number is corrected here, not by
                                  sending the patient a second form. */}
                              <button type="button" className="btn btn-sm btn-secondary" onClick={() => openFill(form)}>
                                Edit Answers
                              </button>
                              <button type="button" className="btn btn-sm btn-secondary" onClick={() => openReview(form)}>
                                Review
                              </button>
                            </span>
                          ) : form.status === 'merged' ? (
                            <span className="text-[12px]" style={{ color: 'var(--color-success)' }}>Merged {formatDate(form.mergedAt)}</span>
                          ) : form.status === 'not_submitted' ? (
                            // The step that closes the loop: a form waiting on
                            // the patient can be answered at the desk or handed
                            // over on a tablet, which puts it in the review
                            // queue. Without this a sent request could never
                            // reach review at all.
                            <button type="button" className="btn btn-sm btn-secondary" onClick={() => openFill(form)}>
                              Fill in Form
                            </button>
                          ) : (
                            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Rejected</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* ---------------------------------------------------------------- */}
      {/* Send forms to patient                                            */}
      {/* ---------------------------------------------------------------- */}
      {sendOpen && <SendIntakeFormsModal onClose={() => setSendOpen(false)} />}

      {/* ---------------------------------------------------------------- */}
      {/* Fill in the form (desk or tablet)                                 */}
      {/* ---------------------------------------------------------------- */}
      {filling && (
        <Modal onClose={() => setFilling(null)} width={560}>
          <div className="modal-panel" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{filling.patientName}</h3>
              <button onClick={() => setFilling(null)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }} aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
              {filling.status === 'pending_review'
                ? 'Correct any answer before it is reviewed. Nothing already recorded is cleared by saving.'
                : 'Record the answers with the patient. Details already on their chart are filled in to confirm, not retype.'}
            </p>

            <div className="flex flex-col gap-3 mb-5">
              {filling.fields.map(field => (
                <label key={field.label} className="flex flex-col gap-1" style={{ textTransform: 'none', letterSpacing: 0 }}>
                  <span className="text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{field.label}</span>
                  <input
                    type="text"
                    style={inputStyle}
                    value={answers[field.label] ?? ''}
                    placeholder={`${field.label}…`}
                    onChange={e => setAnswers(prev => ({ ...prev, [field.label]: e.target.value }))}
                  />
                </label>
              ))}
            </div>

            <div className="flex gap-2">
              <button onClick={() => setFilling(null)} className="btn btn-secondary">Cancel</button>
              <button onClick={handleSaveAnswers} className="btn btn-primary" disabled={savingAnswers}>
                {savingAnswers ? 'Saving…' : filling.status === 'pending_review' ? 'Save Answers' : 'Submit for Review'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Review & merge (side-by-side compare)                            */}
      {/* ---------------------------------------------------------------- */}
      {reviewing && (
        <Modal onClose={() => setReviewing(null)} width={720}>
          <div className="modal-panel" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{reviewing.patientName}</h3>
              <button onClick={() => setReviewing(null)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }} aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
              Compare conflicting data, select relevant data, and merge into a single view.
            </p>

            <div className="grid grid-cols-2 gap-4 mb-5">
              {/* Left: incoming intake data */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                  Information from intake forms
                </p>
                <div className="flex flex-col gap-2.5">
                  {reviewing.fields.map(field => {
                    const answered = isAnswered(field.value);
                    // Only an answered mergeable field can be written. An
                    // unanswered one keeps its row — the reviewer should see
                    // what the patient skipped — but offers no tick, since the
                    // only thing it could write is a blank over existing data.
                    const mergeable = !!MERGEABLE_FIELDS[field.label] && answered;
                    return (
                      <div key={field.label} className="flex items-start gap-2">
                        {mergeable ? (
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            aria-label={`Merge ${field.label} into the chart`}
                            checked={!!checkedFields[field.label]}
                            onChange={e => setCheckedFields(prev => ({ ...prev, [field.label]: e.target.checked }))}
                          />
                        ) : (
                          <span className="w-[13px] flex-shrink-0" />
                        )}
                        <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                          {field.label}:{' '}
                          {answered
                            ? <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{field.value}</span>
                            : <span style={{ color: 'var(--text-muted)' }}>Not answered — chart value kept</span>}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right: current chart data */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                  Information from patient&apos;s chart
                </p>
                <div className="flex flex-col gap-2.5">
                  {reviewing.fields.map(field => {
                    const current = currentChartValue(reviewPatient, field.label);
                    return (
                      <p key={field.label} className="text-[13px]" style={{ color: 'var(--text-primary)', minHeight: 18 }}>
                        {MERGEABLE_FIELDS[field.label]
                          ? <>{field.label}: {current || <span style={{ color: 'var(--text-muted)' }}>—</span>}</>
                          : <span style={{ color: 'var(--text-muted)' }}>&nbsp;</span>}
                      </p>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setReviewing(null)} className="btn btn-secondary">Cancel</button>
              <button onClick={handleReject} disabled={merging} className="btn btn-secondary" style={{ color: 'var(--color-danger)' }}>
                Reject All
              </button>
              <button onClick={handleMerge} disabled={merging} className="btn btn-primary flex-1">
                {merging ? 'Merging…' : 'Merge Into Chart'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

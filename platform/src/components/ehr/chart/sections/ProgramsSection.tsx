'use client';

/**
 * Programs tab content — care-program enrollments (ART/TB/PMTCT/ANC/Nutrition/
 * EPI/NCD) backed by ProgramEnrollmentDoc + program-service + usePrograms,
 * mirroring the ConditionsSection read+add pattern. Distinct from
 * `payorInfo.programEnrollment`, which is an unrelated insurance/NGO-coverage
 * string captured at registration.
 */

import { useState } from 'react';
import ChartSection, { OmrsEmptyState } from '../ChartSection';
import Modal from '@/components/Modal';
import { X } from '@/components/icons/lucide';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { usePrograms } from '@/lib/hooks/usePrograms';
import { formatDate } from '@/lib/format-utils';
import type { ProgramKey, ProgramEnrollmentStatus } from '@/lib/db-types';
import Select from '@/components/Select';
import RowActionsMenu from '@/components/RowActionsMenu';
import { todayIso } from '@/lib/date-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { describeError } from '@/lib/user-facing-error';
import { statusWord } from '@/lib/i18n/status-word';

const PROGRAM_LABELS: Record<ProgramKey, string> = {
  art_hiv_care: 'ART / HIV care',
  tb_ds: 'TB (drug-susceptible)',
  tb_dr: 'TB (drug-resistant)',
  pmtct: 'PMTCT',
  anc: 'Antenatal care (ANC)',
  nutrition_otp: 'Nutrition — OTP (severe acute malnutrition)',
  nutrition_sfp: 'Nutrition — SFP (moderate acute malnutrition)',
  epi_immunization: 'EPI / Immunization',
  ncd_hypertension_diabetes: 'NCD clinic (hypertension / diabetes)',
  other: 'Other…',
};

const STATUS_LABELS: Record<ProgramEnrollmentStatus, string> = {
  active: 'Active',
  completed: 'Completed',
  transferred_out: 'Transferred out',
  lost_to_follow_up: 'Lost to follow-up',
  discontinued: 'Discontinued',
};

const STATUS_BADGE: Record<ProgramEnrollmentStatus, string> = {
  active: 'tamam-panel-badge tamam-panel-badge--active',
  completed: 'tamam-panel-badge tamam-panel-badge--done',
  transferred_out: 'tamam-panel-badge tamam-panel-badge--muted',
  lost_to_follow_up: 'tamam-panel-badge tamam-panel-badge--muted',
  discontinued: 'tamam-panel-badge tamam-panel-badge--muted',
};

interface ProgramsSectionProps {
  patientId: string;
  patientName: string;
  /** Clinicians and nursing roles (`canEnrollPrograms`). */
  canEnroll: boolean;
}

export default function ProgramsSection({ patientId, patientName, canEnroll }: ProgramsSectionProps) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { enrollments, create, setStatus } = usePrograms(patientId);

  const [adding, setAdding] = useState(false);
  const [programKey, setProgramKey] = useState<ProgramKey>('art_hiv_care');
  const [otherName, setOtherName] = useState('');
  const [enrollmentDate, setEnrollmentDate] = useState(() => todayIso());
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const visibleEnrollments = enrollments.filter(entry => `${entry.programName} ${entry.status} ${entry.notes || ''} ${entry.enrollmentDate}`.toLowerCase().includes(search.trim().toLowerCase()));

  const resetForm = () => {
    setProgramKey('art_hiv_care');
    setOtherName('');
    setEnrollmentDate(todayIso());
    setNotes('');
    setAdding(false);
  };

  const handleSubmit = async () => {
    const programName = programKey === 'other' ? otherName.trim() : PROGRAM_LABELS[programKey];
    if (!programName) { showToast(t('msg.enterTheProgramName'), 'error'); return; }
    if (!enrollmentDate) { showToast(t('msg.selectTheEnrollmentDate'), 'error'); return; }
    // One active enrolment per programme: a second would split the follow-up.
    if (enrollments.some(e => e.status === 'active' && e.programName.trim().toLowerCase() === programName.toLowerCase())) {
      showToast(t('msg.alreadyEnrolledInProgram', { name: programName }), 'warning');
      return;
    }
    try {
      setSubmitting(true);
      await create({
        patientId,
        patientName,
        programKey,
        programName,
        status: 'active',
        enrollmentDate,
        notes: notes.trim() || undefined,
        recordedBy: currentUser?._id || currentUser?.username,
        recordedByName: currentUser?.name,
        hospitalId: currentUser?.hospitalId,
        hospitalName: currentUser?.hospitalName,
        orgId: currentUser?.orgId,
      });
      showToast(t('msg.programEnrollmentRecorded'), 'success');
      resetForm();
    } catch (err) {
      console.error(err);
      showToast(describeError(err, t('msg.enrollmentNotRecordedTryAgain')), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (id: string, next: ProgramEnrollmentStatus) => {
    setStatusBusy(id);
    try {
      if (!(await setStatus(id, next))) throw new Error('Change not saved. Try again.');
      showToast(t('msg.enrollmentMarked', { status: statusWord(t, next) }), 'success');
    } catch (err) {
      console.error(err);
      showToast(describeError(err, t('msg.enrollmentStatusNotChangedTry')), 'error');
    } finally {
      setStatusBusy(null);
    }
  };

  return (
    <>
      <ChartSection title="Programs" addLabel="Add" onAdd={canEnroll ? () => setAdding(true) : undefined} searchValue={search} onSearchChange={setSearch}>
        <table className="tamam-table tamam-table--fixed">
            <colgroup><col /><col /><col /><col /></colgroup>
            <thead>
              <tr>
                <th>Program</th>
                <th>Enrolled</th>
                <th>Status</th>
                <th>{t('chart.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {enrollments.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ cursor: 'default', background: 'transparent' }}>
                    <OmrsEmptyState
                      itemLabel="program enrollments"
                      actionLabel="Record program enrollment"
                      onAction={canEnroll ? () => setAdding(true) : undefined}
                      disabledReason={canEnroll ? undefined : 'Requires clinical permission'}
                    />
                  </td>
                </tr>
              )}
              {visibleEnrollments.map(e => (
                <tr key={e._id}>
                  <td style={{ fontWeight: 600 }}>
                    {e.programName}
                    {e.notes ? <div style={{ color: 'var(--ehr-muted, #5D728B)', fontWeight: 400, fontSize: 12 }}>{e.notes}</div> : null}
                  </td>
                  <td>
                    {formatDate(e.enrollmentDate)}
                    {e.outcomeDate ? <div style={{ color: 'var(--ehr-muted, #5D728B)', fontSize: 12 }}>ended {formatDate(e.outcomeDate)}</div> : null}
                  </td>
                  <td><span className={STATUS_BADGE[e.status]}>{STATUS_LABELS[e.status]}</span></td>
                  <td>
                    <RowActionsMenu
                      ariaLabel={t('chart.programRowActions', { name: e.programName })}
                      actions={canEnroll ? (Object.keys(STATUS_LABELS) as ProgramEnrollmentStatus[])
                        .filter(status => status !== e.status)
                        .map(status => ({
                          key: `status-${status}`,
                          label: t('chart.markStatus', { status: STATUS_LABELS[status] }),
                          disabled: statusBusy === e._id,
                          onClick: () => void handleStatusChange(e._id, status),
                        })) : []}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
      </ChartSection>

      {adding && (
        <Modal variant="slider" className="tamam-dialog" onClose={() => !submitting && resetForm()} width={480} labelledBy="add-program-title">
          <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center justify-between">
              <h2 id="add-program-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Enroll in program</h2>
              <button className="p-1 rounded" onClick={() => !submitting && resetForm()} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Program</label>
              <Select
                value={programKey}
                onChange={e => setProgramKey(e.target.value as ProgramKey)}
                className="w-full p-2.5 rounded-md text-[13px]"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
              >
                {(Object.keys(PROGRAM_LABELS) as ProgramKey[]).map(k => (
                  <option key={k} value={k}>{PROGRAM_LABELS[k]}</option>
                ))}
              </Select>
            </div>
            {programKey === 'other' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Program name</label>
                <input
                  type="text"
                  value={otherName}
                  onChange={e => setOtherName(e.target.value)}
                  placeholder="e.g. Mental health outreach"
                  className="w-full p-2.5 rounded-md text-[13px]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Enrollment date</label>
              <input
                type="date"
                value={enrollmentDate}
                onChange={e => setEnrollmentDate(e.target.value)}
                className="w-full p-2.5 rounded-md text-[13px]"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Notes (optional)</label>
              <textarea
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full p-2.5 rounded-md text-[13px]"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', resize: 'vertical' }}
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button className="btn btn-sm btn-secondary" disabled={submitting} onClick={resetForm}>Cancel</button>
              <button
                className="btn btn-sm btn-primary"
                disabled={submitting || (programKey === 'other' && !otherName.trim())}
                onClick={handleSubmit}
              >
                {submitting ? 'Saving…' : 'Enroll'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

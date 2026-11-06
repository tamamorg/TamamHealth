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
import FormSlider from '@/components/overlay/FormSlider';
import FormField from '@/components/overlay/FormField';
import { useToast } from '@/components/Toast';
import { useConfirmPrompt } from '@/components/ConfirmDialog';
import { useAuth } from '@/lib/context';
import { usePrograms } from '@/lib/hooks/usePrograms';
import { formatDate } from '@/lib/format-utils';
import type { ProgramKey, ProgramEnrollmentStatus, ProgramEnrollmentDoc } from '@/lib/db-types';
import Select from '@/components/Select';
import RowActionsMenu from '@/components/RowActionsMenu';
import { todayIso } from '@/lib/date-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { describeError } from '@/lib/user-facing-error';
import { statusWord } from '@/lib/i18n/status-word';

/** The stored programme name (English, as reported); the screen shows
 *  `chartPrograms.program.<key>`. */
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

/** Every status, in the order the row menu offers them. */
const STATUSES: ProgramEnrollmentStatus[] = ['active', 'completed', 'transferred_out', 'lost_to_follow_up', 'discontinued'];

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
  const { enrollments, create, setStatus, update, remove } = usePrograms(patientId);
  const confirmPrompt = useConfirmPrompt();
  const [editingEnrollment, setEditingEnrollment] = useState<ProgramEnrollmentDoc | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editNotes, setEditNotes] = useState('');

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

  const openEdit = (e: ProgramEnrollmentDoc) => {
    setEditingEnrollment(e);
    setEditDate(e.enrollmentDate);
    setEditNotes(e.notes || '');
  };

  const handleEditSave = async () => {
    if (!editingEnrollment) return;
    if (!editDate) { showToast(t('msg.selectTheEnrollmentDate'), 'error'); return; }
    try {
      setSubmitting(true);
      const saved = await update(editingEnrollment._id, { enrollmentDate: editDate, notes: editNotes.trim() || undefined });
      if (!saved) throw new Error('Enrollment not saved. Try again.');
      showToast(t('msg.programEnrollmentUpdated'), 'success');
      setEditingEnrollment(null);
    } catch (err) {
      console.error(err);
      showToast(describeError(err, t('msg.enrollmentNotUpdatedTryAgain')), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (e: ProgramEnrollmentDoc) => {
    const reason = await confirmPrompt({
      title: t('chartPrograms.removeTitle'),
      message: t('chartPrograms.removeMessage', { name: e.programName }),
      inputLabel: t('chartPrograms.removeReason'),
      inputRequired: true,
      confirmLabel: t('action.remove'),
      tone: 'danger',
    });
    if (!reason?.trim()) return;
    setStatusBusy(e._id);
    try {
      if (!(await remove(e._id, reason))) throw new Error('Enrollment not removed. Try again.');
      showToast(t('msg.programEnrollmentRemoved'), 'success');
    } catch (err) {
      console.error(err);
      showToast(describeError(err, t('msg.enrollmentNotRemovedTryAgain')), 'error');
    } finally {
      setStatusBusy(null);
    }
  };

  return (
    <>
      <ChartSection title={t('chartPrograms.title')} addLabel={t('chartPrograms.add')} onAdd={canEnroll ? () => setAdding(true) : undefined} searchValue={search} onSearchChange={setSearch}>
        <table className="tamam-table tamam-table--fixed">
            <colgroup><col /><col /><col /><col /></colgroup>
            <thead>
              <tr>
                <th>{t('chartPrograms.colProgram')}</th>
                <th>{t('chartPrograms.colEnrolled')}</th>
                <th>{t('chartPrograms.colStatus')}</th>
                <th>{t('chart.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {enrollments.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ cursor: 'default', background: 'transparent' }}>
                    <OmrsEmptyState
                      itemLabel={t('chartPrograms.emptyItems')}
                      actionLabel={t('chartPrograms.emptyAction')}
                      onAction={canEnroll ? () => setAdding(true) : undefined}
                      disabledReason={canEnroll ? undefined : t('chartPrograms.needsPermission')}
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
                    {e.outcomeDate ? <div style={{ color: 'var(--ehr-muted, #5D728B)', fontSize: 12 }}>{t('chartPrograms.ended', { date: formatDate(e.outcomeDate) })}</div> : null}
                  </td>
                  <td><span className={STATUS_BADGE[e.status]}>{t(`chartPrograms.status.${e.status}`)}</span></td>
                  <td>
                    <RowActionsMenu
                      ariaLabel={t('chart.programRowActions', { name: e.programName })}
                      actions={canEnroll ? [
                        { key: 'edit', label: t('action.edit'), disabled: statusBusy === e._id, onClick: () => openEdit(e) },
                        ...STATUSES
                          .filter(status => status !== e.status)
                          .map(status => ({
                            key: `status-${status}`,
                            label: t('chart.markStatus', { status: t(`chartPrograms.status.${status}`) }),
                            disabled: statusBusy === e._id,
                            onClick: () => void handleStatusChange(e._id, status),
                          })),
                        ...(e.status !== 'discontinued' ? [{
                          key: 'remove',
                          label: t('action.remove'),
                          tone: 'danger' as const,
                          disabled: statusBusy === e._id,
                          onClick: () => void handleRemove(e),
                        }] : []),
                      ] : []}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
      </ChartSection>

      {editingEnrollment && (
        <FormSlider
          title={t('chartPrograms.editTitle', { name: editingEnrollment.programName })}
          className="tamam-dialog"
          onClose={() => setEditingEnrollment(null)}
          busy={submitting}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={submitting} onClick={() => setEditingEnrollment(null)}>{t('action.cancel')}</button>
            <button type="button" className="btn btn-primary" disabled={submitting} onClick={handleEditSave}>
              {submitting ? t('common.saving') : t('action.save')}
            </button>
          </>}
        >
          <div className="space-y-4">
            <FormField label={t('chartPrograms.fieldDate')}>
              {control => <input {...control} type="date" value={editDate} onChange={e => setEditDate(e.target.value)} />}
            </FormField>
            <FormField label={t('chartPrograms.fieldNotes')} optional>
              {control => <textarea {...control} rows={2} value={editNotes} onChange={e => setEditNotes(e.target.value)} />}
            </FormField>
          </div>
        </FormSlider>
      )}

      {adding && (
        <FormSlider
          title={t('chartPrograms.enrollTitle')}
          className="tamam-dialog"
          onClose={resetForm}
          busy={submitting}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={submitting} onClick={resetForm}>{t('action.cancel')}</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={submitting || (programKey === 'other' && !otherName.trim())}
              onClick={handleSubmit}
            >
              {submitting ? t('common.saving') : t('chartPrograms.enroll')}
            </button>
          </>}
        >
          <div className="space-y-4">
            <FormField label={t('chartPrograms.fieldProgram')}>
              {control => (
                <Select {...control} value={programKey} onChange={e => setProgramKey(e.target.value as ProgramKey)}>
                  {(Object.keys(PROGRAM_LABELS) as ProgramKey[]).map(k => (
                    <option key={k} value={k}>{t(`chartPrograms.program.${k}`)}</option>
                  ))}
                </Select>
              )}
            </FormField>
            {programKey === 'other' && (
              <FormField label={t('chartPrograms.fieldProgramName')} required>
                {control => (
                  <input {...control} type="text" value={otherName} onChange={e => setOtherName(e.target.value)} placeholder={t('chartPrograms.programNamePlaceholder')} />
                )}
              </FormField>
            )}
            <FormField label={t('chartPrograms.fieldDate')}>
              {control => <input {...control} type="date" value={enrollmentDate} onChange={e => setEnrollmentDate(e.target.value)} />}
            </FormField>
            <FormField label={t('chartPrograms.fieldNotes')} optional>
              {control => <textarea {...control} rows={2} value={notes} onChange={e => setNotes(e.target.value)} />}
            </FormField>
          </div>
        </FormSlider>
      )}
    </>
  );
}

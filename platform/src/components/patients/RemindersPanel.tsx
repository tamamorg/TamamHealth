'use client';

/**
 * Patient reminders — queue a message to reach the patient on a future date
 * (e.g. "Come fasted in 3 weeks for path tests"). The HealthBridge scheduled-SMS
 * idea, built honestly as a queue staff work from: there is no SMS gateway, so
 * reminders are marked sent manually (a real gateway can dispatch queued rows).
 */
import { useState } from 'react';
import { useAuth } from '@/lib/context';
import type { PatientDoc, ReminderChannel } from '@/lib/db-types';
import { usePatientReminders } from '@/lib/hooks/usePatientReminders';
import { patientFullName } from '@/lib/patient-utils';
import ChartSection, { OmrsEmptyState } from '@/components/ehr/chart/ChartSection';
import Select from '@/components/Select';
import { todayIso } from '@/lib/date-utils';
import { describeError } from '@/lib/user-facing-error';
import { useTranslation } from '@/lib/i18n/useTranslation';
import RowActionsMenu, { type RowAction } from '@/components/RowActionsMenu';
import { canReopenReminder } from '@/lib/reminder-rules';
import type { PatientReminderDoc } from '@/lib/db-types';
import { useToast } from '@/components/Toast';
import { FormError } from '@/components/overlay/FormNotices';
import FormField from '@/components/overlay/FormField';
import FormSlider from '@/components/overlay/FormSlider';

const CHANNELS: { v: ReminderChannel; label: string }[] = [
  { v: 'sms', label: 'SMS' },
  { v: 'whatsapp', label: 'WhatsApp' },
  { v: 'call', label: 'Call' },
  { v: 'in_person', label: 'In person' },
];

function todayISO(): string {
  return todayIso();
}

export default function RemindersPanel({ patient }: { patient: PatientDoc }) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { reminders, queued, queue, markSent, cancel, edit, reopen } = usePatientReminders(patient._id);
  const { showToast } = useToast();
  const [adding, setAdding] = useState(false);
  // Set while the slider edits a queued reminder rather than adding one.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ message: string; sendDate: string; channel: ReminderChannel }>(
    { message: '', sendDate: todayISO(), channel: 'sms' },
  );

  const today = todayISO();
  const closeForm = () => { setAdding(false); setEditingId(null); setError(null); setForm({ message: '', sendDate: todayISO(), channel: 'sms' }); };
  const openEdit = (r: PatientReminderDoc) => {
    setEditingId(r._id);
    setForm({ message: /[\p{L}\p{N}]/u.test(r.message || '') ? r.message : '', sendDate: r.sendDate, channel: r.channel });
    setAdding(true);
  };
  const openAgain = (r: PatientReminderDoc) => {
    setEditingId(null);
    setForm({ message: /[\p{L}\p{N}]/u.test(r.message || '') ? r.message : '', sendDate: todayISO(), channel: r.channel });
    setAdding(true);
  };
  // One write per row action; a failure says so instead of failing silently.
  const act = async (work: () => Promise<void>, done: string) => {
    try {
      await work();
      showToast(done, 'success');
    } catch (e) {
      showToast(describeError(e, t('taskList.notSaved')), 'error');
    }
  };
  const actionsFor = (r: PatientReminderDoc): RowAction[] => r.status === 'queued' || r.status === 'failed'
    ? [
        { key: 'edit', label: t('taskList.edit'), onClick: () => openEdit(r) },
        { key: 'sent', label: t('ui.markSent'), onClick: () => void act(() => markSent(r._id), t('reminders.markedSent')) },
        { key: 'cancel', label: t('ui.cancelReminder'), tone: 'danger', onClick: () => void act(() => cancel(r._id), t('reminders.cancelled')) },
      ]
    : [
        ...(canReopenReminder(r) ? [{ key: 'undo', label: t('taskList.undo'), onClick: () => void act(() => reopen(r._id), t('reminders.reopened')) }] : []),
        { key: 'again', label: t('taskList.addAgain'), onClick: () => openAgain(r) },
      ];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editingId) {
        const saved = await edit(editingId, { message: form.message.trim(), sendDate: form.sendDate, channel: form.channel },
          { id: currentUser?._id, name: currentUser?.name || currentUser?.username });
        if (!saved) throw new Error('Reminder not found. Refresh and try again.');
        closeForm();
        return;
      }
      await queue({
        patientId: patient._id,
        patientName: patientFullName(patient),
        message: form.message.trim(),
        sendDate: form.sendDate,
        channel: form.channel,
        createdById: currentUser?._id,
        createdByName: currentUser?.name || currentUser?.username,
        hospitalId: currentUser?.hospitalId,
        orgId: currentUser?.orgId,
      });
      setForm({ message: '', sendDate: todayISO(), channel: 'sms' });
      setAdding(false);
    } catch (e) {
      setError(describeError(e, t('msg.reminderNotScheduledTryAgain')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ChartSection title={queued.length > 0 ? `Reminders (${queued.length} queued)` : 'Reminders'} addLabel="Add" onAdd={() => setAdding(true)}>
      <table className="tamam-table tamam-table--fixed">
          <colgroup>
            <col /><col /><col /><col /><col />
          </colgroup>
          <thead>
            <tr>
              <th>{t('lab.message')}</th>
              <th>{t('feedback.channel')}</th>
              <th>{t('ui.sendDate')}</th>
              <th>{t('billing.activityColumn.status')}</th>
              <th>{t('adminBilling.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {reminders.length === 0 && (
              <tr>
                <td colSpan={5} style={{ cursor: 'default', background: 'transparent' }}>
                  <OmrsEmptyState itemLabel="reminders" actionLabel={t('ui.queueReminder')} onAction={() => setAdding(true)} />
                </td>
              </tr>
            )}
            {reminders.map(r => {
              const overdue = r.status === 'queued' && r.sendDate < today;
              const muted = r.status !== 'queued';
              return (
                <tr key={r._id} style={muted ? { opacity: 0.6 } : undefined}>
                  <td className="tamam-cell-note">
                    {/[\p{L}\p{N}]/u.test(r.message || '')
                      ? <div className="tamam-cell-clamp" title={r.message}>{r.message}</div>
                      : <div className="tamam-cell-clamp" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('taskList.noDescription')}</div>}
                  </td>
                  <td>{CHANNELS.find(c => c.v === r.channel)?.label || r.channel}</td>
                  <td>{r.sendDate}</td>
                  <td>
                    <span className={overdue
                      ? 'tamam-panel-badge tamam-panel-badge--pending'
                      : r.status === 'queued'
                        ? 'tamam-panel-badge tamam-panel-badge--active'
                        : r.status === 'sent'
                          ? 'tamam-panel-badge tamam-panel-badge--done'
                          : 'tamam-panel-badge tamam-panel-badge--muted'}>
                      {overdue ? 'Overdue' : r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                    </span>
                  </td>
                  <td>
                    <RowActionsMenu ariaLabel={t('reminders.actions')} actions={actionsFor(r)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

      {error && !adding && <FormError message={error} />}

      {adding && (
        <FormSlider
          title={editingId ? t('reminders.editTitle') : t('reminders.addTitle')}
          subtitle={patientFullName(patient)}
          className="tamam-dialog"
          onClose={closeForm}
          busy={busy}
          footerNote={t('reminders.noGateway')}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={closeForm}>{t('action.cancel')}</button>
            <button type="button" className="btn btn-primary" disabled={busy || !form.message.trim()} onClick={submit}>{editingId ? t('taskList.saveChanges') : t('reminders.queue')}</button>
          </>}
        >
          <div className="space-y-4">
            <FormField label={t('reminders.message')} required>
              {control => <textarea {...control} rows={4} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder={t('reminders.messagePlaceholder')} />}
            </FormField>
            <FormField label={t('reminders.sendDate')}>
              {control => <input {...control} type="date" value={form.sendDate} min={editingId ? undefined : today} onChange={e => setForm({ ...form, sendDate: e.target.value })} />}
            </FormField>
            <FormField label={t('reminders.channel')}>
              {control => (
                <Select {...control} value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value as ReminderChannel })}>
                  {CHANNELS.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
                </Select>
              )}
            </FormField>
            {error && <FormError message={error} />}
          </div>
        </FormSlider>
      )}
    </ChartSection>
  );
}

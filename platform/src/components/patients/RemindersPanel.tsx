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
import RowActionsMenu from '@/components/RowActionsMenu';
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
  const { reminders, queued, queue, markSent, cancel } = usePatientReminders(patient._id);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ message: string; sendDate: string; channel: ReminderChannel }>(
    { message: '', sendDate: todayISO(), channel: 'sms' },
  );

  const today = todayISO();
  const closeForm = () => { setAdding(false); setError(null); };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
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
              <th>Message</th>
              <th>Channel</th>
              <th>Send date</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {reminders.length === 0 && (
              <tr>
                <td colSpan={5} style={{ cursor: 'default', background: 'transparent' }}>
                  <OmrsEmptyState itemLabel="reminders" actionLabel="Queue reminder" onAction={() => setAdding(true)} />
                </td>
              </tr>
            )}
            {reminders.map(r => {
              const overdue = r.status === 'queued' && r.sendDate < today;
              const muted = r.status !== 'queued';
              return (
                <tr key={r._id} style={muted ? { opacity: 0.6 } : undefined}>
                  <td className="tamam-cell-note"><div className="tamam-cell-clamp" title={r.message}>{r.message}</div></td>
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
                    <RowActionsMenu
                      ariaLabel="Reminder actions"
                      actions={r.status === 'queued' ? [
                        { key: 'sent', label: 'Mark sent', onClick: () => markSent(r._id) },
                        { key: 'cancel', label: 'Cancel reminder', tone: 'danger', onClick: () => cancel(r._id) },
                      ] : []}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

      {error && !adding && <FormError message={error} />}

      {adding && (
        <FormSlider
          title={t('reminders.addTitle')}
          subtitle={patientFullName(patient)}
          className="tamam-dialog"
          onClose={closeForm}
          busy={busy}
          footerNote={t('reminders.noGateway')}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={closeForm}>{t('action.cancel')}</button>
            <button type="button" className="btn btn-primary" disabled={busy || !form.message.trim()} onClick={submit}>{t('reminders.queue')}</button>
          </>}
        >
          <div className="space-y-4">
            <FormField label={t('reminders.message')} required>
              {control => <textarea {...control} rows={4} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder={t('reminders.messagePlaceholder')} />}
            </FormField>
            <FormField label={t('reminders.sendDate')}>
              {control => <input {...control} type="date" value={form.sendDate} min={today} onChange={e => setForm({ ...form, sendDate: e.target.value })} />}
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

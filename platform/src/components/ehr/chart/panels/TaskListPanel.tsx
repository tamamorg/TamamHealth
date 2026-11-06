'use client';

/**
 * Task list workspace panel — lists this patient's queued/sent reminders
 * (usePatientReminders, the same hook RemindersPanel/the 'recall' tab use)
 * as "tasks", with a lightweight inline form to queue a new one or change a
 * queued one. Each row carries its own ⋮ actions: a queued task can be
 * edited, marked done or cancelled; a closed one can be added again.
 */

import { useState } from 'react';
import { Plus, Calendar, ArrowRight } from '@/components/icons/lucide';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import RowActionsMenu, { type RowAction } from '@/components/RowActionsMenu';
import { usePatientReminders } from '@/lib/hooks/usePatientReminders';
import { canReopenReminder } from '@/lib/reminder-rules';
import { patientFullName } from '@/lib/patient-utils';
import type { PatientDoc, PatientReminderDoc } from '@/lib/db-types';
import type { ChartPanelUser } from './types';
import { toIsoDate, todayIso } from '@/lib/date-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { describeError } from '@/lib/user-facing-error';
import { formatDate } from '@/lib/format-utils';

interface TaskListPanelProps {
  patient: PatientDoc;
  currentUser: ChartPanelUser | null | undefined;
  onClose: () => void;
  onGoToRecall: () => void;
}

function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toIsoDate(d);
}

/** A task whose text has no letter or digit (a stray "," saved by mistake)
 *  reads as having no description rather than as punctuation. */
const hasWords = (text?: string) => /[\p{L}\p{N}]/u.test(text || '');

type TaskState = 'overdue' | 'queued' | 'sent' | 'cancelled' | 'failed';

function taskState(r: PatientReminderDoc, today: string): TaskState {
  if (r.status === 'queued' && r.sendDate < today) return 'overdue';
  return r.status;
}

const BADGE: Record<TaskState, string> = {
  overdue: 'tamam-panel-badge tamam-panel-badge--pending',
  queued: 'tamam-panel-badge tamam-panel-badge--active',
  sent: 'tamam-panel-badge tamam-panel-badge--done',
  cancelled: 'tamam-panel-badge tamam-panel-badge--muted',
  failed: 'tamam-panel-badge tamam-panel-badge--pending',
};

export default function TaskListPanel({ patient, currentUser, onClose, onGoToRecall }: TaskListPanelProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { reminders, loading, queue, markSent, cancel, edit, reopen } = usePatientReminders(patient._id);
  // null = no form; 'new' = adding; an id = changing that queued task.
  const [formFor, setFormFor] = useState<'new' | string | null>(null);
  const [message, setMessage] = useState('');
  const [sendDate, setSendDate] = useState(tomorrowISO());
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const today = todayIso();

  const openForm = (target: 'new' | string, text = '', date = tomorrowISO()) => {
    setFormFor(target);
    setMessage(text);
    setSendDate(date);
  };
  const closeForm = () => { setFormFor(null); setMessage(''); setSendDate(tomorrowISO()); };

  const handleSave = async () => {
    if (!message.trim() || !formFor) return;
    try {
      setSubmitting(true);
      if (formFor === 'new') {
        await queue({
          patientId: patient._id,
          patientName: patientFullName(patient),
          message: message.trim(),
          sendDate,
          createdById: currentUser?._id,
          createdByName: currentUser?.name,
          hospitalId: currentUser?.hospitalId,
          orgId: currentUser?.orgId,
        });
        showToast(t('msg.taskAdded'), 'success');
      } else {
        const saved = await edit(formFor, { message: message.trim(), sendDate }, { id: currentUser?._id, name: currentUser?.name });
        if (!saved) throw new Error('Task not found. Refresh and try again.');
        showToast(t('taskList.saved'), 'success');
      }
      closeForm();
    } catch (err) {
      console.error(err);
      showToast(describeError(err, formFor === 'new' ? t('msg.taskNotAddedTryAgain') : t('taskList.notSaved')), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const run = async (id: string, work: () => Promise<void>, done: string, failed: string) => {
    setBusyId(id);
    try {
      await work();
      showToast(done, 'success');
    } catch (err) {
      showToast(describeError(err, failed), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const cancelTask = async (r: PatientReminderDoc) => {
    const ok = await confirm({
      title: t('taskList.cancelTitle'),
      message: hasWords(r.message) ? r.message : undefined,
      confirmLabel: t('taskList.cancelTask'),
      cancelLabel: t('taskList.keepTask'),
      tone: 'danger',
    });
    if (!ok) return;
    await run(r._id, () => cancel(r._id), t('taskList.cancelled'), t('taskList.notSaved'));
  };

  const actionsFor = (r: PatientReminderDoc): RowAction[] => {
    const busy = busyId === r._id;
    if (r.status === 'queued') {
      return [
        { key: 'edit', label: t('taskList.edit'), disabled: busy, onClick: () => openForm(r._id, hasWords(r.message) ? r.message : '', r.sendDate) },
        { key: 'done', label: t('taskList.markDone'), disabled: busy, onClick: () => void run(r._id, () => markSent(r._id), t('taskList.done'), t('taskList.notSaved')) },
        { key: 'cancel', label: t('taskList.cancelTask'), tone: 'danger', disabled: busy, onClick: () => void cancelTask(r) },
      ];
    }
    // Undo puts a task marked done (or cancelled) back on the list, unless
    // the SMS gateway really sent it: then only Add again.
    return [
      ...(canReopenReminder(r) ? [{
        key: 'undo',
        label: t('taskList.undo'),
        disabled: busy,
        onClick: () => void run(r._id, () => reopen(r._id), t('taskList.reopened'), t('taskList.notSaved')),
      }] : []),
      { key: 'again', label: t('taskList.addAgain'), onClick: () => openForm('new', hasWords(r.message) ? r.message : '') },
    ];
  };

  const stateLabel = (s: TaskState) => t(`taskList.state.${s}`);

  const form = (
    <div className="tamam-task-form">
      <label className="tamam-panel-label" htmlFor="tamam-task-text">{t('ui.task')}</label>
      <textarea
        id="tamam-task-text"
        className="tamam-panel-textarea"
        placeholder={t('ui.eGCallPatientAbout')}
        value={message}
        onChange={e => setMessage(e.target.value)}
        autoFocus
      />
      <label className="tamam-panel-label" htmlFor="tamam-task-due">{t('screenings.colDue')}</label>
      <input
        id="tamam-task-due"
        type="date"
        className="tamam-panel-input"
        value={sendDate}
        min={formFor === 'new' ? today : undefined}
        onChange={e => setSendDate(e.target.value)}
      />
      <div className="tamam-task-form-actions">
        <button type="button" className="btn btn-secondary" onClick={closeForm} disabled={submitting}>
          {t('action.cancel')}
        </button>
        <button type="button" className="btn btn-primary" disabled={!message.trim() || submitting} onClick={handleSave}>
          {submitting ? t('taskList.saving') : formFor === 'new' ? t('ui.addTask') : t('taskList.saveChanges')}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className="tamam-drawer-body">
        <div className="tamam-panel-section-head" style={{ cursor: 'default' }}>
          <span className="tamam-panel-section-title">{t('taskList.heading', { count: reminders.length })}</span>
          {formFor === null && (
            <button type="button" className="tamam-panel-add-btn" onClick={() => openForm('new')}>
              <Plus aria-hidden /> {t('ui.addTask')}
            </button>
          )}
        </div>

        {formFor === 'new' && form}

        {!loading && reminders.length === 0 && formFor === null && (
          <p className="tamam-panel-empty">{t('ui.noTasksYet')}</p>
        )}

        {reminders.length > 0 && (
          <ul className="tamam-task-list">
            {reminders.map(r => {
              if (formFor === r._id) return <li key={r._id} className="tamam-task is-editing">{form}</li>;
              const state = taskState(r, today);
              const closed = r.status !== 'queued';
              return (
                <li key={r._id} className={`tamam-task${closed ? ' is-closed' : ''}`}>
                  <div className="tamam-task-body">
                    <p className={hasWords(r.message) ? 'tamam-task-text' : 'tamam-task-text is-empty'}>
                      {hasWords(r.message) ? r.message : t('taskList.noDescription')}
                    </p>
                    <p className={`tamam-task-due${state === 'overdue' ? ' is-overdue' : ''}`}>
                      <Calendar aria-hidden />
                      <span>{t('taskList.due', { date: formatDate(r.sendDate) })}</span>
                    </p>
                  </div>
                  <span className={BADGE[state]}>{stateLabel(state)}</span>
                  <RowActionsMenu ariaLabel={t('taskList.actions')} actions={actionsFor(r)} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {/* The O3 action bar: two halves, as Cancel | Save. */}
      <div className="sv-footer">
        <button type="button" className="sv-footer-btn sv-footer-btn--discard" onClick={onClose}>{t('action.close')}</button>
        <button type="button" className="sv-footer-btn sv-footer-btn--primary" onClick={onGoToRecall}>{t('taskList.viewAllInRecall')}<ArrowRight aria-hidden /></button>
      </div>
    </>
  );
}

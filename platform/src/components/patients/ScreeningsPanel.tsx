'use client';

/**
 * Preventive-care screenings on the chart — the HealthBridge "screenings due"
 * surface. Outstanding screenings come first with one-tap mark-done (recurring
 * screenings re-arm to the next interval), decline (with an optional reason)
 * and remove; completed and declined ones stay listed underneath as the
 * record of what happened. Mutates via screening-service.
 *
 * The list shown is the one the service hands back after each write, not the
 * `patient` prop: the prop only changes when the chart's whole patient list
 * reloads, which can take seconds, so a click used to look like it did
 * nothing. The prop takes over again as soon as it changes.
 */
import { useState } from 'react';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import type { PatientDoc } from '@/lib/db-types';
import type { ScreeningEntry } from '@/lib/types/patient-clinical';
import ChartSection, { OmrsEmptyState } from '@/components/ehr/chart/ChartSection';
import CodedSearchField from '@/components/CodedSearchField';
import { useConfirm, useConfirmPrompt } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { todayIso } from '@/lib/date-utils';
import { patientFullName } from '@/lib/patient-utils';
import { describeError } from '@/lib/user-facing-error';
import RowActionsMenu from '@/components/RowActionsMenu';
import { FormError } from '@/components/overlay/FormNotices';
import FormField from '@/components/overlay/FormField';
import FormSlider from '@/components/overlay/FormSlider';

const COMMON_SCREENINGS = ['Blood pressure', 'HIV test', 'Cervical cancer (VIA)', 'Diabetes (blood glucose)', 'TB symptom screen', 'Well-child check', 'Nutrition (MUAC)'];
const screeningOptions = COMMON_SCREENINGS.map(s => ({ code: '', name: s }));

/** Outstanding first (soonest due first), then the record, most recent first. */
function ordered(list: readonly ScreeningEntry[]): ScreeningEntry[] {
  const due = list.filter(s => s.status === 'due')
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  const closed = list.filter(s => s.status !== 'due')
    .sort((a, b) => (b.lastDoneDate || b.recordedAt || '').localeCompare(a.lastDoneDate || a.recordedAt || ''));
  return [...due, ...closed];
}

export default function ScreeningsPanel({ patient }: { patient: PatientDoc }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const confirmPrompt = useConfirmPrompt();
  const { showToast } = useToast();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const needScope = () => {
    if (!scope) throw new Error('Your account is not linked to an organization. Sign in again, or contact your administrator.');
    return scope;
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ type: string; dueDate: string; intervalMonths: string }>(
    { type: '', dueDate: todayIso(), intervalMonths: '' },
  );
  // The service's answer to the last write, valid only while the prop is the
  // one it was written against. A newer prop (the reload landing, or a change
  // from another device) replaces it without an effect.
  const stored = patient.screenings;
  const [written, setWritten] = useState<{ basis: typeof stored; list: ScreeningEntry[] } | null>(null);
  const screenings = written && written.basis === stored ? written.list : (stored ?? []);

  const today = todayIso();
  const rows = ordered(screenings);
  const closeForm = () => { setAdding(false); setError(null); };
  const author = { recordedBy: currentUser?._id, recordedByName: currentUser?.name || currentUser?.username };

  async function run(fn: () => Promise<ScreeningEntry[] | null>, done: string) {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      if (next === null) {
        // The patient or the screening was not found: the chart is showing
        // something the record no longer holds.
        setError(t('screenings.errStale'));
        return false;
      }
      setWritten({ basis: stored, list: next });
      showToast(done, 'success');
      return true;
    } catch (e) {
      setError(describeError(e, t('screenings.errFailed')));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const svc = await import('@/lib/services/screening-service');
    const type = form.type.trim();
    const ok = await run(() => svc.addScreening(patient._id, needScope(), {
      type,
      dueDate: form.dueDate || undefined,
      intervalMonths: form.intervalMonths ? parseInt(form.intervalMonths, 10) : undefined,
      ...author,
    }), t('screenings.added', { type }));
    if (ok) {
      setAdding(false);
      setForm({ type: '', dueDate: todayIso(), intervalMonths: '' });
    }
  }

  async function complete(s: ScreeningEntry) {
    const svc = await import('@/lib/services/screening-service');
    await run(() => svc.completeScreening(patient._id, needScope(), s.id), t('screenings.markedDone', { type: s.type }));
  }

  async function decline(s: ScreeningEntry) {
    const reason = await confirmPrompt({
      title: t('screenings.declineTitle', { type: s.type }),
      message: t('screenings.declineMessage'),
      inputLabel: t('screenings.declineReason'),
      confirmLabel: t('screenings.decline'),
      tone: 'warning',
    });
    if (reason === null) return;
    const svc = await import('@/lib/services/screening-service');
    await run(() => svc.declineScreening(patient._id, needScope(), s.id, reason), t('screenings.declined', { type: s.type }));
  }

  async function remove(s: ScreeningEntry) {
    const ok = await confirm({
      title: t('screenings.removeTitle'),
      message: t('screenings.removeMessage', { type: s.type }),
      confirmLabel: t('screenings.remove'),
      tone: 'danger',
    });
    if (!ok) return;
    const svc = await import('@/lib/services/screening-service');
    await run(() => svc.removeScreening(patient._id, needScope(), s.id), t('screenings.removed', { type: s.type }));
  }

  function recall(s: ScreeningEntry): string {
    const every = s.intervalMonths ? t('screenings.every', { count: s.intervalMonths }) : '';
    const last = s.lastDoneDate ? t('screenings.lastDone', { date: s.lastDoneDate }) : '';
    return [every, last].filter(Boolean).join(' · ') || '—';
  }

  function status(s: ScreeningEntry): { label: string; tone: string } {
    if (s.status === 'completed') return { label: t('screenings.statusCompleted'), tone: 'done' };
    if (s.status === 'declined') return { label: t('screenings.statusDeclined'), tone: 'muted' };
    if (s.dueDate && s.dueDate < today) return { label: t('screenings.statusOverdue'), tone: 'pending' };
    return { label: t('screenings.statusDue'), tone: 'active' };
  }

  return (
    <ChartSection title={t('screenings.title')} addLabel={t('screenings.add')} onAdd={() => setAdding(true)}>
      <table className="tamam-table tamam-table--fixed">
          <colgroup>
            <col /><col /><col /><col /><col />
          </colgroup>
          <thead>
            <tr>
              <th>{t('screenings.colScreening')}</th>
              <th>{t('screenings.colDue')}</th>
              <th>{t('screenings.colRecall')}</th>
              <th>{t('screenings.colStatus')}</th>
              <th>{t('screenings.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !adding && (
              <tr>
                <td colSpan={5} style={{ cursor: 'default', background: 'transparent' }}>
                  <OmrsEmptyState itemLabel={t('screenings.emptyItem')} actionLabel={t('screenings.addScreening')} onAction={() => setAdding(true)} />
                </td>
              </tr>
            )}
            {rows.map((s) => {
              const chip = status(s);
              return (
                <tr key={s.id}>
                  <td className="tamam-cell-strong">
                    {s.type}
                    {s.status === 'declined' && s.notes && <div className="scr-note">{s.notes}</div>}
                  </td>
                  <td>{s.status === 'due' ? (s.dueDate || '—') : '—'}</td>
                  <td>{recall(s)}</td>
                  <td>
                    <span className={`tamam-panel-badge tamam-panel-badge--${chip.tone}`}>{chip.label}</span>
                  </td>
                  <td>
                    <RowActionsMenu
                      ariaLabel={t('screenings.rowActions', { type: s.type })}
                      actions={[
                        ...(s.status === 'due' ? [
                          { key: 'done', label: t('screenings.done'), hint: t('screenings.doneHint'), disabled: busy, onClick: () => complete(s) },
                          { key: 'decline', label: t('screenings.decline'), hint: t('screenings.declineHint'), disabled: busy, onClick: () => decline(s) },
                        ] : []),
                        { key: 'remove', label: t('screenings.remove'), tone: 'danger' as const, disabled: busy, onClick: () => remove(s) },
                      ]}
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
          title={t('screenings.addTitle')}
          subtitle={patientFullName(patient)}
          className="tamam-dialog"
          onClose={closeForm}
          busy={busy}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={closeForm}>{t('screenings.cancel')}</button>
            <button type="button" className="btn btn-primary" disabled={busy || form.type.trim().length === 0} onClick={add}>{t('screenings.save')}</button>
          </>}
        >
          <div className="space-y-4">
            <CodedSearchField
              label={t('screenings.colScreening')}
              placeholder={t('screenings.searchPlaceholder')}
              options={screeningOptions}
              value={form.type}
              onChange={type => setForm({ ...form, type })}
              onSelect={o => setForm({ ...form, type: o.name })}
              showCodeBadge={false}
              autoFocus
            />
            <FormField label={t('screenings.colDue')}>
              {control => <input {...control} type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} />}
            </FormField>
            <FormField label={t('screenings.recallLabel')} optional>
              {control => <input {...control} type="number" step="1" min="0" value={form.intervalMonths} onChange={e => setForm({ ...form, intervalMonths: e.target.value })} placeholder={t('screenings.recallPlaceholder')} />}
            </FormField>
            {error && <FormError message={error} />}
          </div>
        </FormSlider>
      )}
    </ChartSection>
  );
}

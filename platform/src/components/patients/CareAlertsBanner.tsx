'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import FormField from '@/components/overlay/FormField';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import type { PatientDoc } from '@/lib/db-types';
import type { CareAlertCategory } from '@/data/mock';
import { AlertTriangle, Info, Plus } from '@/components/icons/lucide';
import { chartCareAlerts, isReferralStatusNotice } from '@/lib/care-alert-rules';
import { formatDate } from '@/lib/format-utils';
import './care-alerts.css';
import CareAlertFields, { CARE_ALERT_CATEGORY_LABELS } from '@/components/patients/CareAlertFields';
import { describeError } from '@/lib/user-facing-error';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { FormError } from '@/components/overlay/FormNotices';

/** More than this and the strip folds, so a long list cannot push the chart down. */
const VISIBLE_FLAGS = 3;

/**
 * Chart-permanent care alerts (P1.2), shown as one compact strip of patient
 * flags so patient-safety information (fall risk, difficult IV access, etc.)
 * is seen on every visit. Kept quiet on purpose: a persistent banner is the
 * one alert that never goes away, so it holds only lasting risks, most urgent
 * first, and progress notices (referrals) go to the notification bell. Resolving opens a confirmation popup and requires a
 * reason (alerts are retained, never hard-deleted) — it used to unfold a bare
 * text field inside the banner, which put a one-click dismissal of a safety
 * alert next to the alert it dismissed.
 */
export default function CareAlertsBanner({ patient, hideAddButton = false }: { patient: PatientDoc; hideAddButton?: boolean }) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const needScope = () => {
    if (!scope) throw new Error('Your account is not linked to an organization. Sign in again, or contact your administrator.');
    return scope;
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ category: CareAlertCategory; message: string; priority: 'high' | 'normal' }>(
    { category: 'clinical_risk', message: '', priority: 'high' },
  );
  const [showResolved, setShowResolved] = useState(false);
  const [reason, setReason] = useState('');
  const [form, setForm] = useState<{ category: CareAlertCategory; message: string; priority: 'high' | 'normal' }>(
    { category: 'clinical_risk', message: '', priority: 'high' },
  );

  // Most urgent first, without the referral notices the chart no longer shows.
  const active = chartCareAlerts(patient.careAlerts);
  // Resolved alerts are kept, never deleted; they sit behind a toggle so one
  // resolved by mistake (or a risk that has returned) can be reopened.
  const resolved = (patient.careAlerts ?? [])
    .filter((a) => a.status === 'resolved' && !isReferralStatusNotice(a))
    .sort((a, b) => (b.recordedAt || '').localeCompare(a.recordedAt || ''));
  const [showAll, setShowAll] = useState(false);
  const editingAlert = active.find((a) => a.id === editingId) ?? null;
  const closeEdit = () => { if (!busy) setEditingId(null); };
  const startEdit = (a: (typeof active)[number]) => {
    setEditForm({ category: a.category, message: a.message, priority: a.priority });
    setEditingId(a.id);
  };
  const resolvingAlert = active.find((a) => a.id === resolvingId) ?? null;
  const closeResolve = () => { if (!busy) { setResolvingId(null); setReason(''); } };
  const author = { recordedBy: currentUser?._id, recordedByName: currentUser?.name || currentUser?.username };

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAdding(false);
      setResolvingId(null);
      setEditingId(null);
      setReason('');
      setForm({ category: 'clinical_risk', message: '', priority: 'high' });
    } catch (e) {
      setError(describeError(e, t('msg.changeNotSavedTryAgain')));
    } finally {
      setBusy(false);
    }
  }
  async function doAdd() {
    const svc = await import('@/lib/services/care-alert-service');
    await svc.addCareAlert(patient._id, needScope(), { ...form, ...author });
  }
  async function doEdit(id: string) {
    const svc = await import('@/lib/services/care-alert-service');
    await svc.updateCareAlert(patient._id, needScope(), id, editForm, { id: currentUser?._id, name: author.recordedByName });
  }
  async function doReopen(id: string) {
    const svc = await import('@/lib/services/care-alert-service');
    await svc.reopenCareAlert(patient._id, needScope(), id, { id: currentUser?._id, name: author.recordedByName });
  }
  async function doResolve(id: string) {
    const svc = await import('@/lib/services/care-alert-service');
    await svc.resolveCareAlert(patient._id, needScope(), id, reason);
  }

  // Nothing active and not composing → a slim "add" affordance only. When the
  // add control is hosted elsewhere (ChartSafetyActions toolbar), render nothing.
  if (active.length === 0 && !adding && resolved.length === 0) {
    if (hideAddButton) return null;
    return (
      <div className="lg:col-span-3 lg:order-1 flex justify-end">
        <button className="btn btn-xs btn-secondary" onClick={() => setAdding(true)}>
          <Plus className="w-3 h-3" /> {t('ui.addCareAlert')}
        </button>
      </div>
    );
  }

  return (
    <div className="lg:col-span-3 lg:order-1 space-y-2">
      {active.length > 0 && (
        <section className="tamam-flags" aria-label={t('careAlerts.label')}>
          {(showAll ? active : active.slice(0, VISIBLE_FLAGS)).map((a) => (
            <div key={a.id} className="tamam-flag" data-priority={a.priority}>
              {a.priority === 'high'
                ? <AlertTriangle className="tamam-flag__icon" aria-hidden />
                : <Info className="tamam-flag__icon" aria-hidden />}
              <div className="tamam-flag__body">
                <p className="tamam-flag__message">{a.message}</p>
                <p className="tamam-flag__meta">
                  {[
                    CARE_ALERT_CATEGORY_LABELS[a.category],
                    a.recordedByName && t('careAlerts.addedBy', { name: a.recordedByName }),
                    a.recordedAt && formatDate(a.recordedAt),
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>
              <button
                type="button"
                className="tamam-flag__resolve"
                disabled={busy}
                onClick={() => startEdit(a)}
              >
                {t('careAlerts.edit')}
              </button>
              <button
                type="button"
                className="tamam-flag__resolve"
                disabled={busy}
                onClick={() => { setReason(''); setResolvingId(a.id); }}
              >
                {t('careAlerts.resolve')}
              </button>
            </div>
          ))}
          {active.length > VISIBLE_FLAGS && (
            <button type="button" className="tamam-flags__more" onClick={() => setShowAll(v => !v)}>
              {showAll ? t('careAlerts.showFewer') : t('careAlerts.showMore', { count: String(active.length - VISIBLE_FLAGS) })}
            </button>
          )}
        </section>
      )}

      {resolved.length > 0 && (
        <section className="tamam-flags" aria-label={t('careAlerts.resolvedLabel')}>
          <button type="button" className="tamam-flags__more" onClick={() => setShowResolved(v => !v)}>
            {showResolved ? t('careAlerts.hideResolved') : t('careAlerts.showResolved', { count: String(resolved.length) })}
          </button>
          {showResolved && resolved.map((a) => (
            <div key={a.id} className="tamam-flag" data-priority="normal">
              <Info className="tamam-flag__icon" aria-hidden />
              <div className="tamam-flag__body">
                <p className="tamam-flag__message">{a.message}</p>
                <p className="tamam-flag__meta">
                  {[
                    CARE_ALERT_CATEGORY_LABELS[a.category],
                    a.resolutionReason && t('careAlerts.resolvedBecause', { reason: a.resolutionReason }),
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>
              <button type="button" className="tamam-flag__resolve" disabled={busy} onClick={() => run(() => doReopen(a.id))}>
                {t('careAlerts.reopen')}
              </button>
            </div>
          ))}
        </section>
      )}

      {!adding ? (
        hideAddButton ? null : (
          <div className="flex justify-end">
            <button className="btn btn-xs btn-secondary" onClick={() => setAdding(true)}>
              <Plus className="w-3 h-3" /> {t('ui.addCareAlert')}
            </button>
          </div>
        )
      ) : (
        <div className="card-elevated p-3 space-y-2">
          <CareAlertFields
            category={form.category}
            priority={form.priority}
            message={form.message}
            onCategoryChange={category => setForm({ ...form, category })}
            onPriorityChange={priority => setForm({ ...form, priority })}
            onMessageChange={message => setForm({ ...form, message })}
          />
          <div className="flex items-center gap-2">
            <button className="btn btn-sm btn-primary" disabled={busy || form.message.trim().length === 0} onClick={() => run(doAdd)}>{t('ui.saveAlert')}</button>
            <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setAdding(false)}>{t('action.cancel')}</button>
          </div>
        </div>
      )}

      {error && <FormError message={error} />}

      {editingAlert && (
        <Modal variant="slider" onClose={closeEdit} size="md" labelledBy="care-alert-edit-title">
          <DialogFrame busy={busy}>
            <DialogHeader titleId="care-alert-edit-title" title={t('careAlerts.editTitle')} onClose={closeEdit} />
            <DialogBody tight>
              <CareAlertFields
                autoFocus
                category={editForm.category}
                priority={editForm.priority}
                message={editForm.message}
                onCategoryChange={category => setEditForm({ ...editForm, category })}
                onPriorityChange={priority => setEditForm({ ...editForm, priority })}
                onMessageChange={message => setEditForm({ ...editForm, message })}
              />
            </DialogBody>
            <DialogFooter>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={closeEdit}>{t('action.cancel')}</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || editForm.message.trim().length === 0}
                onClick={() => run(() => doEdit(editingAlert.id))}
              >
                {t('ui.saveAlert')}
              </button>
            </DialogFooter>
          </DialogFrame>
        </Modal>
      )}

      {resolvingAlert && (
        <Modal
          variant="slider"
          onClose={closeResolve}
          size="md"
          labelledBy="care-alert-resolve-title"
          describedBy="care-alert-resolve-desc"
        >
          <DialogFrame busy={busy}>
            <DialogHeader
              titleId="care-alert-resolve-title"
              title={t('ui.resolveThisCareAlert')}
              onClose={closeResolve}
            />
            <DialogBody tight>
              <p id="care-alert-resolve-desc">
                {t('ui.itStopsShowingOnThe')}
              </p>

              <div className="rounded-lg p-3 mt-3" style={{ background: 'var(--overlay-subtle)' }}>
                <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  {CARE_ALERT_CATEGORY_LABELS[resolvingAlert.category]}
                </span>
                <p className="text-[13px] font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>
                  {resolvingAlert.message}
                </p>
                {resolvingAlert.recordedByName && (
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {t('ui.addedBy')} {resolvingAlert.recordedByName}
                  </p>
                )}
              </div>

              <FormField id="care-alert-resolve-reason" label="Reason" required className="mt-3">
                {control => (
                  <textarea rows={1}
                    {...control}
                    data-modal-initial-focus
                    className="fs-input"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('ui.eGReassessedNoLonger')}
                  />
                )}
              </FormField>
            </DialogBody>
            <DialogFooter>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={closeResolve}>
                {t('action.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || reason.trim().length === 0}
                onClick={() => run(() => doResolve(resolvingAlert.id))}
              >
                {busy ? 'Saving…' : 'Resolve alert'}
              </button>
            </DialogFooter>
          </DialogFrame>
        </Modal>
      )}
    </div>
  );
}

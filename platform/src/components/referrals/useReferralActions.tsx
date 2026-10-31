'use client';

/**
 * A referral's actions on the patient chart: one ⋮ with everything the user may
 * do to it, each opening the right-hand slider, where the referral is read in
 * full before anything is written. Accept moves the patient, so it is never a
 * single click from a menu.
 */

import { useState } from 'react';
import FormField from '@/components/overlay/FormField';
import FormSlider from '@/components/overlay/FormSlider';
import type { RowAction } from '@/components/RowActionsMenu';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { todayIso } from '@/lib/date-utils';
import { formatDate, formatDateTime } from '@/lib/format-utils';
import type { ReferralDoc } from '@/lib/db-types';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useTranslation } from '@/lib/i18n/useTranslation';
import ReferralCompleteSlider from './ReferralCompleteSlider';

type ReferralMode = 'view' | 'accept' | 'decline' | 'undo' | 'reopen' | 'note';

export function useReferralActions({ canViewClinical, onChanged, onOpenAll }: {
  canViewClinical: boolean;
  /** Re-read the list after a write. */
  onChanged?: () => void;
  /** The /referrals worklist, filtered to this patient. */
  onOpenAll?: () => void;
}) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { canManageReferrals } = usePermissions();
  const { showToast } = useToast();
  const [open, setOpen] = useState<{ referral: ReferralDoc; mode: ReferralMode } | null>(null);
  const [completing, setCompleting] = useState<ReferralDoc | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const show = (referral: ReferralDoc, mode: ReferralMode) => { setText(''); setOpen({ referral, mode }); };
  const close = () => { if (!saving) setOpen(null); };

  /** What this user can decide on a referral. Only the receiving facility decides. */
  const decisions = (ref: ReferralDoc) => {
    const incoming = canManageReferrals && !!currentUser?.hospitalId && ref.toHospitalId === currentUser.hospitalId;
    return {
      decide: incoming && (ref.status === 'sent' || ref.status === 'received'),
      accepted: incoming && ref.status === 'seen',
      reopen: incoming && ref.status === 'cancelled',
      note: canManageReferrals && ref.status !== 'cancelled',
    };
  };

  const appendNote = (ref: ReferralDoc, line: string) => {
    const entry = `[${todayIso()} ${currentUser?.name || 'Unknown'}] ${line}`;
    return ref.notes ? `${ref.notes}\n\n${entry}` : entry;
  };

  const write = async (fn: () => Promise<unknown>, ok: string, failed: string) => {
    setSaving(true);
    try {
      await fn();
      showToast(ok, 'success');
      setOpen(null);
      onChanged?.();
    } catch {
      // The slider stays open with what was typed.
      showToast(failed, 'error');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id: string, status: 'received' | 'cancelled') => {
    const { updateReferralStatus } = await import('@/lib/services/referral-service');
    // null is a failed write, not a success.
    if (!(await updateReferralStatus(id, status))) throw new Error('not saved');
  };

  const submit = (ref: ReferralDoc, mode: ReferralMode) => {
    const line = text.trim();
    if (mode === 'accept') {
      return write(async () => {
        const { acceptReferral } = await import('@/lib/services/referral-service');
        if (!(await acceptReferral(ref._id))) throw new Error('not saved');
      }, t('referrals.toastAccepted', { name: ref.patientName }), t('referrals.toastAcceptFailed'));
    }
    if (mode === 'decline') {
      return write(async () => {
        await setStatus(ref._id, 'cancelled');
        const { updateReferralNotes } = await import('@/lib/services/referral-service');
        await updateReferralNotes(ref._id, appendNote(ref, `DECLINED: ${line}`));
      }, t('referrals.toastDeclined'), t('referrals.toastDeclineFailed'));
    }
    if (mode === 'note') {
      return write(async () => {
        const { updateReferralNotes } = await import('@/lib/services/referral-service');
        await updateReferralNotes(ref._id, appendNote(ref, line));
      }, t('referrals.toastNoteAdded'), t('referrals.toastNoteFailed'));
    }
    if (mode === 'undo') return write(() => setStatus(ref._id, 'received'), t('referrals.toastReversed'), t('referrals.toastReverseFailed'));
    return write(() => setStatus(ref._id, 'received'), t('chart.referralReopened'), t('chart.referralReopenFailed'));
  };

  const actionsFor = (ref: ReferralDoc): RowAction[] => {
    const can = decisions(ref);
    return [
      { key: 'view', label: t('chart.referralView'), onClick: () => show(ref, 'view') },
      ...(can.decide ? [
        { key: 'accept', label: t('referrals.accept'), onClick: () => show(ref, 'accept') },
        { key: 'decline', label: t('referrals.decline'), tone: 'danger' as const, onClick: () => show(ref, 'decline') },
      ] : []),
      // Accepted: the receiving facility closes it with the outcome, which is
      // what goes back to the clinician who asked (FHIR's closed referral loop).
      ...(can.accepted ? [
        { key: 'complete', label: t('referrals.markComplete'), onClick: () => setCompleting(ref) },
        { key: 'undo', label: t('action.undo'), onClick: () => show(ref, 'undo') },
      ] : []),
      ...(can.reopen ? [{ key: 'reopen', label: t('action.reopen'), onClick: () => show(ref, 'reopen') }] : []),
      ...(can.note ? [{ key: 'note', label: t('action.addNote'), onClick: () => show(ref, 'note') }] : []),
      ...(onOpenAll ? [{ key: 'open', label: t('chart.referralOpen'), onClick: onOpenAll }] : []),
    ];
  };

  const TITLE: Record<ReferralMode, string> = {
    view: t('chart.referralTitle'),
    accept: t('chart.referralAcceptTitle'),
    decline: t('referrals.declineTitle'),
    undo: t('chart.referralUndoTitle'),
    reopen: t('chart.referralReopenTitle'),
    note: t('referrals.addNoteTitle'),
  };

  const renderSlider = () => {
    if (!open) return null;
    const { referral: ref, mode } = open;
    const can = decisions(ref);
    const needsText = mode === 'decline' || mode === 'note';
    const hint = {
      view: undefined,
      accept: t('chart.referralAcceptHint', { name: ref.patientName }),
      decline: t('referrals.declineHint'),
      undo: t('chart.referralUndoHint'),
      reopen: t('chart.referralReopenBody', { name: ref.fromHospital }),
      note: t('referrals.addNoteHint'),
    }[mode];
    const confirmLabel = {
      accept: t('referrals.accept'), decline: t('referrals.confirmDecline'), undo: t('action.undo'),
      reopen: t('action.reopen'), note: t('action.addNote'),
    };
    return (
      <FormSlider
        title={TITLE[mode]}
        subtitle={ref.patientName}
        className="tamam-dialog"
        onClose={close}
        busy={saving}
        footer={mode === 'view' ? <>
          <button type="button" className="btn btn-secondary" onClick={close}>{t('action.close')}</button>
          {can.decide && <button type="button" className="btn btn-secondary" onClick={() => show(ref, 'decline')}>{t('referrals.decline')}</button>}
          {can.decide && <button type="button" className="btn btn-primary" onClick={() => show(ref, 'accept')}>{t('referrals.accept')}</button>}
          {can.accepted && <button type="button" className="btn btn-primary" onClick={() => { setOpen(null); setCompleting(ref); }}>{t('referrals.markComplete')}</button>}
          {can.reopen && <button type="button" className="btn btn-primary" onClick={() => show(ref, 'reopen')}>{t('action.reopen')}</button>}
        </> : <>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={close}>{t('action.cancel')}</button>
          <button type="button" className="btn btn-primary" disabled={saving || (needsText && !text.trim())} onClick={() => void submit(ref, mode)}>{confirmLabel[mode]}</button>
        </>}
      >
        <div className="space-y-4">
          {hint && <p className="tamam-slider-value">{hint}</p>}
          {needsText && (
            <FormField label={t(mode === 'decline' ? 'billing.reason' : 'action.addNote')} required>
              {control => <textarea {...control} rows={4} autoFocus value={text} onChange={e => setText(e.target.value)} placeholder={t(mode === 'decline' ? 'referrals.declinePlaceholder' : 'referrals.notePlaceholder')} />}
            </FormField>
          )}
          <FormField label={t('chart.referralField.status')}><p className="tamam-slider-value">{t(`referral.${ref.status}`)}</p></FormField>
          <FormField label={t('chart.referralField.route')}><p className="tamam-slider-value">{ref.fromHospital} → {ref.toHospital}</p></FormField>
          <FormField label={t('chart.referralField.department')}><p className="tamam-slider-value">{ref.department}</p></FormField>
          <FormField label={t('chart.referralField.urgency')}><p className="tamam-slider-value">{t(`chart.referralUrgency.${ref.urgency}`)}</p></FormField>
          <FormField label={t('ptDetail.referredBy')}>
            <p className="tamam-slider-value">{ref.referringDoctor}</p>
            <p className="tamam-slider-meta">{formatDate(ref.referralDate)}</p>
          </FormField>
          {canViewClinical ? <>
            <FormField label={t('referrals.reasonForReferral')}><p className="tamam-slider-value">{ref.reason}</p></FormField>
            {ref.notes && <FormField label={t('chart.referralField.notes')}><p className="tamam-slider-value">{ref.notes}</p></FormField>}
            {ref.outcome && (
              <FormField label={t('chart.referralField.outcome')}>
                <p className="tamam-slider-value">{t(`referrals.disposition_${ref.outcome.disposition}`)}: {ref.outcome.summary}</p>
                {ref.outcome.followUp && <p className="tamam-slider-value">{ref.outcome.followUp}</p>}
                <p className="tamam-slider-meta">{ref.outcome.recordedBy} · {formatDateTime(ref.outcome.recordedAt)}</p>
              </FormField>
            )}
          </> : <p className="tamam-slider-meta">{t('ptDetail.reasonRestricted')}</p>}
        </div>
      </FormSlider>
    );
  };

  return {
    actionsFor,
    slider: <>
      {renderSlider()}
      {completing && (
        <ReferralCompleteSlider
          recordedBy={currentUser?.name || 'Unknown'}
          onClose={() => setCompleting(null)}
          onComplete={async outcome => {
            await write(async () => {
              const { completeReferralWithOutcome } = await import('@/lib/services/referral-service');
              if (!(await completeReferralWithOutcome(completing._id, outcome))) throw new Error('not saved');
            }, t('referrals.toastCompleted'), t('referrals.toastCompleteFailed'));
            setCompleting(null);
          }}
        />
      )}
    </>,
  };
}

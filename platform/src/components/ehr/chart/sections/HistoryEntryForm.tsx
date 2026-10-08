'use client';

/**
 * The form behind one history entry — add or edit, any of the four domains.
 *
 * It writes through `history-service` itself rather than taking a save
 * callback, so the rule about social history — one answer per factor — lives
 * in exactly one place whichever screen opened it.
 */

import { useMemo, useState } from 'react';
import Select from '@/components/Select';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { HistoryDomain, HistoryEntryDoc } from '@/lib/db-types';
import { useDataScope } from '@/lib/hooks/useDataScope';
import {
  FAMILY_RELATIONS, OTHER_SOCIAL_FACTOR, SOCIAL_FACTORS,
  existingSocialEntry, getSocialFactor,
} from '@/lib/clinical/patient-history';

export interface HistoryFormUser {
  _id?: string;
  username?: string;
  name?: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
}

interface HistoryEntryFormProps {
  domain: HistoryDomain;
  patientId: string;
  patientName?: string;
  /** The entry being edited; absent when adding. */
  entry?: HistoryEntryDoc | null;
  /** The patient's current entries, so a repeated social factor updates in place. */
  entries: readonly HistoryEntryDoc[];
  currentUser: HistoryFormUser | null | undefined;
  /** Note the entry is being recorded from, when there is one. */
  sourceNoteId?: string;
  onSaved: (entry: HistoryEntryDoc) => void;
  onCancel: () => void;
}

const FIELD_CLASS = 'w-full p-2.5 rounded-md text-[13px]';
const FIELD_STYLE = {
  background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)',
} as const;
const LABEL_CLASS = 'text-[11px] font-semibold';
const LABEL_STYLE = { color: 'var(--text-muted)' } as const;

export default function HistoryEntryForm({
  domain, patientId, patientName, entry, entries, currentUser, sourceNoteId, onSaved, onCancel,
}: HistoryEntryFormProps) {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const editing = Boolean(entry);

  const [factor, setFactor] = useState(entry?.factor || SOCIAL_FACTORS[0].id);
  const [title, setTitle] = useState(entry?.title || '');
  const [relation, setRelation] = useState(entry?.relation || '');
  const [when, setWhen] = useState(entry?.when || '');
  const [facility, setFacility] = useState(entry?.facility || '');
  const [detail, setDetail] = useState(() => {
    if (entry) return entry.detail || '';
    // Adding a factor that is already answered opens on the current answer:
    // the clinician is changing it, not starting a second line.
    return domain === 'social' ? existingSocialEntry(entries, SOCIAL_FACTORS[0].id)?.detail || '' : '';
  });
  const [submitting, setSubmitting] = useState(false);

  const factorDef = getSocialFactor(factor);
  const isOtherFactor = factor === OTHER_SOCIAL_FACTOR;
  const replacing = useMemo(
    () => (domain === 'social' && !editing ? existingSocialEntry(entries, factor) : undefined),
    [domain, editing, entries, factor],
  );

  const handleFactorChange = (next: string) => {
    setFactor(next);
    setTitle('');
    setDetail(existingSocialEntry(entries, next)?.detail || '');
  };

  const socialTitle = isOtherFactor ? title.trim() : factorDef?.label || '';
  const canSave = domain === 'social'
    ? Boolean(socialTitle && detail.trim())
    : Boolean(title.trim());

  const scope = useDataScope();

  const handleSubmit = async () => {
    if (!canSave || submitting || !scope) return;
    setSubmitting(true);
    try {
      const svc = await import('@/lib/services/history-service');
      const actor = { userId: currentUser?._id || currentUser?.username, userName: currentUser?.name };
      const fields = domain === 'social'
        ? { title: socialTitle, factor, detail }
        : {
            title,
            when,
            detail,
            ...(domain === 'family' ? { relation } : {}),
            ...(domain === 'surgical' ? { facility } : {}),
          };

      const target = entry ?? replacing;
      const saved = target
        ? await svc.updateHistoryEntry(target._id, fields, scope, actor)
        : await svc.createHistoryEntry({
            ...fields,
            domain,
            patientId,
            patientName,
            sourceNoteId,
            recordedBy: actor.userId,
            recordedByName: actor.userName,
            hospitalId: currentUser?.hospitalId,
            hospitalName: currentUser?.hospitalName,
            orgId: currentUser?.orgId,
          });
      if (!saved) throw new Error('history entry not found');
      showToast(t(target ? 'history.updated' : 'history.saved'), 'success');
      onSaved(saved);
    } catch (err) {
      console.error(err);
      showToast(t('history.saveFailed'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}
    >
      {domain === 'social' ? (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="history-factor" className={LABEL_CLASS} style={LABEL_STYLE}>{t('history.form.factor')}</label>
            <Select
              id="history-factor"
              className={FIELD_CLASS}
              value={factor}
              // The factor is what the line IS; changing it on an existing line
              // would turn a smoking status into an occupation.
              disabled={editing}
              onChange={e => handleFactorChange(e.target.value)}
            >
              {SOCIAL_FACTORS.map(f => <option key={f.id} value={f.id}>{t(`history.factor.${f.id}`)}</option>)}
            </Select>
          </div>
          {isOtherFactor && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="history-title" className={LABEL_CLASS} style={LABEL_STYLE}>{t('history.form.whatItIs')}</label>
              <input
                id="history-title"
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={t('history.form.whatItIsPlaceholder')}
                className={FIELD_CLASS}
                style={FIELD_STYLE}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="history-detail" className={LABEL_CLASS} style={LABEL_STYLE}>{t('history.form.finding')}</label>
            {factorDef?.options && (
              <div className="flex flex-wrap gap-1.5">
                {factorDef.options.map(option => (
                  <button
                    key={option}
                    type="button"
                    className={`btn btn-xs ${detail === option ? 'btn-primary' : 'btn-secondary'}`}
                    aria-pressed={detail === option}
                    onClick={() => setDetail(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
            <input
              id="history-detail"
              type="text"
              value={detail}
              onChange={e => setDetail(e.target.value)}
              placeholder={t(`history.factorPlaceholder.${factor}`)}
              className={FIELD_CLASS}
              style={FIELD_STYLE}
            />
            {replacing && (
              <p className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                {t('history.form.replaces', {
                  factor: t(`history.factor.${factor}`),
                  current: replacing.detail || replacing.title,
                })}
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          {domain === 'family' && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="history-relation" className={LABEL_CLASS} style={LABEL_STYLE}>{t('history.form.relative')}</label>
              <input
                id="history-relation"
                type="text"
                list="history-relations"
                value={relation}
                onChange={e => setRelation(e.target.value)}
                placeholder={t('history.form.relativePlaceholder')}
                className={FIELD_CLASS}
                style={FIELD_STYLE}
              />
              <datalist id="history-relations">
                {FAMILY_RELATIONS.map(r => <option key={r} value={r} />)}
              </datalist>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="history-title" className={LABEL_CLASS} style={LABEL_STYLE}>{t(`history.form.title.${domain}`)}</label>
            <input
              id="history-title"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t(`history.form.titlePlaceholder.${domain}`)}
              className={FIELD_CLASS}
              style={FIELD_STYLE}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="history-when" className={LABEL_CLASS} style={LABEL_STYLE}>
              {t(domain === 'family' ? 'history.form.familyWhen' : 'history.form.when')}
            </label>
            <input
              id="history-when"
              type="text"
              value={when}
              onChange={e => setWhen(e.target.value)}
              placeholder={t(domain === 'family' ? 'history.form.familyWhenPlaceholder' : 'history.form.whenPlaceholder')}
              className={FIELD_CLASS}
              style={FIELD_STYLE}
            />
          </div>
          {domain === 'surgical' && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="history-facility" className={LABEL_CLASS} style={LABEL_STYLE}>{t('history.form.where')}</label>
              <input
                id="history-facility"
                type="text"
                value={facility}
                onChange={e => setFacility(e.target.value)}
                placeholder={t('history.form.wherePlaceholder')}
                className={FIELD_CLASS}
                style={FIELD_STYLE}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="history-detail" className={LABEL_CLASS} style={LABEL_STYLE}>{t('history.form.details')}</label>
            <textarea
              id="history-detail"
              rows={2}
              value={detail}
              onChange={e => setDetail(e.target.value)}
              placeholder={t('history.form.detailsPlaceholder')}
              className={FIELD_CLASS}
              style={FIELD_STYLE}
            />
          </div>
        </>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" className="btn btn-sm btn-secondary" disabled={submitting} onClick={onCancel}>{t('common.cancel')}</button>
        <button type="submit" className="btn btn-sm btn-primary" disabled={submitting || !canSave}>
          {t(submitting ? 'common.saving' : 'common.save')}
        </button>
      </div>
    </form>
  );
}

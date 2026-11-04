'use client';

/**
 * Duplicate-record review: candidate pairs, the Mark as duplicate dialog, the
 * linked duplicates and Undo. Shared by /data-quality (every role that may
 * review records) and /admin/data (the platform operator's governance console).
 *
 * Marking is offered only to PATIENT_DUPLICATE_ROLES; any other role that can
 * open the page sees the candidates and the linked records, with no button.
 */
import { useMemo, useState } from 'react';
import { SadbCard, SadbPanelHeader } from '@/components/admin/sadb-ui';
import { SaTable } from '@/components/admin/sa-ui';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { markPatientDuplicate, clearPatientDuplicate } from '@/lib/services/patient-service';
import { PATIENT_DUPLICATE_ROLES } from '@/lib/sync/write-permissions';
import type { PatientDoc } from '@/lib/db-types';
import Modal from '@/components/Modal';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import FormField from '@/components/overlay/FormField';
import { FormError } from '@/components/overlay/FormNotices';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { describeError } from '@/lib/user-facing-error';
import { formatDateTime } from '@/lib/format-utils';
import { patientName, type DupPair } from './duplicate-candidates';
import type { DuplicateReview } from './useDuplicateReview';

const ROW_CAP = 50;

export default function DuplicateReviewPanel({ review, standalone = false }: {
  review: DuplicateReview;
  /** Wrap in the admin-kit scope when the host page is not already an admin-kit page. */
  standalone?: boolean;
}) {
  const { hospitals, loading: hospitalsLoading } = useHospitals();
  const scope = useDataScope();
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const canMark = !!currentUser && PATIENT_DUPLICATE_ROLES.includes(currentUser.role);
  const [marking, setMarking] = useState<DupPair | null>(null);
  const [keepId, setKeepId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const busy = review.loading || hospitalsLoading;

  const hospitalName = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of hospitals) map.set(h._id, h.name);
    return map;
  }, [hospitals]);

  const openMark = (pair: DupPair) => { setMarking(pair); setKeepId(pair.a._id); setReason(''); setMarkError(null); };
  const closeMark = () => { if (!saving) setMarking(null); };
  const actor = () => ({ id: currentUser?._id, name: currentUser?.name || currentUser?.username, role: currentUser!.role });

  const confirmMark = async () => {
    if (!marking || !scope || !currentUser) return;
    const duplicate = keepId === marking.a._id ? marking.b : marking.a;
    setSaving(true);
    setMarkError(null);
    try {
      await markPatientDuplicate(duplicate._id, keepId, reason, actor(), scope);
      showToast(t('dup.marked', { name: patientName(duplicate) }), 'success');
      setMarking(null);
      await review.reload();
    } catch (err) {
      setMarkError(describeError(err, t('msg.changeNotSavedTryAgain')));
    } finally {
      setSaving(false);
    }
  };

  const undoLink = async (p: PatientDoc) => {
    if (!scope || !currentUser) return;
    try {
      await clearPatientDuplicate(p._id, actor(), scope);
      showToast(t('dup.undone', { name: patientName(p) }), 'success');
      await review.reload();
    } catch (err) {
      showToast(describeError(err, t('dup.notUndone')), 'error');
    }
  };

  const content = (
    <>
        <SadbPanelHeader
          title={t('dup.panelTitle')}
          note={t('dup.panelNote')}
          tag={busy ? undefined : (review.candidates.length > 0 ? `${review.candidates.length} candidate pair${review.candidates.length === 1 ? '' : 's'}` : 'No duplicates')}
          tagTone={busy ? undefined : (review.candidates.length > 0 ? 'yellow' : 'green')}
        />
        <SadbCard meta={busy ? undefined : `${review.patients.length.toLocaleString()} patients scanned`}>
          <SaTable
            columns={[
              { label: 'Patient A', w: 1.3 }, { label: 'Patient B', w: 1.3 },
              { label: 'Match basis', w: 1.6 }, { label: 'Facility', w: 1.2 },
              ...(canMark ? [{ label: '', w: 1 }] : []),
            ]}
            empty={busy ? 'Loading…' : 'No duplicate candidates detected.'}
            minWidth={680}
          >
            {review.candidates.slice(0, ROW_CAP).map((pair) => {
              const { a, b, basis } = pair;
              const facA = (a.registrationHospital && hospitalName.get(a.registrationHospital)) || a.registrationHospital || '—';
              const facB = (b.registrationHospital && hospitalName.get(b.registrationHospital)) || b.registrationHospital || '—';
              return (
                <tr key={`${a._id}|${b._id}`}>
                  <td><strong>{patientName(a)}</strong> <span style={{ color: 'var(--text-muted)' }}>{a.hospitalNumber}</span></td>
                  <td><strong>{patientName(b)}</strong> <span style={{ color: 'var(--text-muted)' }}>{b.hospitalNumber}</span></td>
                  <td>{basis}</td>
                  <td>{facA === facB ? facA : `${facA} / ${facB}`}</td>
                  {canMark && (
                    <td>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openMark(pair)}>
                        {t('dup.mark')}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </SaTable>
          {!busy && review.candidates.length > ROW_CAP && (
            <p className="sadb-card-meta" style={{ padding: '10px 14px', margin: 0, borderTop: '1px solid var(--border-light)' }}>
              Showing first {ROW_CAP} of {review.candidates.length}.
            </p>
          )}
        </SadbCard>

        <SadbCard title={t('dup.linkedTitle')} meta={busy ? undefined : t('dup.linkedMeta', { count: review.linked.length })}>
          <SaTable
            columns={[
              { label: t('dup.colDuplicate'), w: 1.3 }, { label: t('dup.colKept'), w: 1.3 },
              { label: t('dup.colReason'), w: 1.6 }, { label: t('dup.colMarked'), w: 1.2 },
              ...(canMark ? [{ label: '', w: 0.8 }] : []),
            ]}
            empty={busy ? 'Loading…' : t('dup.noneLinked')}
            minWidth={680}
          >
            {review.linked.map(p => {
              const kept = review.allPatients.find(x => x._id === p.duplicateOf);
              return (
                <tr key={p._id}>
                  <td><strong>{patientName(p)}</strong> <span style={{ color: 'var(--text-muted)' }}>{p.hospitalNumber}</span></td>
                  <td>
                    {kept
                      ? <><strong>{patientName(kept)}</strong> <span style={{ color: 'var(--text-muted)' }}>{kept.hospitalNumber}</span></>
                      : <span style={{ color: 'var(--text-muted)' }}>{p.duplicateOf}</span>}
                  </td>
                  <td>{p.duplicateReason || '—'}</td>
                  <td>
                    {p.duplicateMarkedAt ? formatDateTime(p.duplicateMarkedAt) : '—'}
                    {p.duplicateMarkedByName ? <span style={{ color: 'var(--text-muted)' }}> {p.duplicateMarkedByName}</span> : null}
                  </td>
                  {canMark && (
                    <td>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => undoLink(p)}>
                        {t('dup.undo')}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </SaTable>
        </SadbCard>

        {marking && (
          <Modal variant="slider" onClose={closeMark} size="md" labelledBy="dup-mark-title" describedBy="dup-mark-desc">
            <DialogFrame busy={saving}>
              <DialogHeader titleId="dup-mark-title" title={t('dup.dialogTitle')} onClose={closeMark} />
              <DialogBody tight>
                <p id="dup-mark-desc">{t('dup.dialogIntro')}</p>
                <fieldset style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
                  <legend style={{ fontWeight: 600, marginBottom: 6 }}>{t('dup.keepLabel')}</legend>
                  {[marking.a, marking.b].map(p => (
                    <label key={p._id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', textTransform: 'none' }}>
                      <input
                        type="radio"
                        name="dup-keep"
                        checked={keepId === p._id}
                        onChange={() => setKeepId(p._id)}
                      />
                      <span>{t('dup.keepOption', { name: patientName(p), number: p.hospitalNumber || '—' })}</span>
                    </label>
                  ))}
                </fieldset>
                <FormField id="dup-mark-reason" label={t('dup.reasonLabel')} required className="mt-3">
                  {control => (
                    <input
                      {...control}
                      data-modal-initial-focus
                      className="fs-input"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={t('dup.reasonPlaceholder')}
                    />
                  )}
                </FormField>
                <p className="mt-3" style={{ color: 'var(--text-muted)' }}>{t('dup.notMoved')}</p>
                {markError && <FormError message={markError} />}
              </DialogBody>
              <DialogFooter>
                <button type="button" className="btn btn-secondary" disabled={saving} onClick={closeMark}>
                  {t('dup.cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving || reason.trim().length === 0}
                  onClick={confirmMark}
                >
                  {saving ? t('dup.saving') : t('dup.confirm')}
                </button>
              </DialogFooter>
            </DialogFrame>
          </Modal>
        )}
    </>
  );

  return standalone
    ? <div className="sadb-scope" data-testid="duplicate-review"><div className="sadb-page">{content}</div></div>
    : content;
}

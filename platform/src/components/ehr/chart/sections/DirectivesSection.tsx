'use client';

/**
 * Directives & consent tab content — the chart-shaped view of
 * `patient.directives`, in the same ChartSection table language as Allergies
 * and Conditions.
 *
 * facesheet and ChartSummaryPanel, where a compact strip is right and a
 * five-column table is not. Same relationship AllergiesSection has with
 * AllergyList, and both read and write the same `directive-service` — no
 * second data layer.
 *
 * Signature state leads the row. Recording that a consent exists and holding a
 * signed one are different facts, and only the second authorises anything.
 */

import { useState } from 'react';
import ChartSection, { OmrsEmptyState } from '../ChartSection';
import Modal from '@/components/Modal';
import FormSlider from '@/components/overlay/FormSlider';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import Select from '@/components/Select';
import { Lock } from '@/components/icons/lucide';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { formatDate, formatDateTime } from '@/lib/format-utils';
import type { PatientDoc } from '@/lib/db-types';
import type { DirectiveType } from '@/data/mock';
import type { DirectiveSignatory } from '@/lib/types/patient-clinical';
import RowActionsMenu from '@/components/RowActionsMenu';
import { describeError } from '@/lib/user-facing-error';
import { useTranslation } from '@/lib/i18n/useTranslation';

const TYPE_LABELS: Record<DirectiveType, string> = {
  informed_consent: 'Informed consent',
  abn_noncovered: 'Non-covered service (ABN)',
  privacy_consent: 'Privacy / communication consent',
  advance_directive: 'Advance directive',
  release_of_information: 'Release of information',
  other: 'Other',
};
const TYPE_OPTIONS = Object.keys(TYPE_LABELS) as DirectiveType[];

const SIGNATORY_LABELS: Record<DirectiveSignatory, string> = {
  patient: 'The patient',
  guardian: 'Parent / legal guardian',
  next_of_kin: 'Next of kin',
  power_of_attorney: 'Power of attorney',
};
const SIGNATORY_OPTIONS = Object.keys(SIGNATORY_LABELS) as DirectiveSignatory[];

const EMPTY_FORM = { type: 'informed_consent' as DirectiveType, description: '', startDate: '' };
const EMPTY_SIGN = { name: '', signedBy: 'patient' as DirectiveSignatory, relationship: '' };

const fieldCls = 'w-full p-2.5 rounded-md text-[13px]';
const fieldStyle = {
  background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)',
} as const;

export default function DirectivesSection({ patient }: { patient: PatientDoc }) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const needScope = () => {
    if (!scope) throw new Error('Your account is not linked to an organization. Sign in again, or contact your administrator.');
    return scope;
  };
  const { showToast } = useToast();
  const { canEditClinical, canRegisterPatients } = usePermissions();
  // Consent is taken by the front desk as often as by a clinician — this is the
  // one chart section a registration clerk legitimately writes to.
  const canManage = canEditClinical || canRegisterPatients;

  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<{ id: string; type: DirectiveType; description: string; startDate?: string } | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [signing, setSigning] = useState<{ id: string; type: DirectiveType; description: string } | null>(null);
  const [signForm, setSignForm] = useState(EMPTY_SIGN);
  const [revoking, setRevoking] = useState<{ id: string; type: DirectiveType } | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const entries = patient.directives ?? [];
  const active = entries.filter(d => d.status === 'active');
  const typeLabel = (t: DirectiveType) => TYPE_LABELS[t] || t;
  const query = search.trim().toLowerCase();
  const visibleEntries = query
    ? active.filter(d => `${typeLabel(d.type)} ${d.description} ${d.startDate || ''} ${d.signature ? 'signed' : 'unsigned'}`.toLowerCase().includes(query))
    : active;
  const author = { recordedBy: currentUser?._id, recordedByName: currentUser?.name || currentUser?.username };

  const run = async (fn: () => Promise<unknown>, done: () => void, ok: string) => {
    setBusy(true);
    try {
      // The services return null when the entry is no longer on the record.
      if ((await fn()) === null) throw new Error('Change not saved. Try again.');
      showToast(ok, 'success');
      done();
    } catch (e) {
      showToast(describeError(e, t('msg.changeNotSavedTryAgain')), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ChartSection
        title="Directives &amp; consent"
        addLabel="Add"
        onAdd={canManage ? () => { setAddForm(EMPTY_FORM); setAdding(true); } : undefined}
        searchValue={search}
        onSearchChange={setSearch}
      >
        <table className="tamam-table tamam-table--fixed tamam-table--interactive tamam-table--directives">
          <colgroup>
            <col /><col /><col /><col /><col />
          </colgroup>
          <thead>
            <tr>
              <th>Type</th>
              <th>Detail</th>
              <th>Effective</th>
              <th>Status</th>
              <th>{t('chart.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {active.length === 0 && (
              <tr>
                <td colSpan={5} style={{ cursor: 'default', background: 'transparent' }}>
                  <OmrsEmptyState
                    itemLabel="directives"
                    actionLabel="Record consent"
                    onAction={canManage ? () => { setAddForm(EMPTY_FORM); setAdding(true); } : undefined}
                    disabledReason={canManage ? undefined : 'Requires clinical or registration permission'}
                  />
                </td>
              </tr>
            )}
            {visibleEntries.map(d => (
              <tr key={d.id}>
                <td className="tamam-cell-strong">{typeLabel(d.type)}</td>
                <td>{d.description || '—'}</td>
                <td>{d.startDate ? formatDate(d.startDate) : '—'}</td>
                <td>
                  {d.signature ? (
                    <>
                      <span className="tamam-panel-badge tamam-panel-badge--done">
                        <Lock className="w-3 h-3" /> Signed
                      </span>
                      <div className="tamam-cell-sub">
                        {d.signature.name}
                        {d.signature.signedBy !== 'patient' && ` (${d.signature.relationship || d.signature.signedBy})`}
                        {' · '}{formatDateTime(d.signature.signedAt)}
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="tamam-panel-badge tamam-panel-badge--pending">Unsigned</span>
                      <div className="tamam-cell-sub">Recorded, not yet attested</div>
                    </>
                  )}
                </td>
                <td>
                  <RowActionsMenu
                    ariaLabel={t('chart.directiveRowActions', { name: typeLabel(d.type) })}
                    actions={canManage ? [
                      ...(!d.signature ? [
                        { key: 'sign', label: t('chart.directiveTakeSignature'), disabled: busy, onClick: () => { setSigning({ id: d.id, type: d.type, description: d.description }); setSignForm(EMPTY_SIGN); } },
                        { key: 'edit', label: t('chart.directiveEdit'), disabled: busy, onClick: () => { setEditing({ id: d.id, type: d.type, description: d.description, startDate: d.startDate }); setEditForm({ type: d.type, description: d.description, startDate: d.startDate ?? '' }); } },
                      ] : []),
                      { key: 'revoke', label: t('chart.directiveRevoke'), tone: 'danger' as const, disabled: busy, onClick: () => { setRevoking({ id: d.id, type: d.type }); setRevokeReason(''); } },
                    ] : []}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartSection>

      {/* ── Add ── */}
      {adding && (
        <FormSlider
          title="Add directive / consent"
          className="tamam-dialog"
          width={480}
          onClose={() => !busy && setAdding(false)}
          busy={busy}
          footer={<>
              <button className="btn btn-secondary" disabled={busy} onClick={() => setAdding(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={busy || !addForm.description.trim()}
                onClick={() => run(async () => {
                  const svc = await import('@/lib/services/directive-service');
                  await svc.addDirective(patient._id, needScope(), { ...addForm, description: addForm.description.trim(), ...author });
                }, () => setAdding(false), 'Directive recorded')}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
          </>}
        >
          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dir-type" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Type</label>
              <Select id="dir-type" value={addForm.type} onChange={e => setAddForm({ ...addForm, type: e.target.value as DirectiveType })}>
                {TYPE_OPTIONS.map(t => <option key={t} value={t}>{typeLabel(t)}</option>)}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dir-desc" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Detail</label>
              <input id="dir-desc" autoFocus value={addForm.description} onChange={e => setAddForm({ ...addForm, description: e.target.value })} placeholder="e.g. General consent to treat" className={fieldCls} style={fieldStyle} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dir-start" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Effective from</label>
              <input id="dir-start" type="date" value={addForm.startDate} onChange={e => setAddForm({ ...addForm, startDate: e.target.value })} className={fieldCls} style={fieldStyle} />
            </div>
          </div>
        </FormSlider>
      )}

      {/* ── Edit (unsigned only) ── */}
      {editing && (
        <FormSlider
          title="Edit directive"
          className="tamam-dialog"
          width={480}
          onClose={() => !busy && setEditing(null)}
          busy={busy}
          footer={<>
              <button className="btn btn-secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={busy || !editForm.description.trim()}
                onClick={() => run(async () => {
                  const svc = await import('@/lib/services/directive-service');
                  return svc.updateDirective(patient._id, needScope(), editing.id, {
                    type: editForm.type,
                    description: editForm.description.trim(),
                    startDate: editForm.startDate || undefined,
                  });
                }, () => setEditing(null), 'Directive updated')}
              >
                {busy ? 'Saving…' : 'Save changes'}
              </button>
          </>}
        >
          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dir-etype" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Type</label>
              <Select id="dir-etype" value={editForm.type} onChange={e => setEditForm({ ...editForm, type: e.target.value as DirectiveType })}>
                {TYPE_OPTIONS.map(t => <option key={t} value={t}>{typeLabel(t)}</option>)}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dir-edesc" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Detail</label>
              <input id="dir-edesc" value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} className={fieldCls} style={fieldStyle} />
            </div>
          </div>
        </FormSlider>
      )}

      {/* ── Signature ── */}
      {signing && (
        <FormSlider
          title="Take signature"
          className="tamam-dialog"
          width={460}
          onClose={() => !busy && setSigning(null)}
          busy={busy}
          footer={<>
              <button className="btn btn-secondary" disabled={busy} onClick={() => setSigning(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={busy || !signForm.name.trim() || (signForm.signedBy !== 'patient' && !signForm.relationship.trim())}
                onClick={() => run(async () => {
                  const svc = await import('@/lib/services/directive-service');
                  return svc.signDirective(patient._id, needScope(), signing.id, {
                    name: signForm.name,
                    signedBy: signForm.signedBy,
                    relationship: signForm.relationship,
                    witnessId: currentUser?._id,
                    witnessName: author.recordedByName,
                  });
                }, () => setSigning(null), 'Signature recorded')}
              >
                <Lock className="w-3.5 h-3.5" /> Record signature
              </button>
          </>}
        >
          <div className="space-y-4">
            <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              <strong>{typeLabel(signing.type)}</strong> — {signing.description}
            </p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dir-signedby" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Who is signing</label>
              <Select id="dir-signedby" value={signForm.signedBy} onChange={e => setSignForm({ ...signForm, signedBy: e.target.value as DirectiveSignatory })}>
                {SIGNATORY_OPTIONS.map(s => <option key={s} value={s}>{SIGNATORY_LABELS[s]}</option>)}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dir-signame" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Name as signed</label>
              <input id="dir-signame" autoFocus value={signForm.name} onChange={e => setSignForm({ ...signForm, name: e.target.value })} placeholder="Full name" className={fieldCls} style={fieldStyle} />
            </div>
            {signForm.signedBy !== 'patient' && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="dir-rel" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Relationship to the patient</label>
                <input id="dir-rel" value={signForm.relationship} onChange={e => setSignForm({ ...signForm, relationship: e.target.value })} placeholder="e.g. mother, legal guardian" className={fieldCls} style={fieldStyle} />
              </div>
            )}
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Witnessed by {author.recordedByName || 'the signed-in user'}. A signature cannot be edited afterwards —
              a consent taken in error is revoked and taken again.
            </p>
          </div>
        </FormSlider>
      )}

      {/* ── Revoke ── */}
      {revoking && (
        <Modal className="tamam-dialog" onClose={() => !busy && setRevoking(null)} width={440} labelledBy="revoke-dir-title">
          <DialogFrame busy={busy}>
            <DialogHeader titleId="revoke-dir-title" title="Revoke directive" onClose={() => !busy && setRevoking(null)} />
            <DialogBody className="space-y-4">
            <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              Revoke <strong>{typeLabel(revoking.type)}</strong>? The entry is kept with its reason — consent history
              is never deleted.
            </p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dir-reason" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Reason (required)</label>
              <input id="dir-reason" autoFocus value={revokeReason} onChange={e => setRevokeReason(e.target.value)} className={fieldCls} style={fieldStyle} />
            </div>
            </DialogBody>
            <DialogFooter>
              <button className="btn btn-secondary" disabled={busy} onClick={() => setRevoking(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={busy || !revokeReason.trim()}
                onClick={() => run(async () => {
                  const svc = await import('@/lib/services/directive-service');
                  return svc.removeDirective(patient._id, needScope(), revoking.id, revokeReason.trim());
                }, () => setRevoking(null), 'Directive revoked')}
              >
                {busy ? 'Saving…' : 'Revoke'}
              </button>
            </DialogFooter>
          </DialogFrame>
        </Modal>
      )}
    </>
  );
}

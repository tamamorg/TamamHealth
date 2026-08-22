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
import Select from '@/components/Select';
import RowActionsMenu, { type RowAction } from '@/components/RowActionsMenu';
import { Edit3, Trash2, Lock, Pencil, X } from '@/components/icons/lucide';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { formatDate, formatDateTime } from '@/lib/format-utils';
import type { PatientDoc } from '@/lib/db-types';
import type { DirectiveType } from '@/data/mock';
import type { DirectiveSignatory } from '@/lib/types/patient-clinical';

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
const cardStyle = { background: 'var(--bg-card)', border: '1px solid var(--border-light)' } as const;

export default function DirectivesSection({ patient }: { patient: PatientDoc }) {
  const { currentUser } = useAuth();
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

  const entries = patient.directives ?? [];
  const active = entries.filter(d => d.status === 'active');
  const author = { recordedBy: currentUser?._id, recordedByName: currentUser?.name || currentUser?.username };
  const typeLabel = (t: DirectiveType) => TYPE_LABELS[t] || t;

  const run = async (fn: () => Promise<unknown>, done: () => void, ok: string) => {
    setBusy(true);
    try {
      await fn();
      showToast(ok, 'success');
      done();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Action failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const rowActions = (d: typeof active[number]): RowAction[] => {
    const actions: RowAction[] = [];
    if (!d.signature) {
      actions.push({
        key: 'sign', label: 'Take signature', icon: <Pencil className="w-3.5 h-3.5" />, disabled: busy,
        onClick: () => { setSigning({ id: d.id, type: d.type, description: d.description }); setSignForm(EMPTY_SIGN); },
      });
      actions.push({
        key: 'edit', label: 'Edit', icon: <Edit3 className="w-3.5 h-3.5" />, disabled: busy,
        onClick: () => {
          setEditing({ id: d.id, type: d.type, description: d.description, startDate: d.startDate });
          setEditForm({ type: d.type, description: d.description, startDate: d.startDate ?? '' });
        },
      });
    }
    actions.push({
      key: 'revoke', label: 'Revoke', tone: 'danger', icon: <Trash2 className="w-3.5 h-3.5" />, disabled: busy,
      onClick: () => { setRevoking({ id: d.id, type: d.type }); setRevokeReason(''); },
    });
    return actions;
  };

  return (
    <>
      <ChartSection
        title="Directives &amp; consent"
        addLabel="Add"
        onAdd={canManage ? () => { setAddForm(EMPTY_FORM); setAdding(true); } : undefined}
      >
        {active.length === 0 ? (
          <OmrsEmptyState
            itemLabel="directives"
            actionLabel="Record consent"
            onAction={canManage ? () => { setAddForm(EMPTY_FORM); setAdding(true); } : undefined}
            disabledReason={canManage ? undefined : 'Requires clinical or registration permission'}
          />
        ) : (
          <table className="omrs-table omrs-table--directives">
            <colgroup>
              <col style={{ width: '22%' }} />
              <col style={{ width: '34%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '23%' }} />
              {canManage && <col style={{ width: '7%' }} />}
            </colgroup>
            <thead>
              <tr>
                <th>Type</th>
                <th>Detail</th>
                <th>Effective</th>
                <th>Status</th>
                {canManage && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {active.map(d => (
                <tr key={d.id}>
                  <td className="omrs-cell-strong">{typeLabel(d.type)}</td>
                  <td>{d.description || '—'}</td>
                  <td>{d.startDate ? formatDate(d.startDate) : '—'}</td>
                  <td>
                    {d.signature ? (
                      <>
                        <span className="omrs-panel-badge omrs-panel-badge--done">
                          <Lock className="w-3 h-3" /> Signed
                        </span>
                        <div className="omrs-cell-sub">
                          {d.signature.name}
                          {d.signature.signedBy !== 'patient' && ` (${d.signature.relationship || d.signature.signedBy})`}
                          {' · '}{formatDateTime(d.signature.signedAt)}
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="omrs-panel-badge omrs-panel-badge--pending">Unsigned</span>
                        <div className="omrs-cell-sub">Recorded, not yet attested</div>
                      </>
                    )}
                  </td>
                  {canManage && (
                    <td className="omrs-cell-actions">
                      <RowActionsMenu ariaLabel={`Actions for ${typeLabel(d.type)}`} actions={rowActions(d)} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ChartSection>

      {/* ── Add ── */}
      {adding && (
        <Modal onClose={() => !busy && setAdding(false)} width={480} labelledBy="add-directive-title">
          <div className="rounded-xl p-5 space-y-4" style={cardStyle}>
            <div className="flex items-center justify-between">
              <h2 id="add-directive-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Add directive / consent</h2>
              <button className="p-1 rounded" disabled={busy} onClick={() => setAdding(false)} style={{ color: 'var(--text-muted)' }} aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
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
            <div className="flex items-center justify-end gap-2 pt-1">
              <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setAdding(false)}>Cancel</button>
              <button
                className="btn btn-sm btn-primary"
                disabled={busy || !addForm.description.trim()}
                onClick={() => run(async () => {
                  const svc = await import('@/lib/services/directive-service');
                  await svc.addDirective(patient._id, { ...addForm, description: addForm.description.trim(), ...author });
                }, () => setAdding(false), 'Directive recorded')}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Edit (unsigned only) ── */}
      {editing && (
        <Modal onClose={() => !busy && setEditing(null)} width={480} labelledBy="edit-directive-title">
          <div className="rounded-xl p-5 space-y-4" style={cardStyle}>
            <div className="flex items-center justify-between">
              <h2 id="edit-directive-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Edit directive</h2>
              <button className="p-1 rounded" disabled={busy} onClick={() => setEditing(null)} style={{ color: 'var(--text-muted)' }} aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
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
            <div className="flex items-center justify-end gap-2 pt-1">
              <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
              <button
                className="btn btn-sm btn-primary"
                disabled={busy || !editForm.description.trim()}
                onClick={() => run(async () => {
                  const svc = await import('@/lib/services/directive-service');
                  await svc.updateDirective(patient._id, editing.id, {
                    type: editForm.type,
                    description: editForm.description.trim(),
                    startDate: editForm.startDate || undefined,
                  });
                }, () => setEditing(null), 'Directive updated')}
              >
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Signature ── */}
      {signing && (
        <Modal onClose={() => !busy && setSigning(null)} width={460} labelledBy="sign-dir-title">
          <div className="rounded-xl p-5 space-y-4" style={cardStyle}>
            <div className="flex items-center justify-between">
              <h2 id="sign-dir-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Take signature</h2>
              <button className="p-1 rounded" disabled={busy} onClick={() => setSigning(null)} style={{ color: 'var(--text-muted)' }} aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
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
            <div className="flex items-center justify-end gap-2 pt-1">
              <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setSigning(null)}>Cancel</button>
              <button
                className="btn btn-sm btn-primary"
                disabled={busy || !signForm.name.trim() || (signForm.signedBy !== 'patient' && !signForm.relationship.trim())}
                onClick={() => run(async () => {
                  const svc = await import('@/lib/services/directive-service');
                  await svc.signDirective(patient._id, signing.id, {
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
            </div>
          </div>
        </Modal>
      )}

      {/* ── Revoke ── */}
      {revoking && (
        <Modal onClose={() => !busy && setRevoking(null)} width={440} labelledBy="revoke-dir-title">
          <div className="rounded-xl p-5 space-y-4" style={cardStyle}>
            <div className="flex items-center justify-between">
              <h2 id="revoke-dir-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Revoke directive</h2>
              <button className="p-1 rounded" disabled={busy} onClick={() => setRevoking(null)} style={{ color: 'var(--text-muted)' }} aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              Revoke <strong>{typeLabel(revoking.type)}</strong>? The entry is kept with its reason — consent history
              is never deleted.
            </p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dir-reason" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Reason (required)</label>
              <input id="dir-reason" autoFocus value={revokeReason} onChange={e => setRevokeReason(e.target.value)} className={fieldCls} style={fieldStyle} />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setRevoking(null)}>Cancel</button>
              <button
                className="btn btn-sm btn-primary"
                disabled={busy || !revokeReason.trim()}
                onClick={() => run(async () => {
                  const svc = await import('@/lib/services/directive-service');
                  await svc.removeDirective(patient._id, revoking.id, revokeReason.trim());
                }, () => setRevoking(null), 'Directive revoked')}
              >
                {busy ? 'Saving…' : 'Revoke'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

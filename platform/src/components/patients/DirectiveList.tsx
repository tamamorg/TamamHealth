'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/context';
import type { PatientDoc } from '@/lib/db-types';
import type { DirectiveType } from '@/data/mock';
import type { DirectiveSignatory } from '@/lib/types/patient-clinical';
import { ShieldCheck, Plus, Edit3, Trash2, X, Lock, Pencil } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { formatDateTime } from '@/lib/format-utils';

const TYPE_LABELS: Record<DirectiveType, string> = {
  informed_consent:      'Informed consent',
  abn_noncovered:        'Non-covered service (ABN)',
  privacy_consent:       'Privacy / communication consent',
  advance_directive:     'Advance directive',
  release_of_information:'Release of information',
  other:                 'Other',
};

const TYPE_OPTIONS = Object.keys(TYPE_LABELS) as DirectiveType[];

const EMPTY_FORM = { type: 'informed_consent' as DirectiveType, description: '', startDate: '' };

const SIGNATORY_LABELS: Record<DirectiveSignatory, string> = {
  patient: 'The patient',
  guardian: 'Parent / legal guardian',
  next_of_kin: 'Next of kin',
  power_of_attorney: 'Power of attorney',
};
const SIGNATORY_OPTIONS = Object.keys(SIGNATORY_LABELS) as DirectiveSignatory[];

const EMPTY_SIGN_FORM = { name: '', signedBy: 'patient' as DirectiveSignatory, relationship: '' };

export default function DirectiveList({ patient, hideAddButton = false }: { patient: PatientDoc; hideAddButton?: boolean }) {
  const { currentUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingEntry, setEditingEntry] = useState<{ id: string; type: DirectiveType; description: string; startDate?: string } | null>(null);
  const [removingEntry, setRemovingEntry] = useState<{ id: string; type: DirectiveType; description: string } | null>(null);
  const [signingEntry, setSigningEntry] = useState<{ id: string; type: DirectiveType; description: string } | null>(null);
  const [signForm, setSignForm] = useState(EMPTY_SIGN_FORM);
  const [removalReason, setRemovalReason] = useState('');
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [editForm, setEditForm] = useState(EMPTY_FORM);

  const entries = patient.directives ?? [];
  const active = entries.filter((d) => d.status === 'active');
  const author = { recordedBy: currentUser?._id, recordedByName: currentUser?.name || currentUser?.username };
  const typeLabel = (t: DirectiveType) => TYPE_LABELS[t] || t;

  async function run(fn: () => Promise<unknown>, onDone?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  const inputCls = 'w-full p-2.5 rounded-md text-[13px]';
  const inputStyle = { background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' };
  const modalCard = { background: 'var(--bg-card)', border: '1px solid var(--border-light)' };

  return (
    <div className="w-full flex flex-col h-full">
      {/* Section header */}
      <div style={{ background: 'var(--overlay-subtle)', borderBottom: '1px solid var(--border-light)', padding: '0 20px', height: 36, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 6 }}>
          <ShieldCheck className="w-3 h-3" style={{ color: 'var(--accent-primary)' }} /> Directives &amp; consent
        </p>
        {!hideAddButton && (
          <button className="p-1 rounded transition-colors hover:bg-blue-50" disabled={busy} title="Add directive" onClick={() => { setAdding(true); setAddForm(EMPTY_FORM); setError(null); }} style={{ color: 'var(--accent-primary)' }}>
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto px-5 py-3 scrollbar-none">
        {active.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No directives on file.</p>
        )}
        <ul>
          {active.map((d) => (
            <li key={d.id} className="flex items-center gap-2 py-2 min-w-0 overflow-hidden group">
              <span className="text-[10px] font-semibold flex-shrink-0 whitespace-nowrap" style={{ color: 'var(--accent-primary)' }}>{typeLabel(d.type)}</span>
              <span className="text-[12px] truncate" style={{ color: 'var(--text-primary)' }}>{d.description}</span>
              {d.startDate && <span className="text-[10px] flex-shrink-0 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>· {d.startDate}</span>}
              {/* Recorded and signed are different facts, and only the second
                  authorises anything — so the row says which one it is rather
                  than letting an unsigned consent read as consent. */}
              {d.signature ? (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap"
                  style={{ background: 'rgba(21,121,92,0.12)', color: 'var(--color-success-text)' }}
                  title={`Signed by ${d.signature.name}${d.signature.signedBy === 'patient' ? '' : ` (${d.signature.relationship || d.signature.signedBy})`} · ${formatDateTime(d.signature.signedAt)}${d.signature.witnessName ? ` · witnessed by ${d.signature.witnessName}` : ''}`}
                >
                  <Lock className="w-2.5 h-2.5" /> Signed
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap"
                  style={{ background: 'rgba(252,211,77,0.18)', color: 'var(--color-warning-text)' }}
                >
                  Unsigned
                </span>
              )}
              <span className="flex-1" />
              <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {!d.signature && (
                  <button className="p-1 rounded transition-colors hover:bg-green-50" disabled={busy} title="Take signature" onClick={() => { setSigningEntry({ id: d.id, type: d.type, description: d.description }); setSignForm(EMPTY_SIGN_FORM); setError(null); }} style={{ color: 'var(--color-success-text)' }}>
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
                {/* A signed consent is not editable: changing what someone
                    attested to after the fact is exactly what the signature is
                    supposed to prevent. Revoke and take it again instead. */}
                {!d.signature && (
                  <button className="p-1 rounded transition-colors hover:bg-blue-50" disabled={busy} title="Edit" onClick={() => { setEditingEntry({ id: d.id, type: d.type, description: d.description, startDate: d.startDate }); setEditForm({ type: d.type, description: d.description, startDate: d.startDate ?? '' }); setError(null); }} style={{ color: 'var(--color-primary)' }}>
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button className="p-1 rounded transition-colors hover:bg-red-50" disabled={busy} title="Revoke" onClick={() => { setRemovingEntry({ id: d.id, type: d.type, description: d.description }); setRemovalReason(''); setError(null); }} style={{ color: 'var(--color-danger-text)' }}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Add modal */}
      {adding && (
        <Modal onClose={() => setAdding(false)} width={480} labelledBy="add-directive-title">
          <div className="rounded-xl p-5 space-y-4" style={modalCard}>
            <div className="flex items-center justify-between">
              <h2 id="add-directive-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Add Directive / Consent</h2>
              <button className="p-1 rounded hover:bg-red-50 transition-colors" onClick={() => setAdding(false)} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>Type</label>
              <Select value={addForm.type} onChange={(e) => setAddForm({ ...addForm, type: e.target.value as DirectiveType })} className="w-full p-2.5 rounded-md text-[12px]" style={inputStyle}>
                {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
              </Select>
            </div>
            <input autoFocus value={addForm.description} onChange={(e) => setAddForm({ ...addForm, description: e.target.value })} placeholder="Description (e.g. Consent to treat signed)" className={inputCls} style={inputStyle} />
            {error && <p className="text-[11px]" style={{ color: 'var(--color-danger-text)' }}>{error}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setAdding(false)}>Cancel</button>
              <button className="btn btn-sm btn-primary" disabled={busy || addForm.description.trim().length === 0} onClick={() => run(async () => { const svc = await import('@/lib/services/directive-service'); await svc.addDirective(patient._id, { ...addForm, ...author }); }, () => setAdding(false))}>Save directive</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit modal */}
      {editingEntry && (
        <Modal onClose={() => setEditingEntry(null)} width={480} labelledBy="edit-directive-title">
          <div className="rounded-xl p-5 space-y-4" style={modalCard}>
            <div className="flex items-center justify-between">
              <h2 id="edit-directive-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Edit Directive</h2>
              <button className="p-1 rounded hover:bg-red-50 transition-colors" onClick={() => setEditingEntry(null)} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>Type</label>
              <Select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value as DirectiveType })} className="w-full p-2.5 rounded-md text-[12px]" style={inputStyle}>
                {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
              </Select>
            </div>
            <input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} placeholder="Description" className={inputCls} style={inputStyle} />
            {error && <p className="text-[11px]" style={{ color: 'var(--color-danger-text)' }}>{error}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setEditingEntry(null)}>Cancel</button>
              <button className="btn btn-sm btn-primary" disabled={busy || editForm.description.trim().length === 0} onClick={() => run(async () => { const svc = await import('@/lib/services/directive-service'); await svc.updateDirective(patient._id, editingEntry.id, editForm); }, () => setEditingEntry(null))}>Save changes</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Signature capture. The witness is the signed-in user, taken from the
          session rather than typed — a witness who can be typed in is not a
          witness. */}
      {signingEntry && (
        <Modal onClose={() => !busy && setSigningEntry(null)} width={460} labelledBy="sign-directive-title">
          <div className="rounded-xl p-5 space-y-4" style={modalCard}>
            <div className="flex items-center justify-between">
              <h2 id="sign-directive-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Take signature</h2>
              <button className="p-1 rounded hover:bg-red-50 transition-colors" disabled={busy} onClick={() => setSigningEntry(null)} style={{ color: 'var(--text-muted)' }} aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              <strong>{typeLabel(signingEntry.type)}</strong> — {signingEntry.description}
            </p>
            <div className="flex flex-col gap-1">
              <label htmlFor="directive-signedby" className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>Who is signing</label>
              <Select
                id="directive-signedby"
                value={signForm.signedBy}
                onChange={(e) => setSignForm({ ...signForm, signedBy: e.target.value as DirectiveSignatory })}
                className="w-full p-2.5 rounded-md text-[12px]"
                style={inputStyle}
              >
                {SIGNATORY_OPTIONS.map((s) => <option key={s} value={s}>{SIGNATORY_LABELS[s]}</option>)}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="directive-signame" className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>Name as signed</label>
              <input
                id="directive-signame"
                autoFocus
                value={signForm.name}
                onChange={(e) => setSignForm({ ...signForm, name: e.target.value })}
                placeholder="Full name"
                className={inputCls}
                style={inputStyle}
              />
            </div>
            {signForm.signedBy !== 'patient' && (
              <div className="flex flex-col gap-1">
                <label htmlFor="directive-rel" className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>Relationship to the patient</label>
                <input
                  id="directive-rel"
                  value={signForm.relationship}
                  onChange={(e) => setSignForm({ ...signForm, relationship: e.target.value })}
                  placeholder="e.g. mother, legal guardian"
                  className={inputCls}
                  style={inputStyle}
                />
              </div>
            )}
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Witnessed by {author.recordedByName || 'the signed-in user'}. A signature cannot be edited afterwards —
              a consent taken in error is revoked and taken again.
            </p>
            {error && <p className="text-[11px]" style={{ color: 'var(--color-danger-text)' }}>{error}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setSigningEntry(null)}>Cancel</button>
              <button
                className="btn btn-sm btn-primary"
                disabled={busy || !signForm.name.trim() || (signForm.signedBy !== 'patient' && !signForm.relationship.trim())}
                onClick={() => run(async () => {
                  const svc = await import('@/lib/services/directive-service');
                  await svc.signDirective(patient._id, signingEntry.id, {
                    name: signForm.name,
                    signedBy: signForm.signedBy,
                    relationship: signForm.relationship,
                    witnessId: currentUser?._id,
                    witnessName: author.recordedByName,
                  });
                }, () => setSigningEntry(null))}
              >
                <Lock className="w-3.5 h-3.5" /> Record signature
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Revoke confirmation modal */}
      {removingEntry && (
        <Modal onClose={() => setRemovingEntry(null)} width={440} labelledBy="revoke-directive-title">
          <div className="rounded-xl p-5 space-y-4" style={modalCard}>
            <div className="flex items-center justify-between">
              <h2 id="revoke-directive-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Revoke Directive</h2>
              <button className="p-1 rounded hover:bg-red-50 transition-colors" onClick={() => setRemovingEntry(null)} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
            </div>
            <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              Revoke <strong>{typeLabel(removingEntry.type)}</strong>? A reason is required.
            </p>
            <input autoFocus value={removalReason} onChange={(e) => setRemovalReason(e.target.value)} placeholder="Reason for revoking" className={inputCls} style={inputStyle} />
            {error && <p className="text-[11px]" style={{ color: 'var(--color-danger-text)' }}>{error}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setRemovingEntry(null)}>Cancel</button>
              <button className="btn btn-sm" disabled={busy || removalReason.trim().length === 0} onClick={() => run(async () => { const svc = await import('@/lib/services/directive-service'); await svc.removeDirective(patient._id, removingEntry.id, removalReason); }, () => setRemovingEntry(null))} style={{ background: 'var(--color-danger)', color: '#fff', borderRadius: 8, padding: '6px 16px', fontSize: 13 }}>Confirm revocation</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/context';
import type { PatientDoc } from '@/lib/db-types';
import type { AllergyEntry } from '@/data/mock';
import { AlertTriangle, Plus, Edit3, Trash2, X } from '@/components/icons/lucide';
import { isNoAllergySentinel } from '@/lib/clinical-roles';
import Modal from '@/components/Modal';
import AddAllergyModal from '@/components/patients/AddAllergyModal';
import Select from '@/components/Select';

const CRIT_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  severe:   { bg: 'var(--color-danger-bg, rgba(224, 49, 39,0.12))', fg: 'var(--color-danger-text)',  label: 'Severe'   },
  moderate: { bg: 'rgba(230, 114, 0,0.12)',                         fg: 'var(--color-warning-text)',              label: 'Moderate' },
  mild:     { bg: 'rgba(10, 110, 74,0.12)',                         fg: 'var(--color-success-text)', label: 'Mild'     },
  unknown:  { bg: 'var(--overlay-subtle)',                        fg: 'var(--text-muted)',    label: 'Unknown'  },
};

const CLASSIFICATIONS: AllergyEntry['classification'][] = ['drug', 'food', 'environmental', 'biologic', 'other'];
const CRITICALITIES: NonNullable<AllergyEntry['criticality']>[] = ['mild', 'moderate', 'severe', 'unknown'];

const EMPTY_FORM = { substance: '', classification: 'drug' as AllergyEntry['classification'], criticality: 'unknown' as NonNullable<AllergyEntry['criticality']>, reaction: '', onsetDate: '' };

export default function AllergyList({ patient, hideAddButton = false }: { patient: PatientDoc; hideAddButton?: boolean }) {
  const { currentUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingEntry, setEditingEntry] = useState<AllergyEntry | null>(null);
  const [removingEntry, setRemovingEntry] = useState<AllergyEntry | null>(null);
  const [removalReason, setRemovalReason] = useState('');
  const [editForm, setEditForm] = useState(EMPTY_FORM);

  const entries = useMemo<AllergyEntry[]>(() => {
    if (patient.structuredAllergies !== undefined) return patient.structuredAllergies;
    return (patient.allergies || [])
      .filter((a) => a && !isNoAllergySentinel(a))
      .map((substance) => ({ id: substance, substance, criticality: 'unknown' as const, status: 'active' as const, recordedAt: '' }));
  }, [patient.structuredAllergies, patient.allergies]);

  const active = entries.filter((e) => e.status === 'active');
  const author = { recordedBy: currentUser?._id, recordedByName: currentUser?.name || currentUser?.username };

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

  function openEdit(a: AllergyEntry) {
    setEditingEntry(a);
    setEditForm({ substance: a.substance, classification: a.classification ?? 'drug', criticality: a.criticality ?? 'unknown', reaction: a.reaction ?? '', onsetDate: a.onsetDate ?? '' });
    setError(null);
  }

  function openRemove(a: AllergyEntry) {
    setRemovingEntry(a);
    setRemovalReason('');
    setError(null);
  }

  const inputCls = 'w-full p-2.5 rounded-md text-[13px]';
  const inputStyle = { background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' };
  const modalCard = { background: 'var(--bg-card)', border: '1px solid var(--border-light)' };

  return (
    <div className="w-full flex flex-col h-full">
      {/* Section header */}
      <div style={{ background: 'var(--overlay-subtle)', borderBottom: '1px solid var(--border-light)', padding: '0 20px', height: 36, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle className="w-3 h-3" style={{ color: 'var(--color-danger)' }} /> Allergies
        </p>
        {!hideAddButton && (
          <button className="p-1 rounded transition-colors hover:bg-blue-50" disabled={busy} title="Add allergy" onClick={() => { setAdding(true); setError(null); }} style={{ color: 'var(--accent-primary)' }}>
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto px-5 py-3 scrollbar-none">
        {active.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No known allergies recorded.</p>
        )}
        <ul>
          {active.map((a) => {
            const cs = CRIT_STYLE[a.criticality || 'unknown'] || CRIT_STYLE.unknown;
            return (
              <li key={a.id} className="flex items-center gap-2 py-2 min-w-0 overflow-hidden group">
                <span className="text-[12px] font-semibold flex-shrink-0" style={{ color: 'var(--text-primary)' }}>{a.substance}</span>
                <span className="text-[12px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{cs.label}</span>
                {a.classification && <span className="text-[12px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>· {a.classification}</span>}
                {a.reaction && <span className="text-[12px] truncate" style={{ color: 'var(--text-muted)' }}>· {a.reaction}</span>}
                <span className="flex-1" />
                {a.recordedAt && (
                  <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="p-1 rounded transition-colors hover:bg-blue-50" disabled={busy} title="Edit" onClick={() => openEdit(a)} style={{ color: 'var(--color-primary)' }}>
                      <Edit3 className="w-3 h-3" />
                    </button>
                    <button className="p-1 rounded transition-colors hover:bg-red-50" disabled={busy} title="Remove" onClick={() => openRemove(a)} style={{ color: 'var(--color-danger-text)' }}>
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Add modal */}
      {adding && (
        <AddAllergyModal
          onClose={() => setAdding(false)}
          onSave={async input => {
            const svc = await import('@/lib/services/allergy-service');
            await svc.addAllergy(patient._id, { ...input, ...author });
          }}
        />
      )}

      {/* Edit modal */}
      {editingEntry && (
        <Modal onClose={() => setEditingEntry(null)} width={480} labelledBy="edit-allergy-title">
          <div className="rounded-xl p-5 space-y-4" style={modalCard}>
            <div className="flex items-center justify-between">
              <h2 id="edit-allergy-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Edit Allergy</h2>
              <button className="p-1 rounded hover:bg-red-50 transition-colors" onClick={() => setEditingEntry(null)} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
            </div>
            <input value={editForm.substance} onChange={(e) => setEditForm({ ...editForm, substance: e.target.value })} placeholder="Substance" className={inputCls} style={inputStyle} />
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Classification</label>
                <Select value={editForm.classification} onChange={(e) => setEditForm({ ...editForm, classification: e.target.value as AllergyEntry['classification'] })} className="p-2.5 rounded-md text-[12px]" style={inputStyle}>
                  {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Criticality</label>
                <Select value={editForm.criticality} onChange={(e) => setEditForm({ ...editForm, criticality: e.target.value as NonNullable<AllergyEntry['criticality']> })} className="p-2.5 rounded-md text-[12px]" style={inputStyle}>
                  {CRITICALITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </div>
            </div>
            <input value={editForm.reaction} onChange={(e) => setEditForm({ ...editForm, reaction: e.target.value })} placeholder="Reaction" className={inputCls} style={inputStyle} />
            {error && <p className="text-[11px]" style={{ color: 'var(--color-danger-text)' }}>{error}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setEditingEntry(null)}>Cancel</button>
              <button className="btn btn-sm btn-primary" disabled={busy || editForm.substance.trim().length === 0} onClick={() => run(async () => { const svc = await import('@/lib/services/allergy-service'); await svc.updateAllergy(patient._id, editingEntry.id, editForm); }, () => setEditingEntry(null))}>Save changes</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Remove confirmation modal */}
      {removingEntry && (
        <Modal onClose={() => setRemovingEntry(null)} width={440} labelledBy="remove-allergy-title">
          <div className="rounded-xl p-5 space-y-4" style={modalCard}>
            <div className="flex items-center justify-between">
              <h2 id="remove-allergy-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Remove Allergy</h2>
              <button className="p-1 rounded hover:bg-red-50 transition-colors" onClick={() => setRemovingEntry(null)} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
            </div>
            <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              Remove <strong>{removingEntry.substance}</strong> from the allergy list? A reason is required.
            </p>
            <input autoFocus value={removalReason} onChange={(e) => setRemovalReason(e.target.value)} placeholder="Reason for removal" className={inputCls} style={inputStyle} />
            {error && <p className="text-[11px]" style={{ color: 'var(--color-danger-text)' }}>{error}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setRemovingEntry(null)}>Cancel</button>
              <button className="btn btn-sm" disabled={busy || removalReason.trim().length === 0} onClick={() => run(async () => { const svc = await import('@/lib/services/allergy-service'); await svc.removeAllergy(patient._id, removingEntry.id, removalReason); }, () => setRemovingEntry(null))} style={{ background: 'var(--color-danger)', color: '#fff', borderRadius: 8, padding: '6px 16px', fontSize: 13 }}>Confirm removal</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

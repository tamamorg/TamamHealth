'use client';

/**
 * Allergies tab content — OpenMRS-style table (Allergen / Severity /
 * Reaction / Comments). Reuses the SAME data derivation AllergyList uses
 * (`patient.structuredAllergies`, falling back to the legacy
 * `patient.allergies` string list) and the SAME service calls
 * (`allergy-service` addAllergy / updateAllergy / removeAllergy) — no new data
 * layer.
 *
 * The section is read+add+CORRECT: a wrong allergen used to be permanent
 * anywhere on the desktop chart, because the only edit/retire UI
 * (`AllergyList`) is reachable from the mobile facesheet alone. An allergy is
 * the one field on this chart that changes what is safe to prescribe, so it
 * has to be correctable where it is read.
 *
 * Retired entries are never hard-deleted (the service requires a reason and
 * flips the status), and they stay readable behind the "Show inactive" toggle —
 * "we removed this, and here is why" is itself clinical information.
 */

import { useEffect, useMemo, useState } from 'react';
import ChartSection, { OmrsEmptyState } from '../ChartSection';
import AddAllergyModal from '@/components/patients/AddAllergyModal';
import Modal from '@/components/Modal';
import RowActionsMenu, { type RowAction } from '@/components/RowActionsMenu';
import Select from '@/components/Select';
import { Edit3, Trash2, RotateCcw, X } from '@/components/icons/lucide';
import { useToast } from '@/components/Toast';
import { isNoAllergySentinel } from '@/lib/clinical-roles';
import { useAuth } from '@/lib/context';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { formatDate } from '@/lib/format-utils';
import type { PatientDoc } from '@/lib/db-types';
import type { AllergyEntry } from '@/data/mock';

const SEVERITY_LABEL: Record<string, string> = {
  severe: 'Severe', moderate: 'Moderate', mild: 'Mild', unknown: 'Unknown',
};

/** Severity is the field a prescriber acts on, so it is graded rather than set
 *  in the same grey as everything else — severe reads as severe at a glance. */
const SEVERITY_BADGE: Record<string, string> = {
  severe: 'omrs-sev omrs-sev--severe',
  moderate: 'omrs-sev omrs-sev--moderate',
  mild: 'omrs-sev omrs-sev--mild',
  unknown: 'omrs-sev omrs-sev--unknown',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  inactive: 'Inactive',
  resolved: 'Resolved',
  entered_in_error: 'Entered in error',
};

const STATUS_BADGE: Record<string, string> = {
  active: 'omrs-panel-badge omrs-panel-badge--active',
  inactive: 'omrs-panel-badge omrs-panel-badge--muted',
  resolved: 'omrs-panel-badge omrs-panel-badge--done',
  entered_in_error: 'omrs-panel-badge omrs-panel-badge--muted',
};

const CLASSIFICATIONS: AllergyEntry['classification'][] = ['drug', 'food', 'environmental', 'biologic', 'other'];
const CRITICALITIES: NonNullable<AllergyEntry['criticality']>[] = ['mild', 'moderate', 'severe', 'unknown'];

const EMPTY_EDIT = {
  substance: '',
  classification: 'drug' as AllergyEntry['classification'],
  criticality: 'unknown' as NonNullable<AllergyEntry['criticality']>,
  reaction: '',
  onsetDate: '',
};

const fieldStyle = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-light)',
  color: 'var(--text-primary)',
} as const;
const fieldCls = 'w-full p-2.5 rounded-md text-[13px]';

interface AllergiesSectionProps {
  patient: PatientDoc;
  /** One-shot request from the chart (e.g. the Facesheet Allergies card's
   *  "Add") to open the add-allergy modal as soon as this tab mounts. */
  autoOpenAdd?: boolean;
  onAutoOpenHandled?: () => void;
}

export default function AllergiesSection({ patient, autoOpenAdd, onAutoOpenHandled }: AllergiesSectionProps) {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  // Recording an allergy is a clinical write like Conditions/Problems — gate
  // it the same way rather than leaving the Add button open to every viewer
  // who can reach this tab (e.g. a lab technician on the labs+overview set
  // never sees this tab at all, but a front-desk role deep-linked here would).
  const { canEditClinical } = usePermissions();
  const [adding, setAdding] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<AllergyEntry | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT);
  const [retiring, setRetiring] = useState<AllergyEntry | null>(null);
  const [retireReason, setRetireReason] = useState('');
  const [retireStatus, setRetireStatus] = useState<'inactive' | 'resolved' | 'entered_in_error'>('inactive');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (autoOpenAdd) {
      setAdding(true);
      onAutoOpenHandled?.();
    }
  }, [autoOpenAdd, onAutoOpenHandled]);

  const entries = useMemo<AllergyEntry[]>(() => {
    if (patient.structuredAllergies !== undefined) return patient.structuredAllergies;
    return (patient.allergies || [])
      .filter(a => a && !isNoAllergySentinel(a))
      .map(substance => ({ id: substance, substance, criticality: 'unknown' as const, status: 'active' as const, recordedAt: '' }));
  }, [patient.structuredAllergies, patient.allergies]);

  const active = entries.filter(e => e.status === 'active');
  const inactive = entries.filter(e => e.status !== 'active');
  const rows = showInactive ? [...active, ...inactive] : active;
  const author = { recordedBy: currentUser?._id, recordedByName: currentUser?.name || currentUser?.username };

  /** Legacy string-list entries have no stable id to write against — each id is
   *  synthesised from the substance itself — so they can be read but not edited
   *  until the patient's list is migrated by the first structured write. The
   *  whole list is one or the other, so this is a per-patient fact. */
  const rowsAreEditable = patient.structuredAllergies !== undefined;

  const openEdit = (a: AllergyEntry) => {
    setEditing(a);
    setEditForm({
      substance: a.substance,
      classification: a.classification ?? 'drug',
      criticality: a.criticality ?? 'unknown',
      reaction: a.reaction ?? '',
      onsetDate: a.onsetDate ?? '',
    });
  };

  const saveEdit = async () => {
    if (!editing || !editForm.substance.trim()) return;
    setBusy(true);
    try {
      const svc = await import('@/lib/services/allergy-service');
      await svc.updateAllergy(patient._id, editing.id, { ...editForm, substance: editForm.substance.trim(), ...author });
      showToast('Allergy updated', 'success');
      setEditing(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update this allergy.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmRetire = async () => {
    if (!retiring || !retireReason.trim()) return;
    setBusy(true);
    try {
      const svc = await import('@/lib/services/allergy-service');
      await svc.removeAllergy(patient._id, retiring.id, retireReason.trim(), retireStatus);
      showToast(`${retiring.substance} marked ${retireStatus.replace(/_/g, ' ')}`, 'success');
      setRetiring(null);
      setRetireReason('');
      setRetireStatus('inactive');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not retire this allergy.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const reactivate = async (a: AllergyEntry) => {
    setBusy(true);
    try {
      const svc = await import('@/lib/services/allergy-service');
      await svc.updateAllergy(patient._id, a.id, { status: 'active', removalReason: undefined, ...author });
      showToast(`${a.substance} reinstated`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not reinstate this allergy.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const rowActions = (a: AllergyEntry): RowAction[] => (
    a.status === 'active'
      ? [
          { key: 'edit', label: 'Edit', icon: <Edit3 className="w-3.5 h-3.5" />, disabled: busy, onClick: () => openEdit(a) },
          { key: 'retire', label: 'Retire', tone: 'danger', icon: <Trash2 className="w-3.5 h-3.5" />, disabled: busy, onClick: () => { setRetiring(a); setRetireReason(''); setRetireStatus('inactive'); } },
        ]
      : [
          { key: 'reactivate', label: 'Reinstate', icon: <RotateCcw className="w-3.5 h-3.5" />, disabled: busy, onClick: () => void reactivate(a) },
        ]
  );

  const filterSlot = inactive.length > 0 ? (
    <label className="omrs-section-filter">
      <input
        type="checkbox"
        checked={showInactive}
        onChange={e => setShowInactive(e.target.checked)}
      />
      Show inactive ({inactive.length})
    </label>
  ) : undefined;

  return (
    <>
      <ChartSection
        title="Allergies"
        addLabel="Add"
        onAdd={canEditClinical ? () => setAdding(true) : undefined}
        filterSlot={filterSlot}
      >
        {active.length === 0 && !showInactive && patient.noKnownDrugAllergies ? (
          // An empty list and a recorded "none" are not the same fact. Empty
          // means nobody has asked; NKDA means someone asked and the answer
          // was none — and a prescriber deciding on an antibiotic needs to
          // know which of the two they are looking at.
          <p className="omrs-attestation">
            <strong>No known drug allergies.</strong> Recorded at a medication review.
          </p>
        ) : rows.length === 0 ? (
          <OmrsEmptyState
            itemLabel="allergies"
            actionLabel="Record allergies"
            onAction={canEditClinical ? () => setAdding(true) : undefined}
            disabledReason={canEditClinical ? undefined : 'Requires clinical-editing permission'}
          />
        ) : (
          <table className="omrs-table omrs-table--allergies">
            <colgroup>
              <col style={{ width: '22%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '26%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '20%' }} />
              {canEditClinical && <col style={{ width: '7%' }} />}
            </colgroup>
            <thead>
              <tr>
                <th>Allergen</th>
                <th>Severity</th>
                <th>Reaction</th>
                <th>Status</th>
                <th>Comments</th>
                {canEditClinical && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {rows.map(a => {
                const severity = a.criticality || 'unknown';
                return (
                  <tr key={a.id} className={a.status === 'active' ? undefined : 'is-retired'}>
                    <td className="omrs-cell-strong">{a.substance}</td>
                    <td>
                      <span className={SEVERITY_BADGE[severity] || SEVERITY_BADGE.unknown}>
                        {SEVERITY_LABEL[severity]}
                      </span>
                    </td>
                    <td>{a.reaction || '—'}</td>
                    <td>
                      {/* Status is its own column now. As an inline badge after
                          the allergen it was easy to miss the one thing that
                          decides whether the row still applies to the patient. */}
                      <span className={STATUS_BADGE[a.status] || STATUS_BADGE.inactive}>
                        {STATUS_LABEL[a.status] || a.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td>
                      <span className="omrs-cell-cap">
                        {a.status !== 'active' && a.removalReason
                          ? <span className="omrs-cell-note">Retired: {a.removalReason}</span>
                          : a.classification || '—'}
                      </span>
                      {a.onsetDate && <div className="omrs-cell-sub">Onset {formatDate(a.onsetDate)}</div>}
                    </td>
                    {canEditClinical && (
                      <td className="omrs-cell-actions">
                        {rowsAreEditable && (
                          <RowActionsMenu ariaLabel={`Actions for ${a.substance}`} actions={rowActions(a)} />
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </ChartSection>

      {adding && (
        <AddAllergyModal
          patientId={patient._id}
          onClose={() => setAdding(false)}
          onSave={async input => {
            const svc = await import('@/lib/services/allergy-service');
            await svc.addAllergy(patient._id, { ...input, ...author });
          }}
        />
      )}

      {editing && (
        <Modal onClose={() => !busy && setEditing(null)} width={480} labelledBy="edit-allergy-title">
          <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center justify-between">
              <h2 id="edit-allergy-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Edit allergy</h2>
              <button className="p-1 rounded" disabled={busy} onClick={() => setEditing(null)} style={{ color: 'var(--text-muted)' }} aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="allergy-substance" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Allergen</label>
              <input id="allergy-substance" value={editForm.substance} onChange={e => setEditForm({ ...editForm, substance: e.target.value })} className={fieldCls} style={fieldStyle} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="allergy-class" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Classification</label>
                <Select id="allergy-class" value={editForm.classification} onChange={e => setEditForm({ ...editForm, classification: e.target.value as AllergyEntry['classification'] })}>
                  {CLASSIFICATIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="allergy-crit" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Severity</label>
                <Select id="allergy-crit" value={editForm.criticality} onChange={e => setEditForm({ ...editForm, criticality: e.target.value as NonNullable<AllergyEntry['criticality']> })}>
                  {CRITICALITIES.map(c => <option key={c} value={c}>{SEVERITY_LABEL[c]}</option>)}
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="allergy-reaction" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Reaction</label>
              <input id="allergy-reaction" value={editForm.reaction} onChange={e => setEditForm({ ...editForm, reaction: e.target.value })} className={fieldCls} style={fieldStyle} />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-sm btn-primary" disabled={busy || !editForm.substance.trim()} onClick={saveEdit}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {retiring && (
        <Modal onClose={() => !busy && setRetiring(null)} width={440} labelledBy="retire-allergy-title">
          <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center justify-between">
              <h2 id="retire-allergy-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Retire allergy</h2>
              <button className="p-1 rounded" disabled={busy} onClick={() => setRetiring(null)} style={{ color: 'var(--text-muted)' }} aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              Take <strong>{retiring.substance}</strong> off the active allergy list. The entry is kept with its
              reason — allergies are never deleted outright.
            </p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="retire-status" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Why</label>
              <Select id="retire-status" value={retireStatus} onChange={e => setRetireStatus(e.target.value as typeof retireStatus)}>
                <option value="inactive">No longer active</option>
                <option value="resolved">Resolved — retested and tolerated</option>
                <option value="entered_in_error">Entered in error</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="retire-reason" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Reason (required)</label>
              <input
                id="retire-reason"
                autoFocus
                value={retireReason}
                onChange={e => setRetireReason(e.target.value)}
                placeholder="e.g. Negative challenge test on 12 Aug"
                className={fieldCls}
                style={fieldStyle}
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setRetiring(null)}>Cancel</button>
              <button className="btn btn-sm btn-primary" disabled={busy || !retireReason.trim()} onClick={confirmRetire}>
                {busy ? 'Saving…' : 'Retire allergy'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

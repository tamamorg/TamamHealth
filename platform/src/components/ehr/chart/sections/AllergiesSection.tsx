'use client';

/**
 * Allergies tab content — Tamam-style table (Allergen / Severity /
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
import FormSlider from '@/components/overlay/FormSlider';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import Select from '@/components/Select';
import { useToast } from '@/components/Toast';
import { isNoAllergySentinel } from '@/lib/clinical-roles';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { formatDate } from '@/lib/format-utils';
import type { PatientDoc } from '@/lib/db-types';
import type { AllergyEntry } from '@/data/mock';
import RowActionsMenu from '@/components/RowActionsMenu';
import { describeError } from '@/lib/user-facing-error';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { statusWord } from '@/lib/i18n/status-word';

const SEVERITY_LABEL: Record<string, string> = {
  severe: 'Severe', moderate: 'Moderate', mild: 'Mild', unknown: 'Unknown',
};

/** Severity is the field a prescriber acts on, so it is graded rather than set
 *  in the same grey as everything else — severe reads as severe at a glance. */
const SEVERITY_BADGE: Record<string, string> = {
  severe: 'tamam-sev tamam-sev--severe',
  moderate: 'tamam-sev tamam-sev--moderate',
  mild: 'tamam-sev tamam-sev--mild',
  unknown: 'tamam-sev tamam-sev--unknown',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  inactive: 'Inactive',
  resolved: 'Resolved',
  entered_in_error: 'Entered in error',
};

const STATUS_BADGE: Record<string, string> = {
  active: 'tamam-panel-badge tamam-panel-badge--active',
  inactive: 'tamam-panel-badge tamam-panel-badge--muted',
  resolved: 'tamam-panel-badge tamam-panel-badge--done',
  entered_in_error: 'tamam-panel-badge tamam-panel-badge--muted',
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
  /** Deep-link focus: the allergy `id` to scroll to and highlight. */
  focusId?: string;
}

export default function AllergiesSection({ patient, autoOpenAdd, onAutoOpenHandled, focusId }: AllergiesSectionProps) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const needScope = () => {
    if (!scope) throw new Error('Your account is not linked to an organization. Sign in again, or contact your administrator.');
    return scope;
  };
  const { showToast } = useToast();
  // Recording an allergy is clinical intake: clinicians and the nursing roles
  // who take it at triage and on the ward (the same set the `patient` sync row
  // accepts). Still gated rather than open to every viewer who can reach this
  // tab — a front-desk role deep-linked here does not get the Add button.
  const { canRecordAllergies } = usePermissions();
  const [adding, setAdding] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<AllergyEntry | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT);
  const [retiring, setRetiring] = useState<AllergyEntry | null>(null);
  const [retireReason, setRetireReason] = useState('');
  const [retireStatus, setRetireStatus] = useState<'inactive' | 'resolved' | 'entered_in_error'>('inactive');
  const [busy, setBusy] = useState(false);
  const [tableSearch, setTableSearch] = useState('');

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
  const visibleByStatus = showInactive ? [...active, ...inactive] : active;
  const query = tableSearch.trim().toLowerCase();
  const rows = query
    ? visibleByStatus.filter(a => `${a.substance} ${a.reaction || ''} ${a.classification || ''} ${a.criticality || ''} ${a.status}`.toLowerCase().includes(query))
    : visibleByStatus;
  // Deep-link focus: reveal a retired allergy if that is what was linked, then
  // scroll the row into view once it is rendered.
  useEffect(() => {
    if (!focusId) return;
    const target = entries.find(e => e.id === focusId);
    if (target && target.status !== 'active') setShowInactive(true);
  }, [focusId, entries]);

  useEffect(() => {
    if (!focusId) return;
    document.getElementById(`allergy-row-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusId, showInactive, entries]);

  const author = { recordedBy: currentUser?._id, recordedByName: currentUser?.name || currentUser?.username };
  // Edits and reinstatements are stamped as an update, never as a new
  // recording: overwriting recordedBy re-attributed the allergy to whoever
  // last touched it, beside the ORIGINAL recordedAt date.
  const editor = { updatedBy: currentUser?._id, updatedByName: currentUser?.name || currentUser?.username };

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
      // null: the entry is no longer on the record (retired elsewhere).
      if (!(await svc.updateAllergy(patient._id, needScope(), editing.id, { ...editForm, substance: editForm.substance.trim(), ...editor }))) throw new Error('Change not saved. Try again.');
      showToast(t('msg.allergyUpdated'), 'success');
      setEditing(null);
    } catch (err) {
      showToast(describeError(err, t('msg.allergyNotUpdatedTryAgain')), 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmRetire = async () => {
    if (!retiring || !retireReason.trim()) return;
    setBusy(true);
    try {
      const svc = await import('@/lib/services/allergy-service');
      if (!(await svc.removeAllergy(patient._id, needScope(), retiring.id, retireReason.trim(), retireStatus, { id: editor.updatedBy, name: editor.updatedByName }))) throw new Error('Change not saved. Try again.');
      showToast(t('msg.allergyMarked', { substance: retiring.substance, value: statusWord(t, retireStatus) }), 'success');
      setRetiring(null);
      setRetireReason('');
      setRetireStatus('inactive');
    } catch (err) {
      showToast(describeError(err, t('msg.allergyStatusNotChangedTry')), 'error');
    } finally {
      setBusy(false);
    }
  };

  const reactivate = async (a: AllergyEntry) => {
    setBusy(true);
    try {
      const svc = await import('@/lib/services/allergy-service');
      if (!(await svc.updateAllergy(patient._id, needScope(), a.id, { status: 'active', removalReason: undefined, ...editor }))) throw new Error('Change not saved. Try again.');
      showToast(t('msg.allergyReinstated', { substance: a.substance }), 'success');
    } catch (err) {
      showToast(describeError(err, t('msg.allergyNotReinstatedTryAgain')), 'error');
    } finally {
      setBusy(false);
    }
  };

  const filterSlot = inactive.length > 0 ? (
    <label className="tamam-section-filter">
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
        onAdd={canRecordAllergies ? () => setAdding(true) : undefined}
        filterSlot={filterSlot}
        searchValue={tableSearch}
        onSearchChange={setTableSearch}
      >
        {active.length === 0 && !showInactive && patient.noKnownDrugAllergies ? (
          // An empty list and a recorded "none" are not the same fact. Empty
          // means nobody has asked; NKDA means someone asked and the answer
          // was none — and a prescriber deciding on an antibiotic needs to
          // know which of the two they are looking at.
          <p className="tamam-attestation">
            <strong>No known drug allergies.</strong> Recorded at a medication review.
          </p>
        ) : (
          <table className="tamam-table tamam-table--fixed tamam-table--interactive tamam-table--allergies">
            <colgroup>
              <col /><col /><col /><col /><col /><col />
            </colgroup>
            <thead>
              <tr>
                <th>Allergen</th>
                <th>Severity</th>
                <th>Reaction</th>
                <th>Comments</th>
                <th>Status</th>
                <th>{t('chart.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ cursor: 'default', background: 'transparent' }}>
                    <OmrsEmptyState
                      itemLabel="allergies"
                      actionLabel="Record allergies"
                      onAction={canRecordAllergies ? () => setAdding(true) : undefined}
                      disabledReason={canRecordAllergies ? undefined : 'Requires clinical-editing permission'}
                    />
                  </td>
                </tr>
              )}
              {rows.map(a => {
                const severity = a.criticality || 'unknown';
                return (
                  <tr
                    key={a.id}
                    id={`allergy-row-${a.id}`}
                    className={a.status === 'active' ? 'is-alert' : 'is-retired'}
                    style={a.id === focusId ? { background: 'var(--accent-light)', boxShadow: 'inset 3px 0 0 var(--accent-primary)' } : undefined}
                  >
                    <td className="tamam-cell-strong">{a.substance}</td>
                    <td>
                      <span className={SEVERITY_BADGE[severity] || SEVERITY_BADGE.unknown}>
                        {SEVERITY_LABEL[severity]}
                      </span>
                    </td>
                    <td>{a.reaction || '—'}</td>
                    <td>
                      <span className="tamam-cell-cap">
                        {a.status !== 'active' && a.removalReason
                          ? <span className="tamam-cell-note">Retired: {a.removalReason}</span>
                          : a.classification || '—'}
                      </span>
                      {a.onsetDate && <div className="tamam-cell-sub">Onset {formatDate(a.onsetDate)}</div>}
                    </td>
                    <td>
                      <span className={STATUS_BADGE[a.status] || STATUS_BADGE.inactive}>
                        {STATUS_LABEL[a.status] || a.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td>
                      {/* Every action lives in the ⋮; the row already shows
                          what a detail dialog would. */}
                      <RowActionsMenu
                      ariaLabel={t('chart.allergyRowActions', { name: a.substance })}
                      actions={[
                        ...(canRecordAllergies && rowsAreEditable
                          ? a.status === 'active'
                            ? [
                              { key: 'edit', label: t('chart.allergyEdit'), onClick: () => openEdit(a) },
                              { key: 'retire', label: t('chart.allergyRetire'), tone: 'danger' as const, onClick: () => { setRetiring(a); setRetireReason(''); setRetireStatus('inactive'); } },
                            ]
                            : [{ key: 'reinstate', label: t('chart.allergyReinstate'), onClick: () => void reactivate(a) }]
                          : []),
                      ]}
                    />
                    </td>
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
            await svc.addAllergy(patient._id, needScope(), { ...input, ...author });
          }}
        />
      )}

      {editing && (
        <FormSlider
          title="Edit allergy"
          className="tamam-dialog"
          width={480}
          onClose={() => !busy && setEditing(null)}
          busy={busy}
          footer={<>
              <button className="btn btn-secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy || !editForm.substance.trim()} onClick={saveEdit}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
          </>}
        >
          <div className="space-y-4">
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
          </div>
        </FormSlider>
      )}

      {retiring && (
        <Modal className="tamam-dialog" onClose={() => !busy && setRetiring(null)} width={440} labelledBy="retire-allergy-title">
          <DialogFrame busy={busy}>
            <DialogHeader titleId="retire-allergy-title" title="Retire allergy" onClose={() => !busy && setRetiring(null)} />
            <DialogBody className="space-y-4">
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
            </DialogBody>
            <DialogFooter>
              <button className="btn btn-secondary" disabled={busy} onClick={() => setRetiring(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy || !retireReason.trim()} onClick={confirmRetire}>
                {busy ? 'Saving…' : 'Retire allergy'}
              </button>
            </DialogFooter>
          </DialogFrame>
        </Modal>
      )}
    </>
  );
}

'use client';

/**
 * Allergies popup — opened by clicking the note's Allergies section. Same
 * chrome as the Medications and Problems popups: Active / Inactive tabs, the
 * NKDA attestation, "+ Allergy" add form (allergen catalog search + reaction,
 * severity, onset), and Discontinue / Reactivate / Mark as Error / Close.
 *
 * Entries are never hard-deleted: every removal records a reason and keeps the
 * entry under Inactive — an allergy history with silent gaps is how the next
 * prescriber makes the mistake this list exists to prevent.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, X } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import { useToast } from '@/components/Toast';
import CodedSearchField, { type CodedOption } from '@/components/CodedSearchField';
import { COMMON_ALLERGENS } from '@/data/allergens';
import type { AllergyEntry } from '@/lib/types/patient-clinical';
import type { PatientDoc } from '@/lib/db-types';
import './clinical-notes.css';
import Select from '@/components/Select';

type AllergyTab = 'active' | 'inactive';

const CRITICALITY_OPTIONS: Array<AllergyEntry['criticality'] & string> = ['mild', 'moderate', 'severe', 'unknown'];

function bucketOf(entry: AllergyEntry): AllergyTab | null {
  if (entry.status === 'active') return 'active';
  if (entry.status === 'entered_in_error') return null; // mistakes are not history
  return 'inactive';
}

interface AllergiesModalProps {
  patientId: string;
  currentUser: { _id: string; name?: string; username?: string } | null;
  onClose: () => void;
}

export default function AllergiesModal({ patientId, currentUser, onClose }: AllergiesModalProps) {
  const { showToast } = useToast();
  const userName = currentUser?.name || currentUser?.username || 'Unknown user';

  const [entries, setEntries] = useState<AllergyEntry[]>([]);
  const [patient, setPatient] = useState<PatientDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<AllergyTab>('active');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [draft, setDraft] = useState<{ substance: string; classification?: AllergyEntry['classification']; reaction: string; criticality: AllergyEntry['criticality']; onsetDate: string }>(
    { substance: '', reaction: '', criticality: 'unknown', onsetDate: '' },
  );

  const load = useCallback(async () => {
    const { getAllergies } = await import('@/lib/services/allergy-service');
    const { getPatientById } = await import('@/lib/services/patient-service');
    const [rows, pt] = await Promise.all([getAllergies(patientId), getPatientById(patientId)]);
    setEntries(rows);
    setPatient(pt);
    setLoading(false);
  }, [patientId]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<AllergyTab, number> = { active: 0, inactive: 0 };
    for (const e of entries) { const b = bucketOf(e); if (b) c[b] += 1; }
    return c;
  }, [entries]);

  const rows = useMemo(() => entries.filter(e => bucketOf(e) === tab), [entries, tab]);
  const selected = rows.find(e => e.id === selectedId) || null;

  const allergenOptions = useMemo<CodedOption[]>(
    () => COMMON_ALLERGENS.map(a => ({ code: a.classification, name: a.substance })),
    [],
  );

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (err) {
      showToast(err instanceof Error ? err.message : 'The change could not be saved.', 'error');
    } finally { setBusy(false); }
  };

  const handleAdd = () => withBusy(async () => {
    if (!draft.substance.trim()) { showToast('Pick or enter the allergen first.', 'error'); return; }
    const { addAllergy } = await import('@/lib/services/allergy-service');
    const next = await addAllergy(patientId, {
      substance: draft.substance,
      classification: draft.classification,
      criticality: draft.criticality,
      reaction: draft.reaction.trim() || undefined,
      onsetDate: draft.onsetDate || undefined,
      recordedBy: currentUser?._id,
      recordedByName: userName,
    });
    if (next) setEntries(next);
    showToast(`${draft.substance} recorded as an allergy.`, 'success');
    setDraft({ substance: '', reaction: '', criticality: 'unknown', onsetDate: '' });
    setAddQuery('');
    setShowAdd(false);
  });

  const handleRemove = (status: 'inactive' | 'resolved' | 'entered_in_error', verb: string) => selected && withBusy(async () => {
    const reason = status === 'entered_in_error'
      ? 'Entered in error'
      : (window.prompt(`Reason for marking ${selected.substance} ${verb}:`) ?? '').trim();
    if (!reason) { showToast('A reason is required.', 'error'); return; }
    const { removeAllergy } = await import('@/lib/services/allergy-service');
    const next = await removeAllergy(patientId, selected.id, reason, status);
    if (next) setEntries(next);
    showToast(`${selected.substance} marked ${verb}.`, 'success');
    setSelectedId(null);
  });

  const handleReactivate = () => selected && withBusy(async () => {
    const { updateAllergy } = await import('@/lib/services/allergy-service');
    const next = await updateAllergy(patientId, selected.id, { status: 'active', removalReason: undefined });
    if (next) setEntries(next);
    showToast(`${selected.substance} reactivated.`, 'success');
    setSelectedId(null);
  });

  const savePatient = (patch: Partial<PatientDoc>) => withBusy(async () => {
    const { updatePatient } = await import('@/lib/services/patient-service');
    const updated = await updatePatient(patientId, patch);
    if (updated) setPatient(updated);
  });

  return (
    <Modal onClose={onClose} width={760} labelledBy="cn-allergies-title">
      <div className="cn-meds">
        <div className="cn-meds-header">
          <h2 className="cn-meds-title" id="cn-allergies-title">Allergies</h2>
          <button type="button" className="cn-meds-close" onClick={onClose} aria-label="Close allergies">
            <X size={18} />
          </button>
        </div>

        <div className="cn-meds-body cn-meds-body--single">
          <div className="cn-meds-left">
            <div className="cn-meds-controlrow">
              <div className="cn-segmented" aria-label="Allergy lists">
                {(['active', 'inactive'] as AllergyTab[]).map(key => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={tab === key}
                    onClick={() => { setTab(key); setSelectedId(null); }}
                  >
                    {key === 'active' ? 'Active' : 'Inactive'}{counts[key] > 0 ? ` · ${counts[key]}` : ''}
                  </button>
                ))}
              </div>
              <div className="cn-meds-adders">
                <button type="button" className="cn-btn" onClick={() => setShowAdd(v => !v)} aria-expanded={showAdd}>
                  <Plus size={13} /> Allergy
                </button>
              </div>
            </div>

            <label className="cn-meds-nkm">
              <input
                type="checkbox"
                checked={Boolean(patient?.noKnownDrugAllergies)}
                disabled={busy || counts.active > 0}
                title={counts.active > 0 ? 'The patient has active allergies' : undefined}
                onChange={e => void savePatient({ noKnownDrugAllergies: e.target.checked })}
              />
              No known drug allergies
            </label>

            {showAdd && (
              <div className="cn-allergy-add">
                <CodedSearchField
                  label="Allergen"
                  placeholder="Search common allergens…"
                  options={allergenOptions}
                  value={addQuery}
                  onChange={setAddQuery}
                  showCodeBadge={false}
                  onSelect={(option) => {
                    setDraft(d => ({ ...d, substance: option.name, classification: option.code as AllergyEntry['classification'] }));
                    setAddQuery(option.name);
                  }}
                  onAddCustom={(text) => {
                    setDraft(d => ({ ...d, substance: text, classification: undefined }));
                    setAddQuery(text);
                  }}
                />
                <div className="cn-allergy-add-row">
                  <input
                    className="cn-input"
                    placeholder="Reaction (e.g. rash, anaphylaxis)"
                    value={draft.reaction}
                    onChange={e => setDraft(d => ({ ...d, reaction: e.target.value }))}
                    aria-label="Reaction"
                  />
                  <Select
                    className="cn-select"
                    value={draft.criticality || 'unknown'}
                    onChange={e => setDraft(d => ({ ...d, criticality: e.target.value as AllergyEntry['criticality'] }))}
                    aria-label="Severity"
                  >
                    {CRITICALITY_OPTIONS.map(c => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
                  </Select>
                  <input
                    type="date"
                    className="cn-input"
                    value={draft.onsetDate}
                    onChange={e => setDraft(d => ({ ...d, onsetDate: e.target.value }))}
                    aria-label="Onset date"
                  />
                  <button type="button" className="cn-btn cn-btn-primary" onClick={handleAdd} disabled={busy}>Add</button>
                </div>
              </div>
            )}

            <h3 className="cn-meds-listhead">{tab === 'active' ? 'Active Allergies' : 'Inactive Allergies'}</h3>
            <div className="cn-meds-list" role="listbox" aria-label={tab === 'active' ? 'Active allergies' : 'Inactive allergies'}>
              {loading && <p className="cn-card-empty">Loading allergies…</p>}
              {!loading && rows.length === 0 && (
                <p className="cn-card-empty">
                  {tab === 'active' && patient?.noKnownDrugAllergies
                    ? 'No known drug allergies recorded for this patient.'
                    : `No ${tab} allergies for this patient.`}
                </p>
              )}
              {rows.map(entry => (
                <div
                  key={entry.id}
                  role="option"
                  aria-selected={selectedId === entry.id}
                  tabIndex={0}
                  className={`cn-meds-row${selectedId === entry.id ? ' is-selected' : ''}`}
                  onClick={() => setSelectedId(prev => (prev === entry.id ? null : entry.id))}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedId(prev => (prev === entry.id ? null : entry.id));
                    }
                  }}
                >
                  <div className="cn-meds-row-main">
                    <strong>{entry.substance}</strong>
                    <span>
                      {[entry.reaction, entry.classification, entry.onsetDate ? `onset ${entry.onsetDate}` : '']
                        .filter(Boolean).join(' · ') || 'No reaction details recorded'}
                    </span>
                    <span className="cn-meds-row-meta">
                      {entry.recordedByName || 'Recorder unknown'} · {entry.recordedAt.slice(0, 10)}
                      {entry.removalReason ? ` · ${entry.removalReason}` : ''}
                    </span>
                  </div>
                  <span className="cn-meds-row-stage">
                    {entry.status === 'active'
                      ? (entry.criticality && entry.criticality !== 'unknown' ? entry.criticality[0].toUpperCase() + entry.criticality.slice(1) : 'Active')
                      : entry.status === 'resolved' ? 'Resolved' : 'Inactive'}
                  </span>
                </div>
              ))}
            </div>

            <div className="cn-meds-footer">
              {tab === 'active' ? (
                <>
                  <button type="button" className="cn-btn" onClick={() => handleRemove('inactive', 'discontinued')} disabled={busy || !selected}>Discontinue</button>
                  <button type="button" className="cn-btn" onClick={() => handleRemove('resolved', 'resolved')} disabled={busy || !selected}>Resolve</button>
                </>
              ) : (
                <button type="button" className="cn-btn" onClick={handleReactivate} disabled={busy || !selected}>Reactivate</button>
              )}
              <button type="button" className="cn-btn" onClick={() => handleRemove('entered_in_error', 'entered in error')} disabled={busy || !selected}>Mark as Error</button>
              <button type="button" className="cn-btn" onClick={onClose}>Close</button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

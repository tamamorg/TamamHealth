'use client';

/**
 * "Include Problems" — the Assessment section's popup, matching the reference
 * screen for screen:
 *
 *   · Active / Inactive tabs over the patient's problem list, rendered as a
 *     table (Problem/Issue · Diagnosis description · ICD-11 · ICD-10 ·
 *     Start Date · Comments · Last Edited) with per-row checkboxes.
 *   · "Problem reconciliation performed" attestation, stamped on the patient.
 *   · "+ Problem" opens the Add to Problem List panel: Active/Inactive
 *     radios, a coded search with inline results, a Details disclosure
 *     (start date + comments), and Cancel / Clear / Save and Add Another /
 *     Save.
 *   · Footer: Cancel · Mark as Error · Deactivate · Include — Include hands
 *     the checked problems to the note's Assessment as diagnosis lines.
 *
 * The reference searches ICD-10 and SNOMED; this platform's terminology is
 * ICD-11, so the panel offers one coded search (legacy ICD-10 codes still
 * display in the table when a problem carries one).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, X } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { COMMON_ICD11_CODES } from '@/lib/icd11-codes';
import type { PatientDoc, ProblemDoc } from '@/lib/db-types';
import type { NoteDiagnosis } from '@/lib/clinical-notes/types';
import '../clinical-notes.css';
import { stopsClickPropagation } from '@/lib/a11y';
import { useDataScope } from '@/lib/hooks/useDataScope';

type ProblemTab = 'active' | 'inactive';

function bucketOf(problem: ProblemDoc): ProblemTab {
  return problem.status === 'active' || problem.status === 'chronic' ? 'active' : 'inactive';
}

/** Catalog title behind a code — the table's "Diagnosis description" column. */
function descriptionFor(problem: ProblemDoc): string {
  if (!problem.icd11Code) return problem.name;
  return COMMON_ICD11_CODES.find(e => e.code === problem.icd11Code)?.title || problem.name;
}

function shortDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface IncludeProblemsModalProps {
  patientId: string;
  patientName: string;
  currentUser: { _id: string; name?: string; username?: string; orgId?: string } | null;
  /** Hand the checked problems to the Assessment as diagnosis lines. */
  onInclude: (lines: NoteDiagnosis[]) => void;
  onClose: () => void;
}

export default function IncludeProblemsModal({
  patientId, patientName, currentUser, onInclude, onClose,
}: IncludeProblemsModalProps) {
  const { showToast } = useToast();
  const scope = useDataScope();
  const userName = currentUser?.name || currentUser?.username || 'Unknown user';

  const [problems, setProblems] = useState<ProblemDoc[]>([]);
  const [patient, setPatient] = useState<PatientDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ProblemTab>('active');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // ── "+ Problem" panel state ─────────────────────────────────────────────
  const [showAdd, setShowAdd] = useState(false);
  const [addStatus, setAddStatus] = useState<'active' | 'inactive'>('active');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<{ code: string; title: string } | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [comments, setComments] = useState('');

  const load = useCallback(async () => {
    const { getProblemsByPatient } = await import('@/lib/services/problem-service');
    const { getPatientById } = await import('@/lib/services/patient-service');
    const [rows, pt] = await Promise.all([getProblemsByPatient(patientId, scope), getPatientById(patientId, scope)]);
    rows.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    setProblems(rows);
    setPatient(pt);
    setLoading(false);
  }, [patientId, scope]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => problems.filter(p => bucketOf(p) === tab), [problems, tab]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2 || picked) return [];
    return COMMON_ICD11_CODES
      .filter(e =>
        e.title.toLowerCase().includes(q) ||
        e.code.toLowerCase().includes(q) ||
        (e.keywords || []).some(k => k.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [query, picked]);

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (err) {
      showToast(err instanceof Error ? err.message : 'The change could not be saved.', 'error');
    } finally { setBusy(false); }
  };

  const toggleRow = (id: string) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const clearAddForm = () => {
    setQuery(''); setPicked(null); setStartDate(''); setComments('');
    setShowDetails(false); setAddStatus('active');
  };

  const saveProblem = (andAnother: boolean) => withBusy(async () => {
    const name = picked?.title || query.trim();
    if (!name) { showToast('Search for the problem first.', 'error'); return; }
    const { createProblem } = await import('@/lib/services/problem-service');
    await createProblem({
      patientId,
      patientName,
      name,
      icd11Code: picked?.code,
      status: addStatus,
      onsetDate: startDate || undefined,
      notes: comments.trim() || undefined,
      recordedBy: currentUser?._id,
      recordedByName: userName,
      orgId: currentUser?.orgId,
    });
    showToast(`${name} added to the problem list.`, 'success');
    clearAddForm();
    if (!andAnother) setShowAdd(false);
    await load();
  });

  const forChecked = (fn: (p: ProblemDoc) => Promise<void>, done: string) => withBusy(async () => {
    const targets = rows.filter(p => checked.has(p._id));
    if (targets.length === 0) return;
    for (const p of targets) await fn(p);
    showToast(`${targets.length} problem${targets.length === 1 ? '' : 's'} ${done}.`, 'success');
    setChecked(new Set());
    await load();
  });

  const handleDeactivate = () => forChecked(async (p) => {
    const { setProblemStatus } = await import('@/lib/services/problem-service');
    await setProblemStatus(p._id, tab === 'active' ? 'inactive' : 'active');
  }, tab === 'active' ? 'deactivated' : 'reactivated');

  const handleMarkError = () => {
    const n = rows.filter(p => checked.has(p._id)).length;
    if (n === 0) return;
    if (!window.confirm(`Remove ${n} problem${n === 1 ? '' : 's'} as entered in error? This deletes them from the problem list.`)) return;
    void forChecked(async (p) => {
      const { deleteProblem } = await import('@/lib/services/problem-service');
      await deleteProblem(p._id);
    }, 'removed as entered in error');
  };

  const handleInclude = () => {
    const targets = rows.filter(p => checked.has(p._id));
    if (targets.length === 0) return;
    onInclude(targets.map(p => ({
      id: `dx-${Math.random().toString(36).slice(2, 10)}`,
      name: p.name,
      description: descriptionFor(p),
      icd11Code: p.icd11Code,
      startDate: p.onsetDate,
      addedAt: new Date().toISOString(),
      problemId: p._id,
    })));
    onClose();
  };

  const handleReconcile = (performed: boolean) => withBusy(async () => {
    const { updatePatient } = await import('@/lib/services/patient-service');
    const updated = await updatePatient(patientId, {
      problemReconciledAt: performed ? new Date().toISOString() : undefined,
    });
    if (updated) setPatient(updated);
  });

  return (
    <Modal onClose={onClose} width={1060} align="top" labelledBy="cn-incprob-title">
      <div className="cn-meds">
        <div className="cn-meds-header">
          <h2 className="cn-meds-title" id="cn-incprob-title">Include Problems</h2>
          <button type="button" className="cn-meds-close" onClick={onClose} aria-label="Close include problems">
            <X size={18} />
          </button>
        </div>

        <div className="cn-meds-body cn-meds-body--single">
          <div className="cn-meds-left">
            <div className="cn-meds-controlrow">
              <div className="cn-segmented" aria-label="Problem lists">
                {(['active', 'inactive'] as ProblemTab[]).map(key => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={tab === key}
                    onClick={() => { setTab(key); setChecked(new Set()); }}
                  >
                    {key === 'active' ? 'Active' : 'Inactive'}
                  </button>
                ))}
              </div>
              <div className="cn-meds-adders">
                <button type="button" className="cn-btn" onClick={() => setShowAdd(v => !v)} aria-expanded={showAdd}>
                  <Plus size={13} /> Problem
                </button>
              </div>
            </div>

            <label className="cn-meds-nkm">
              <input
                type="checkbox"
                checked={Boolean(patient?.problemReconciledAt)}
                disabled={busy}
                onChange={e => void handleReconcile(e.target.checked)}
              />
              Problem reconciliation performed
              {patient?.problemReconciledAt && (
                <span className="cn-meds-reconcile-at">{shortDate(patient.problemReconciledAt)}</span>
              )}
            </label>

            <h3 className="cn-meds-listhead">{tab === 'active' ? 'Active Problems' : 'Inactive Problems'}</h3>
            <div className="cn-inc-tablewrap">
              <table className="cn-inc-table">
                <thead>
                  <tr>
                    <th aria-label="Include" />
                    <th>Problem/Issue</th>
                    <th>Diagnosis description</th>
                    <th>ICD-11</th>
                    <th>ICD-10</th>
                    <th>Start Date</th>
                    <th>Comments</th>
                    <th>Last Edited</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="cn-inc-empty">
                        No {tab} problems recorded.
                      </td>
                    </tr>
                  )}
                  {loading && (
                    <tr><td colSpan={8} className="cn-inc-empty">Loading problems…</td></tr>
                  )}
                  {rows.map(p => (
                    <tr
                      key={p._id}
                      className={checked.has(p._id) ? 'is-checked' : undefined}
                      onClick={() => toggleRow(p._id)}
                    >
                      <td {...stopsClickPropagation}>
                        <input
                          type="checkbox"
                          checked={checked.has(p._id)}
                          onChange={() => toggleRow(p._id)}
                          aria-label={`Select ${p.name}`}
                        />
                      </td>
                      <td className="cn-inc-name">{p.name}</td>
                      <td>{descriptionFor(p)}</td>
                      <td className="cn-inc-code">{p.icd11Code || ''}</td>
                      <td className="cn-inc-code">{p.icd10Code || ''}</td>
                      <td>{p.onsetDate || ''}</td>
                      <td className="cn-inc-comments">{p.notes || ''}</td>
                      <td>{shortDate(p.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {showAdd && (
              <div className="cn-inc-add">
                <h4>Add to Problem List</h4>
                <div className="cn-inc-add-status" role="radiogroup" aria-label="Problem status">
                  {(['active', 'inactive'] as const).map(s => (
                    <label key={s} className="cn-consent-option">
                      <input
                        type="radio"
                        name="cn-inc-add-status"
                        checked={addStatus === s}
                        onChange={() => setAddStatus(s)}
                      />
                      {s === 'active' ? 'Active' : 'Inactive'}
                    </label>
                  ))}
                </div>

                <label className="cn-inc-add-search">
                  <span>ICD-11 *</span>
                  <input
                    className="cn-input"
                    placeholder="Search for problem or ICD-11 code"
                    value={picked ? `${picked.code} — ${picked.title}` : query}
                    onChange={e => { setPicked(null); setQuery(e.target.value); }}
                    aria-label="Search for problem or ICD-11 code"
                  />
                </label>
                {results.length > 0 && (
                  <div className="cn-inc-results">
                    {results.map(r => (
                      <button
                        key={r.code}
                        type="button"
                        onClick={() => { setPicked({ code: r.code, title: r.title }); setQuery(''); }}
                      >
                        <span className="cn-inc-code">{r.code}</span>
                        <span>{r.title}</span>
                      </button>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  className="cn-card-head-action cn-inc-details-toggle"
                  onClick={() => setShowDetails(v => !v)}
                  aria-expanded={showDetails}
                >
                  Details {showDetails ? '▾' : '▸'}
                </button>
                {showDetails && (
                  <div className="cn-inc-details">
                    <label className="cn-dx-field">
                      <span>Start date</span>
                      <input type="date" className="cn-input" value={startDate} onChange={e => setStartDate(e.target.value)} aria-label="Start date" />
                    </label>
                    <input
                      className="cn-input"
                      placeholder="Comments"
                      value={comments}
                      onChange={e => setComments(e.target.value)}
                      aria-label="Comments"
                    />
                  </div>
                )}

                <div className="cn-meds-footer">
                  <button type="button" className="cn-btn" onClick={() => { clearAddForm(); setShowAdd(false); }}>Cancel</button>
                  <button type="button" className="cn-btn" onClick={clearAddForm} disabled={busy}>Clear</button>
                  <button type="button" className="cn-btn" onClick={() => saveProblem(true)} disabled={busy}>Save and Add Another</button>
                  <button type="button" className="cn-btn cn-btn-primary" onClick={() => saveProblem(false)} disabled={busy}>Save</button>
                </div>
              </div>
            )}

            <div className="cn-meds-footer">
              <button type="button" className="cn-btn" onClick={onClose}>Cancel</button>
              <button type="button" className="cn-btn" onClick={handleMarkError} disabled={busy || checked.size === 0}>Mark as Error</button>
              <button type="button" className="cn-btn" onClick={handleDeactivate} disabled={busy || checked.size === 0}>
                {tab === 'active' ? 'Deactivate' : 'Reactivate'}
              </button>
              <button type="button" className="cn-btn cn-btn-primary" onClick={handleInclude} disabled={busy || checked.size === 0}>
                Include
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

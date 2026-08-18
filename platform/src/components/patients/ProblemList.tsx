'use client';

/**
 * ProblemList — longitudinal "Active / Chronic / Resolved" problem panel
 * for one patient. The Storyboard sidebar and SBAR handoff both read from
 * the same source so a problem documented here propagates everywhere.
 *
 * Add flow: type-ahead against COMMON_ICD11_CODES so clinicians don't
 * invent free-text labels. Resolve flow: stamps resolvedDate and moves
 * the row into the resolved section without losing audit history.
 */

import { useMemo, useState } from 'react';
import {
  Plus, X, CheckCircle2, Activity, Edit3, Trash2,
} from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useProblems } from '@/lib/hooks/useProblems';
import { useToast } from '@/components/Toast';
import { COMMON_ICD11_CODES } from '@/lib/icd11-codes';
import CodedSearchField from '@/components/CodedSearchField';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { ProblemStatus, ProblemDoc } from '@/lib/db-types';

interface ProblemListProps {
  patientId: string;
  patientName?: string;
}

const STATUS_TINT: Record<ProblemStatus, { bg: string; color: string; ring: string; label: string }> = {
  active:   { bg: 'rgba(196,69,54,0.10)',  color: 'var(--tamamhealth-red)', ring: 'rgba(196,69,54,0.20)', label: 'Active' },
  chronic:  { bg: 'rgba(124,58,237,0.10)', color: '#6D28D9',                ring: 'rgba(124,58,237,0.22)', label: 'Chronic' },
  inactive: { bg: 'rgba(100,116,139,0.10)',color: '#475569',                ring: 'rgba(100,116,139,0.22)', label: 'Inactive' },
  resolved: { bg: 'rgba(31, 157, 111,0.10)', color: 'var(--color-success-text)',                ring: 'rgba(31, 157, 111,0.22)', label: 'Resolved' },
};

function ProblemRow({
  problem, onResolve, onReactivate, onEdit, onRemove,
}: {
  problem: ProblemDoc;
  onResolve?: (id: string) => void;
  onReactivate?: (id: string) => void;
  onEdit?: (id: string, patch: Partial<ProblemDoc>) => Promise<void>;
  onRemove?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const tint = STATUS_TINT[problem.status];

  // Inline edit affordance — lets a clinician correct a problem they added
  // (status / onset / notes) without re-creating it. Reversible: Cancel
  // discards the draft and restores the read-only row.
  const [editing, setEditing] = useState(false);
  const [draftStatus, setDraftStatus] = useState<ProblemStatus>(problem.status);
  const [draftOnset, setDraftOnset] = useState(problem.onsetDate || '');
  const [draftNotes, setDraftNotes] = useState(problem.notes || '');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraftStatus(problem.status);
    setDraftOnset(problem.onsetDate || '');
    setDraftNotes(problem.notes || '');
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!onEdit) return;
    setSaving(true);
    try {
      await onEdit(problem._id, {
        status: draftStatus,
        onsetDate: draftOnset || undefined,
        notes: draftNotes.trim() || undefined,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <li className="card-elevated p-3" style={{ borderColor: tint.ring }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{problem.name}</span>
          {problem.icd11Code && (
            <span className="text-[10.5px] font-medium" style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
              ICD-11 · {problem.icd11Code}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase mb-1.5" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{t('problemList.status')}</label>
            <div className="grid grid-cols-3 gap-1 keep-cols">
              {(['active', 'chronic', 'inactive'] as const).map(s => {
                const st = STATUS_TINT[s];
                const on = draftStatus === s;
                return (
                  <button
                    key={s}
                    onClick={() => setDraftStatus(s)}
                    className="px-2 py-2 text-xs font-bold uppercase rounded transition-all"
                    style={{
                      background: on ? st.bg : 'transparent',
                      color: on ? st.color : 'var(--text-secondary)',
                      border: `1px solid ${on ? st.color : 'var(--border-light)'}`,
                      letterSpacing: '0.06em',
                    }}
                  >
                    {t(`problemList.status_${s}`)}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase mb-1.5" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{t('problemList.onsetDate')}</label>
            <input type="date" value={draftOnset} onChange={(e) => setDraftOnset(e.target.value)} className="w-full" />
          </div>
        </div>
        <div className="mt-3">
          <label className="block text-[10px] font-bold uppercase mb-1.5" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{t('problemList.notes')}</label>
          <textarea value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} rows={2} className="w-full" placeholder={t('problemList.notesPlaceholder')} />
        </div>
        <div className="flex items-center justify-end gap-2 mt-3">
          <button onClick={() => setEditing(false)} className="btn btn-secondary">{t('action.cancel')}</button>
          <button onClick={saveEdit} disabled={saving} className="btn btn-primary">
            {saving ? t('problemList.saving') : t('action.saveChanges')}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li
      className="card-elevated p-3 flex items-start gap-3"
      style={{ borderColor: tint.ring }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {problem.name}
          </span>
          <span
            className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
            style={{ background: tint.bg, color: tint.color, letterSpacing: '0.06em' }}
          >
            {t(`problemList.status_${problem.status}`)}
          </span>
          {problem.icd11Code && (
            <span
              className="text-[10.5px] font-medium"
              style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}
            >
              ICD-11 · {problem.icd11Code}
            </span>
          )}
        </div>
        {(problem.onsetDate || problem.notes || problem.recordedByName) && (
          <div className="mt-1 text-[12px] leading-snug" style={{ color: 'var(--text-muted)' }}>
            {problem.onsetDate && <span>{t('problemList.onsetPrefix', { date: problem.onsetDate })}</span>}
            {problem.onsetDate && problem.recordedByName && <span> · </span>}
            {problem.recordedByName && <span>{t('problemList.byPrefix', { name: problem.recordedByName })}</span>}
            {problem.notes && (
              <p className="mt-1" style={{ color: 'var(--text-secondary)' }}>{problem.notes}</p>
            )}
          </div>
        )}
        {problem.resolvedDate && (
          <div className="mt-1 text-[11px]" style={{ color: 'var(--color-success-text)' }}>
            {t('problemList.resolvedPrefix', { date: problem.resolvedDate })}
          </div>
        )}
      </div>
      {onEdit && (
        <button
          onClick={startEdit}
          aria-label={t('action.edit')}
          className="text-xs font-bold inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 transition"
          style={{ color: 'var(--text-muted)' }}
        >
          <Edit3 size={14} /> {t('action.edit')}
        </button>
      )}
      {onResolve && (
        <button
          onClick={() => onResolve(problem._id)}
          className="text-xs font-bold inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-emerald-50 transition"
          style={{ color: 'var(--color-success-text)' }}
        >
          <CheckCircle2 className="w-3.5 h-3.5" /> {t('problemList.resolve')}
        </button>
      )}
      {onReactivate && (
        <button
          onClick={() => onReactivate(problem._id)}
          className="text-xs font-bold hover:underline"
          style={{ color: 'var(--text-muted)' }}
        >
          {t('problemList.reactivate')}
        </button>
      )}
      {onRemove && (
        <button
          onClick={() => onRemove(problem._id)}
          aria-label={t('action.remove')}
          title={t('action.remove')}
          className="p-1.5 rounded-lg transition-colors hover:bg-red-50"
          style={{ color: 'var(--tamamhealth-red)' }}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </li>
  );
}

export default function ProblemList({ patientId, patientName }: ProblemListProps) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { active, resolved, problems, create, setStatus, update, remove, loading } = useProblems(patientId);
  const { showToast } = useToast();

  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [pickedCode, setPickedCode] = useState<{ code: string; title: string; chapter: string } | null>(null);
  const [status, setStatusInput] = useState<ProblemStatus>('active');
  const [onsetDate, setOnsetDate] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const icdOptions = useMemo(() => COMMON_ICD11_CODES.map(c => ({ code: c.code, name: c.title, meta: c.chapter, keywords: c.keywords })), []);

  const reset = () => {
    setAdding(false);
    setSearch('');
    setPickedCode(null);
    setStatusInput('active');
    setOnsetDate('');
    setNotes('');
  };

  const handleSubmit = async () => {
    if (!pickedCode) {
      showToast(t('problemList.toastPickCode'), 'error');
      return;
    }
    try {
      setSubmitting(true);
      await create({
        patientId,
        patientName,
        name: pickedCode.title,
        icd11Code: pickedCode.code,
        status,
        onsetDate: onsetDate || undefined,
        notes: notes.trim() || undefined,
        recordedBy: currentUser?._id || currentUser?.username,
        recordedByName: currentUser?.name,
        hospitalId: currentUser?.hospitalId,
        hospitalName: currentUser?.hospitalName,
        orgId: currentUser?.orgId,
      });
      showToast(t('problemList.toastAdded'), 'success');
      reset();
    } catch (err) {
      console.error(err);
      showToast(t('problemList.toastAddFailed'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async (id: string) => {
    try {
      await setStatus(id, 'resolved');
      showToast(t('problemList.toastResolved'), 'success');
    } catch {
      showToast(t('problemList.toastUpdateFailed'), 'error');
    }
  };

  const handleReactivate = async (id: string) => {
    try {
      await setStatus(id, 'active');
      showToast(t('problemList.toastReactivated'), 'success');
    } catch {
      showToast(t('problemList.toastUpdateFailed'), 'error');
    }
  };

  // Edit an existing problem (status / onset / notes) in place via the
  // existing updateProblem service — corrections without re-creating the row.
  const handleEdit = async (id: string, patch: Partial<ProblemDoc>) => {
    try {
      await update(id, patch);
      showToast(t('action.saveChanges'), 'success');
    } catch {
      showToast(t('problemList.toastUpdateFailed'), 'error');
      throw new Error('update failed');
    }
  };

  // Remove a problem added in error. Destructive, so it is gated behind a
  // confirm dialog — distinct from "resolve", which keeps the row for history.
  const handleRemove = async (id: string) => {
    if (!window.confirm(t('action.remove') + '?')) return;
    try {
      await remove(id);
      showToast(t('action.remove'), 'success');
    } catch {
      showToast(t('problemList.toastUpdateFailed'), 'error');
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="card-elevated p-5 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="icon-box-lg">
            <Activity className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{t('problemList.title')}</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {t('problemList.subtitle')}
            </p>
          </div>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className="btn btn-primary inline-flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> {t('problemList.addProblem')}
          </button>
        )}
      </div>

      {/* Add panel */}
      {adding && (
        <div className="card-elevated overflow-hidden">
          <header
            className="px-5 py-3 border-b flex items-center justify-between gap-2"
            style={{ borderColor: 'var(--border-light)', background: 'var(--overlay-subtle)' }}
          >
            <div className="flex items-center gap-2">
              <div className="icon-box-sm">
                <Plus className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
              </div>
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t('problemList.newProblem')}</h3>
            </div>
            <button onClick={reset} aria-label={t('action.cancel')} className="p-1 rounded hover:bg-gray-100">
              <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            </button>
          </header>
          <div className="p-5 space-y-4">
            {pickedCode ? (
              <div
                className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg"
                style={{
                  background: 'var(--accent-light)',
                  border: '1px solid var(--border-accent)',
                }}
              >
                <div className="min-w-0">
                  <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                    {pickedCode.title}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    ICD-11 · {pickedCode.code} · {pickedCode.chapter}
                  </div>
                </div>
                <button
                  onClick={() => setPickedCode(null)}
                  className="text-xs font-semibold underline shrink-0"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  {t('consultation.change')}
                </button>
              </div>
            ) : (
              <CodedSearchField
                label={t('problemList.diagnosis')}
                placeholder={t('problemList.searchPlaceholder')}
                options={icdOptions}
                value={search}
                onChange={setSearch}
                onSelect={c => { setPickedCode({ code: c.code, title: c.name, chapter: c.meta || '' }); setSearch(''); }}
                autoFocus
              />
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold uppercase mb-1.5" style={{
                  color: 'var(--text-muted)', letterSpacing: '0.06em',
                }}>{t('problemList.status')}</label>
                <div className="grid grid-cols-3 gap-1 keep-cols">
                  {(['active', 'chronic', 'inactive'] as const).map(s => {
                    const tint = STATUS_TINT[s];
                    const on = status === s;
                    return (
                      <button
                        key={s}
                        onClick={() => setStatusInput(s)}
                        className="px-2 py-2 text-xs font-bold uppercase rounded transition-all"
                        style={{
                          background: on ? tint.bg : 'transparent',
                          color: on ? tint.color : 'var(--text-secondary)',
                          border: `1px solid ${on ? tint.color : 'var(--border-light)'}`,
                          letterSpacing: '0.06em',
                        }}
                      >
                        {t(`problemList.status_${s}`)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase mb-1.5" style={{
                  color: 'var(--text-muted)', letterSpacing: '0.06em',
                }}>{t('problemList.onsetDate')}</label>
                <input
                  type="date"
                  value={onsetDate}
                  onChange={(e) => setOnsetDate(e.target.value)}
                  className="w-full"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase mb-1.5" style={{
                color: 'var(--text-muted)', letterSpacing: '0.06em',
              }}>{t('problemList.notes')}</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full"
                placeholder={t('problemList.notesPlaceholder')}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={reset} className="btn btn-secondary">{t('action.cancel')}</button>
              <button
                onClick={handleSubmit}
                disabled={!pickedCode || submitting}
                className="btn btn-primary inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                {submitting ? t('problemList.saving') : t('problemList.addToList')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active + Chronic */}
      <section>
        <div className="flex items-center gap-2 mb-2.5">
          <h3 className="text-[11px] font-bold uppercase" style={{
            color: 'var(--text-secondary)', letterSpacing: '0.08em',
          }}>
            {t('problemList.activeChronic')}
          </h3>
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>· {active.length}</span>
          <div className="flex-1 h-px" style={{ background: 'var(--border-light)' }} />
        </div>
        {loading ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('problemList.loading')}</p>
        ) : active.length === 0 ? (
          <div
            className="card-elevated p-5 text-center"
            style={{ borderStyle: 'dashed' }}
          >
            <div className="icon-box-lg mx-auto">
              <Activity className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
            </div>
            <p className="text-sm font-semibold mt-2" style={{ color: 'var(--text-secondary)' }}>
              {t('problemList.emptyTitle')}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {t('problemList.emptyHint')}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {active.map(p => (
              <ProblemRow key={p._id} problem={p} onResolve={handleResolve} onEdit={handleEdit} onRemove={handleRemove} />
            ))}
          </ul>
        )}
      </section>

      {/* Resolved */}
      {resolved.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-2.5">
            <h3 className="text-[11px] font-bold uppercase" style={{
              color: 'var(--text-secondary)', letterSpacing: '0.08em',
            }}>
              {t('problemList.resolvedHeading')}
            </h3>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>· {resolved.length}</span>
            <div className="flex-1 h-px" style={{ background: 'var(--border-light)' }} />
          </div>
          <ul className="space-y-2">
            {resolved.map(p => (
              <ProblemRow key={p._id} problem={p} onReactivate={handleReactivate} onRemove={handleRemove} />
            ))}
          </ul>
        </section>
      )}

      {!loading && problems.length === 0 && !adding && (
        <p className="text-[11.5px] italic px-1" style={{ color: 'var(--text-muted)' }}>
          {t('problemList.tip')}
        </p>
      )}
    </div>
  );
}

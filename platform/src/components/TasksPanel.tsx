'use client';

/**
 * Personal task panel — quick to-dos with optional reminder date, priority,
 * and patient link. Create / edit / complete / reschedule / delete, plus a
 * collapsible completed section. Opened from the top-rail QuickActions.
 *
 * Layout note: the global `input { width: 100% }` rule in globals.css means any
 * input dropped in a flex row claims the whole row. Every field here therefore
 * sets its own width/flex explicitly.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '@/components/Modal';
import {
  ClipboardList, Check, Clock, Calendar, Plus, Trash2, X, Flag, Pencil, Search, User,
} from '@/components/icons/lucide';
import { toIsoDate } from '@/components/ehr/EhrMiniCalendar';
import { useTasks } from '@/lib/hooks/useTasks';
import { usePatients } from '@/lib/hooks/usePatients';
import { patientFullName } from '@/lib/patient-utils';
import type { ClinicianTaskDoc } from '@/lib/db-types';
import Select from '@/components/Select';

type TaskPriority = 'low' | 'normal' | 'medium' | 'high';

/** Client-local "today" — never the UTC slice, which flips a day early in Juba. */
function todayISO(): string {
  return toIsoDate(new Date());
}

function dueLabel(due?: string): { text: string; overdue: boolean } | null {
  if (!due) return null;
  const today = todayISO();
  if (due < today) return { text: `Overdue · ${due}`, overdue: true };
  if (due === today) return { text: 'Today', overdue: false };
  return { text: due, overdue: false };
}

function priorityColor(priority?: string): string {
  if (priority === 'high') return 'var(--color-danger)';
  if (priority === 'medium') return 'var(--color-warning)';
  if (priority === 'low') return 'var(--text-muted)';
  return 'var(--text-secondary)';
}

const fieldStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 'var(--input-radius)',
  background: 'var(--overlay-subtle)',
  border: '1px solid var(--border-medium)',
  color: 'var(--text-primary)',
};

export default function TasksPanel({ onClose }: { onClose: () => void }) {
  const { open, completed, loading, add, complete, reopen, reschedule, update, remove } = useTasks();
  const { patients } = usePatients();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [patientId, setPatientId] = useState('');
  const [patientQuery, setPatientQuery] = useState('');
  const [showPatientSearch, setShowPatientSearch] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const selectedPatient = useMemo(
    () => (patientId ? patients.find(p => p._id === patientId) : null),
    [patients, patientId],
  );

  const patientMatches = useMemo(() => {
    const q = patientQuery.trim().toLowerCase();
    if (!q) return [];
    return patients
      .filter(p =>
        patientFullName(p).toLowerCase().includes(q) ||
        (p.hospitalNumber || '').toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [patients, patientQuery]);

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await add({
        title: title.trim(),
        dueDate: due || undefined,
        priority,
        patientId: selectedPatient?._id,
        patientName: selectedPatient ? patientFullName(selectedPatient) : undefined,
      });
      setTitle('');
      setDue('');
      setPriority('normal');
      setPatientId('');
      setPatientQuery('');
      setShowPatientSearch(false);
      titleRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (task: ClinicianTaskDoc) => {
    setEditingId(task._id);
    setEditTitle(task.title);
  };

  const commitEdit = async (task: ClinicianTaskDoc) => {
    const next = editTitle.trim();
    setEditingId(null);
    if (!next || next === task.title) return;
    await update(task._id, { title: next });
  };

  const cyclePriority = (current?: string): TaskPriority => {
    if (current === 'high') return 'normal';
    if (current === 'medium') return 'high';
    if (current === 'low') return 'normal';
    return 'medium';
  };

  return (
    <Modal onClose={onClose} width={560} align="top" labelledBy="tasks-panel-title">
      <div className="card-elevated" style={{ background: 'var(--bg-card-solid)', borderRadius: 'var(--card-radius)', padding: 0, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 60px)', overflow: 'hidden' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
          <div className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} aria-hidden />
            <h2 id="tasks-panel-title" className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>My Tasks</h2>
            {open.length > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-light)', color: 'var(--accent-text)' }}>{open.length}</span>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
        </div>

        {/* Single cohesive create row: title · date · priority · add */}
        <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--border-light)' }}>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }}
              placeholder="Add a task — e.g. phone John"
              aria-label="Task title"
              className="text-sm"
              style={{ ...fieldStyle, flex: '1 1 160px', width: 'auto', minWidth: 0 }}
            />
            <input
              type="date"
              value={due}
              onChange={e => setDue(e.target.value)}
              title="Reminder date (optional)"
              aria-label="Reminder date"
              className="text-[12px]"
              style={{ ...fieldStyle, padding: '6px 10px', width: 140, flex: '0 0 auto' }}
            />
            <Select
              value={priority}
              onChange={e => setPriority(e.target.value as TaskPriority)}
              aria-label="Priority"
              className="text-[12px]"
              style={{ ...fieldStyle, padding: '6px 8px', width: 110, flex: '0 0 auto' }}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
            <button
              onClick={submit}
              disabled={!title.trim() || busy}
              aria-label="Add task"
              className="p-2 rounded-lg flex-shrink-0"
              style={{ background: title.trim() ? 'var(--accent-primary)' : 'var(--overlay-subtle)', color: title.trim() ? '#fff' : 'var(--text-muted)', cursor: title.trim() ? 'pointer' : 'default' }}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-2">
            {selectedPatient ? (
              <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                <User className="w-3.5 h-3.5" aria-hidden />
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{patientFullName(selectedPatient)}</span>
                {selectedPatient.hospitalNumber && (
                  <span style={{ color: 'var(--text-muted)' }}>· {selectedPatient.hospitalNumber}</span>
                )}
                <button
                  type="button"
                  onClick={() => { setPatientId(''); setPatientQuery(''); }}
                  className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ color: 'var(--text-muted)', background: 'var(--overlay-subtle)' }}
                >
                  Clear
                </button>
              </div>
            ) : showPatientSearch ? (
              <div>
                <div className="flex items-center gap-2">
                  <div style={{ position: 'relative', flex: '1 1 auto', minWidth: 0 }}>
                    <Search
                      className="w-3.5 h-3.5"
                      style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}
                      aria-hidden
                    />
                    <input
                      type="search"
                      value={patientQuery}
                      autoFocus
                      onChange={e => setPatientQuery(e.target.value)}
                      placeholder="Link a patient (optional)"
                      aria-label="Link a patient"
                      className="text-[12px]"
                      style={{ ...fieldStyle, paddingLeft: 30, width: '100%' }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => { setShowPatientSearch(false); setPatientQuery(''); }}
                    className="text-[11px] font-semibold"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Cancel
                  </button>
                </div>
                {patientMatches.length > 0 && (
                  <div className="mt-1 rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-light)' }}>
                    {patientMatches.map(p => (
                      <button
                        key={p._id}
                        type="button"
                        onClick={() => {
                          setPatientId(p._id);
                          setPatientQuery('');
                          setShowPatientSearch(false);
                          titleRef.current?.focus();
                        }}
                        className="w-full text-left px-3 py-2 text-[12px] flex items-center justify-between"
                        style={{ background: 'var(--bg-card-solid)', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-light)' }}
                      >
                        <span className="font-semibold">{patientFullName(p)}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{p.hospitalNumber || ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowPatientSearch(true)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold"
                style={{ color: 'var(--accent-text)' }}
              >
                <User className="w-3.5 h-3.5" /> Link patient
              </button>
            )}
          </div>
        </div>

        <div style={{ overflowY: 'auto', minHeight: 160 }}>
          {loading ? (
            <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
          ) : open.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center" style={{ color: 'var(--text-muted)' }}>
              <ClipboardList className="w-9 h-9 mb-3" style={{ opacity: 0.35 }} aria-hidden />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>No open tasks</p>
              <p className="text-[12px] mt-1" style={{ maxWidth: 260 }}>Add one above — e.g. a callback, follow-up, or chart review.</p>
            </div>
          ) : (
            <div>
              {open.map(task => {
                const d = dueLabel(task.dueDate);
                const isEditing = editingId === task._id;
                return (
                  <div key={task._id} className="flex items-start gap-3 px-5 py-3 border-b" style={{ borderColor: 'var(--border-light)' }}>
                    <button
                      onClick={() => complete(task._id)}
                      aria-label={`Mark "${task.title}" complete`}
                      className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                      style={{ border: '1.5px solid var(--border-medium)', color: 'transparent' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; e.currentTarget.style.color = 'var(--accent-primary)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-medium)'; e.currentTarget.style.color = 'transparent'; }}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editTitle}
                          autoFocus
                          onChange={e => setEditTitle(e.target.value)}
                          onBlur={() => commitEdit(task)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitEdit(task);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          aria-label="Edit task title"
                          className="text-[13px] font-semibold"
                          style={{ ...fieldStyle, padding: '4px 8px', width: '100%' }}
                        />
                      ) : (
                        <div className="text-[13px] font-semibold flex items-start gap-1.5" style={{ color: 'var(--text-primary)' }}>
                          {(task.priority === 'high' || task.priority === 'medium') && (
                            <span style={{ color: priorityColor(task.priority) }} title={`${task.priority} priority`}>●</span>
                          )}
                          <span className="flex-1 break-words">{task.title}</span>
                          <button
                            onClick={() => startEdit(task)}
                            aria-label={`Edit "${task.title}"`}
                            title="Edit"
                            className="p-0.5 rounded flex-shrink-0"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      {task.patientName && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>re: {task.patientName}</div>}
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {(!d || d.overdue || d.text === 'Today') && (
                          <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: d?.overdue ? 'var(--color-danger)' : 'var(--text-muted)' }}>
                            {d?.overdue ? <Clock className="w-3 h-3" /> : <Calendar className="w-3 h-3" />}
                            {d ? (d.overdue ? 'Overdue' : d.text) : 'No date'}
                          </span>
                        )}
                        <input
                          type="date"
                          value={task.dueDate || ''}
                          onChange={e => reschedule(task._id, e.target.value)}
                          title="Reschedule"
                          aria-label={`Reminder date for "${task.title}"`}
                          className="text-[11px]"
                          style={{ ...fieldStyle, padding: '3px 6px', width: 132, flex: '0 0 auto' }}
                        />
                        <button
                          onClick={() => update(task._id, { priority: cyclePriority(task.priority) })}
                          aria-label={`Change priority for "${task.title}" (currently ${task.priority || 'normal'})`}
                          title={`Priority: ${task.priority || 'normal'} — click to cycle`}
                          className="p-1 rounded flex-shrink-0 inline-flex items-center gap-1"
                          style={{ color: priorityColor(task.priority) }}
                        >
                          <Flag className="w-3 h-3" />
                          <span className="text-[10px] font-bold uppercase">{task.priority || 'normal'}</span>
                        </button>
                      </div>
                    </div>
                    <button onClick={() => remove(task._id)} aria-label={`Delete "${task.title}"`} className="p-1 rounded flex-shrink-0" style={{ color: 'var(--text-muted)' }} onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-danger)')} onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {completed.length > 0 && (
            <div>
              <button onClick={() => setShowDone(s => !s)} aria-expanded={showDone} className="w-full text-left px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)', background: 'var(--overlay-subtle)' }}>
                {showDone ? '▾' : '▸'} Completed ({completed.length})
              </button>
              {showDone && completed.map(task => (
                <div key={task._id} className="flex items-center gap-3 px-5 py-2.5 border-b" style={{ borderColor: 'var(--border-light)' }}>
                  <button onClick={() => reopen(task._id)} aria-label={`Reopen "${task.title}"`} title="Reopen" className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)' }}>
                    <Check className="w-3 h-3" />
                  </button>
                  <span className="flex-1 text-[13px] line-through" style={{ color: 'var(--text-muted)' }}>{task.title}</span>
                  <button onClick={() => remove(task._id)} aria-label={`Delete "${task.title}"`} className="p-1 rounded flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

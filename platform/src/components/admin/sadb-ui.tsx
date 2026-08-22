'use client';

/**
 * Admin console design-language kit (sadb-*), per the two Claude Design
 * files "Super Admin Dashboard.dc.html" and "Super Admin Settings.dc.html".
 * Born on the super-admin console (hence the prefix — kept to avoid churning
 * ~1400 CSS lines and 17 pages for a rename), it is now the shared language
 * for BOTH admin consoles: every /admin/* page and every org-admin surface
 * (/org-admin/*, /facility-management) composes these primitives so cards,
 * chips, rows, rails and modals stay identical across the two consoles.
 * CSS lives in the sadb-* block of globals.css; every colour is a token —
 * no literals here. Console chrome is deliberately token-blue: tenant
 * branding colours belong to login, print headers and the branding preview,
 * not to admin buttons.
 *
 * Succeeds sa-ui.tsx (which keeps the shared risk/severity helpers).
 */

import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import Modal from '@/components/Modal';
import { AlertTriangle, ChevronRight, Pencil, Search } from '@/components/icons/lucide';
import type { SaSeverity } from '@/components/admin/sa-ui';
import type { UserRole } from '@/lib/db-types';

/* ── Tones ─────────────────────────────────────────────────────────── */

/** The five chip tones drawn in the designs. */
export type ChipTone = 'green' | 'yellow' | 'red' | 'blue' | 'neutral';
/** The four signal tones the dashboard logic works in. */
export type Tone = 'ok' | 'warn' | 'danger' | 'muted';

export const TONE_CHIP: Record<Tone, ChipTone> = {
  ok: 'green', warn: 'yellow', danger: 'red', muted: 'neutral',
};

export const SEVERITY_CHIP: Record<SaSeverity, ChipTone> = {
  critical: 'red', high: 'red', medium: 'yellow', low: 'neutral',
};

/** Subscription-status → chip tone (tenant registry, billing, dashboard). */
/**
 * What a tenant's status actually IS, as opposed to what it is paying for.
 *
 * Two fields describe a tenant and only one of them was ever shown.
 * `isActive` is the LIFECYCLE — deactivating an organization sets it false and
 * touches nothing else. `subscriptionStatus` is the BILLING plan state, and
 * that is what the rosters rendered. So a deactivated tenant kept advertising
 * "TRIAL" in its status column while the header counted it under Suspended
 * (`|| !o.isActive`), and the console disagreed with itself: three
 * organizations, chips reading 2 active + 2 trial + 1 suspended.
 *
 * Derived rather than written, on purpose. Stamping `subscriptionStatus:
 * 'suspended'` at deactivation would destroy the plan state underneath it, and
 * reactivating could not tell whether the tenant had been on trial or paying.
 * This is lossless: turn `isActive` back on and the real billing status is
 * still there.
 */
export function effectiveOrgStatus(
  org: { isActive?: boolean; subscriptionStatus: string },
): string {
  return org.isActive === false ? 'suspended' : org.subscriptionStatus;
}

export function statusChip(status: string): ChipTone {
  if (status === 'active') return 'green';
  if (status === 'trial') return 'yellow';
  if (status === 'suspended' || status === 'cancelled') return 'red';
  return 'neutral';
}

/* ── Page scaffold ─────────────────────────────────────────────────── */

/** Full-page scaffold with a role guard (defense-in-depth on top of the
 *  Edge proxy check). Defaults to super_admin so the 17 existing /admin/*
 *  call sites are unchanged; org-admin console pages pass
 *  `roles={['org_admin', 'super_admin']}`. */
export function SadbPage({ actions, roles = ['super_admin'], children }: {
  actions?: ReactNode; roles?: UserRole[]; children: ReactNode;
}) {
  const { currentUser } = useAuth();
  const router = useRouter();
  const allowed = !!currentUser && roles.includes(currentUser.role);

  useEffect(() => {
    if (currentUser && !allowed) router.replace('/dashboard');
  }, [currentUser, allowed, router]);

  if (!allowed) return null;

  return (
    <main className="page-container page-enter sadb-scope">
      {actions && <div className="sadb-page-actions">{actions}</div>}
      <div className="sadb-page">{children}</div>
    </main>
  );
}

/* ── Card ──────────────────────────────────────────────────────────── */

export function SadbCard({ title, meta, action, children, className = '' }: {
  title?: string; meta?: ReactNode; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`sadb-card ${className}`.trim()}>
      {(title || meta || action) && (
        <header className="sadb-card-head">
          {title && <h3 className="sadb-card-title">{title}</h3>}
          {(meta || action) && (
            <div className="flex items-center gap-3">
              {meta && <span className="sadb-card-meta">{meta}</span>}
              {action}
            </div>
          )}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * Card-head tab strip — for a card that holds more than one list (a roster and
 * the requests to join it). Sits in SadbCard's `action` slot, so the card keeps
 * one head and the tabs switch what its body shows.
 */
export function SadbTabs({ tabs, active, onChange, ariaLabel }: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onChange: (key: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="sadb-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map(tab => {
        const on = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={on}
            className={`sadb-tab${on ? ' is-active' : ''}`}
            onClick={() => onChange(tab.key)}
          >
            {tab.label}
            {tab.count ? <span className="sadb-tab-badge">{tab.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Condensed-uppercase head link ("Billing ›"). */
export function SadbHeadLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" className="sadb-head-link" onClick={onClick}>{children} ›</button>;
}

/* ── Chips, KV rows, queue rows ────────────────────────────────────── */

export function SadbChip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return <span className={`sadb-chip sadb-chip--${tone}`}>{children}</span>;
}

export function SadbKvRow({ label, value, valueTone, chip, chipTone }: {
  label: ReactNode;
  value?: ReactNode;
  valueTone?: 'up' | 'warn';
  chip?: ReactNode;
  chipTone?: ChipTone;
}) {
  return (
    <div className="sadb-kv">
      <span>{label}</span>
      {chip !== undefined
        ? <SadbChip tone={chipTone ?? 'neutral'}>{chip}</SadbChip>
        : <span className={`sadb-kv-value ${valueTone === 'up' ? 'is-up' : valueTone === 'warn' ? 'is-warn' : ''}`.trim()}>{value}</span>}
    </div>
  );
}

/** Row in a queue/watchlist card: optional chip, title/sub, optional
 *  timestamp, chevron when clickable. */
export function SadbQueueRow({ chip, chipTone, title, sub, when, onClick }: {
  chip?: ReactNode; chipTone?: ChipTone; title: ReactNode; sub?: ReactNode; when?: string; onClick?: () => void;
}) {
  const body = (
    <>
      {chip !== undefined && <SadbChip tone={chipTone ?? 'neutral'}>{chip}</SadbChip>}
      <span className="sadb-queue-copy">
        <span className="sadb-queue-title">{title}</span>
        {sub && <span className="sadb-queue-sub">{sub}</span>}
      </span>
      {when && <time className="sadb-queue-when">{when}</time>}
      {onClick && <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />}
    </>
  );
  if (!onClick) return <div className="sadb-queue-row" style={{ cursor: 'default' }}>{body}</div>;
  return <button type="button" className="sadb-queue-row" onClick={onClick}>{body}</button>;
}

/* ── KPI tiles ─────────────────────────────────────────────────────── */

export function SadbKpiTile({ label, value, delta, deltaTone, onClick }: {
  label: string; value: ReactNode; delta?: ReactNode; deltaTone?: 'up' | 'warn'; onClick?: () => void;
}) {
  const body = (
    <>
      <p className="sadb-kpi-label">{label}</p>
      <p className="sadb-kpi-value">{value}</p>
      {delta && <p className={`sadb-kpi-delta ${deltaTone === 'up' ? 'is-up' : deltaTone === 'warn' ? 'is-warn' : ''}`.trim()}>{delta}</p>}
    </>
  );
  return onClick
    ? <button type="button" className="sadb-kpi" onClick={onClick}>{body}</button>
    : <div className="sadb-kpi">{body}</div>;
}

/* ── Search field ──────────────────────────────────────────────────── */

export function SadbSearch({ value, onChange, placeholder, ariaLabel }: {
  value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string;
}) {
  return (
    <label className="sadb-search">
      <Search className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
      />
    </label>
  );
}

/* ── Grid list (the tenant-matrix surface, generalised) ────────────── */

/** Column-template grid list. The header row stays rendered when the list
 *  is empty; the empty message sits below it. */
export function SadbGridList({ template, minWidth = 760, head, alignEndLast = false, children, empty }: {
  /** CSS grid-template-columns for header and rows. */
  template: string;
  minWidth?: number;
  head: ReactNode[];
  /** Right-align the final header cell — for lists whose last column is a
   *  trailing status chip. The header cells are wrapped in spans of this
   *  component's own making, so a caller cannot align them from outside. */
  alignEndLast?: boolean;
  children?: ReactNode;
  /** Empty message; rendered under the header row when there are no rows. */
  empty?: ReactNode;
}) {
  const hasRows = Array.isArray(children) ? children.some(Boolean) : Boolean(children);
  return (
    <div className="sadb-tenant-scroll show-scrollbar">
      <div style={{ minWidth }}>
        <div className="sadb-tenant-grid sadb-tenant-grid--head" style={{ gridTemplateColumns: template }}>
          {head.map((h, i) => (
            <span key={i} style={alignEndLast && i === head.length - 1 ? { textAlign: 'end' } : undefined}>{h}</span>
          ))}
        </div>
        {children}
        {!hasRows && empty && <p className="sadb-empty">{empty}</p>}
      </div>
    </div>
  );
}

/** One row of a SadbGridList; clickable when onClick is given. Pass the same
 *  `template` as the list. */
export function SadbGridRow({ template, onClick, ariaExpanded, children }: {
  /** Receives the event so a caller can anchor a menu to the pointer. */
  template: string; onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** For a row that opens a detail panel beneath itself, so the row announces
   *  its own state rather than expanding silently. */
  ariaExpanded?: boolean;
  children: ReactNode;
}) {
  if (!onClick) {
    return <div className="sadb-tenant-grid sadb-tenant-row" style={{ gridTemplateColumns: template, cursor: 'default' }}>{children}</div>;
  }
  return (
    <button type="button" className="sadb-tenant-grid sadb-tenant-row" style={{ gridTemplateColumns: template }} onClick={onClick} aria-expanded={ariaExpanded}>
      {children}
    </button>
  );
}

/* ── Two-pane shell (Settings design): grouped rail + panel ────────── */

export interface SadbRailItem {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string; style?: React.CSSProperties }>;
  /** Count badge; omit for none. */
  count?: number | string;
}
export interface SadbRailGroup { title?: string; items: SadbRailItem[] }

/** Tab state synced to a URL query param, so every rail/tab is
 *  deep-linkable. Reads once on mount (avoids a Suspense boundary the same
 *  way /admin/users does) and replaces state on change. */
export function useSadbTab(defaultTab: string, param = 'tab'): [string, (t: string) => void] {
  const [tab, setTabState] = useState(defaultTab);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get(param);
    if (v) setTabState(v);
    // Read once on arrival only — later rail clicks own the state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setTab = useCallback((t: string) => {
    setTabState(t);
    const url = new URL(window.location.href);
    url.searchParams.set(param, t);
    window.history.replaceState(null, '', url.toString());
  }, [param]);
  return [tab, setTab];
}

export function SadbShell({ groups, active, onSelect, children }: {
  groups: SadbRailGroup[];
  active: string;
  onSelect: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="sadb-shell">
      <nav className="sadb-rail sadb-card" aria-label="Sections">
        {groups.map((g, gi) => (
          <div key={g.title ?? gi} className="sadb-rail-group">
            {g.title && <p className="sadb-rail-title">{g.title}</p>}
            {g.items.map(it => {
              const IconCmp = it.icon;
              return (
                <button
                  key={it.id}
                  type="button"
                  className={`sadb-rail-item${it.id === active ? ' is-active' : ''}`}
                  aria-current={it.id === active ? 'true' : undefined}
                  onClick={() => onSelect(it.id)}
                >
                  {IconCmp && <IconCmp className="w-[15px] h-[15px] flex-shrink-0" />}
                  <span className="sadb-rail-label">{it.label}</span>
                  {it.count !== undefined && <b className="sadb-rail-badge">{it.count}</b>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sadb-shell-main">{children}</div>
    </div>
  );
}

export function SadbPanelHeader({ title, note, tag, tagTone, actions }: {
  title: string; note?: ReactNode; tag?: ReactNode; tagTone?: ChipTone;
  /**
   * Page actions, sitting on the same line as the title.
   *
   * `SadbPage` also takes an `actions` slot, but it renders as its own row
   * ABOVE the panel — so a page using both showed its buttons stranded on a
   * line of their own with the title beneath them, which reads as two headers
   * rather than one. Passing them here puts them where the eye expects: title
   * left, actions right, one row. `sadb-panel-head` was already a
   * space-between flex row, so this needed no layout change.
   */
  actions?: ReactNode;
}) {
  return (
    <div className="sadb-panel-head">
      <div className="min-w-0">
        <h2 className="sadb-panel-title">{title}</h2>
        {note && <p className="sadb-panel-note">{note}</p>}
      </div>
      {(tag !== undefined || actions) && (
        <div className="sadb-panel-head-end">
          {tag !== undefined && <SadbChip tone={tagTone ?? 'neutral'}>{tag}</SadbChip>}
          {actions}
        </div>
      )}
    </div>
  );
}

/* ── Setting rows (Settings design row kinds) ──────────────────────── */

/** Card group with the tinted head the Settings design draws. */
export function SadbSettingGroup({ title, meta, action, children }: {
  title: string; meta?: ReactNode; action?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="sadb-card">
      <header className="sadb-group-head">
        <h3 className="sadb-group-title">{title}</h3>
        {(meta || action) && (
          <span className="flex items-center gap-3">
            {meta && <span className="sadb-card-meta">{meta}</span>}
            {action}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

/** Label + sub on the left; the control(s) passed as children on the right. */
export function SadbSettingRow({ label, sub, children }: {
  label: ReactNode; sub?: ReactNode; children?: ReactNode;
}) {
  return (
    <div className="sadb-setting-row">
      <div className="sadb-setting-copy">
        <b className="sadb-setting-label">{label}</b>
        {sub && <span className="sadb-setting-sub">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

/** Editable-value control: current value + pencil, opens an editor. */
export function SadbValueButton({ value, onClick, title }: {
  value: ReactNode; onClick: () => void; title?: string;
}) {
  return (
    <button type="button" className="sadb-value-btn" onClick={onClick} title={title ?? 'Edit value'}>
      <span className="sadb-value-text">{value}</span>
      <Pencil className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
    </button>
  );
}

/** The design's 38×21 switch. */
export function SadbToggle({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`sadb-switch${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <i aria-hidden="true" />
    </button>
  );
}

/** Small uppercase outline action button; `danger` for the red variant. */
export function SadbActionButton({ children, onClick, danger, disabled, ariaLabel, title }: {
  children: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean;
  ariaLabel?: string; title?: string;
}) {
  return (
    <button
      type="button"
      className={`sadb-action-btn${danger ? ' is-danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
    >
      {children}
    </button>
  );
}

/* ── Status cards (integrations / endpoints) ───────────────────────── */

export function SadbStatusCard({ name, status, tone, detail, actionLabel, onAction }: {
  name: string; status: ReactNode; tone: ChipTone; detail: ReactNode; actionLabel?: string; onAction?: () => void;
}) {
  return (
    <div className="sadb-status-card sadb-card">
      <div className="sadb-status-card-head">
        <h3 className="sadb-status-name">{name}</h3>
        <span className={`sadb-chip sadb-chip--${tone}`}><i className="sadb-chip-dot" aria-hidden="true" />{status}</span>
      </div>
      <p className="sadb-status-detail">{detail}</p>
      {actionLabel && onAction && (
        <button type="button" className="sadb-head-link" style={{ alignSelf: 'flex-start' }} onClick={onAction}>{actionLabel} ›</button>
      )}
    </div>
  );
}

/* ── Danger zone ───────────────────────────────────────────────────── */

export function SadbDangerZone({ title = 'Audited actions', children }: { title?: string; children: ReactNode }) {
  return (
    <section className="sadb-danger">
      <header className="sadb-danger-head">
        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
        <h3 className="sadb-danger-title">{title}</h3>
      </header>
      {children}
    </section>
  );
}

export function SadbDangerRow({ label, sub, actionLabel, onAction, disabled }: {
  label: ReactNode; sub?: ReactNode; actionLabel: ReactNode; onAction: () => void; disabled?: boolean;
}) {
  return (
    <SadbSettingRow label={label} sub={sub}>
      <SadbActionButton danger onClick={onAction} disabled={disabled}>{actionLabel}</SadbActionButton>
    </SadbSettingRow>
  );
}

/* ── Modals (replace every window.prompt / window.confirm) ─────────── */

export function SadbEditorModal({ title, sub, value, onChange, onCancel, onApply, applyLabel = 'Apply', multiline, busy }: {
  title: string; sub?: ReactNode; value: string; onChange: (v: string) => void;
  onCancel: () => void; onApply: () => void; applyLabel?: string; multiline?: boolean; busy?: boolean;
}) {
  return (
    <Modal onClose={onCancel} width={440} labelledBy="sadb-editor-title">
      <div className="sadb-modal">
        <div className="sadb-modal-copy">
          <h2 id="sadb-editor-title" className="sadb-modal-title">{title}</h2>
          {sub && <p className="sadb-modal-sub">{sub}</p>}
        </div>
        {multiline ? (
          <textarea className="sadb-modal-input" rows={3} value={value} onChange={e => onChange(e.target.value)} autoFocus />
        ) : (
          <input
            className="sadb-modal-input"
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onApply(); }}
            autoFocus
          />
        )}
        <div className="sadb-modal-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onApply} disabled={busy}>{applyLabel}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Confirm for destructive operations. Copy stays honest: actions are
 *  audited; re-authentication is NOT claimed (no backend enforcement yet).
 *  Pass `noteValue`/`onNoteChange` to also capture an optional free-text
 *  note with the confirmation (e.g. a dismissal reason). */
export function SadbConfirmModal({ title, body, confirmLabel = 'Confirm', onCancel, onConfirm, busy, auditNote = true, noteValue, onNoteChange, notePlaceholder }: {
  title: string; body: ReactNode; confirmLabel?: string;
  onCancel: () => void; onConfirm: () => void; busy?: boolean;
  /** Appends "This action is written to the audit log with your identity." */
  auditNote?: boolean;
  noteValue?: string;
  onNoteChange?: (v: string) => void;
  notePlaceholder?: string;
}) {
  return (
    <Modal onClose={onCancel} width={440} labelledBy="sadb-confirm-title">
      <div className="sadb-modal sadb-modal--danger">
        <div className="sadb-modal-copy">
          <h2 id="sadb-confirm-title" className="sadb-modal-title sadb-modal-title--danger">{title}</h2>
          <p className="sadb-modal-sub">
            {body}{auditNote && ' This action is written to the audit log with your identity.'}
          </p>
        </div>
        {onNoteChange && (
          <textarea
            className="sadb-modal-input"
            rows={2}
            value={noteValue ?? ''}
            onChange={e => onNoteChange(e.target.value)}
            placeholder={notePlaceholder ?? 'Optional note'}
            aria-label={notePlaceholder ?? 'Optional note'}
          />
        )}
        <div className="sadb-modal-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-sm sadb-btn-danger" onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Save bar (dirty-state header for batched settings forms) ──────── */

export function SadbSaveBar({ dirtyCount, saving, onSave, onDiscard }: {
  dirtyCount: number; saving?: boolean; onSave: () => void; onDiscard: () => void;
}) {
  if (dirtyCount === 0) {
    return <span className="sadb-saved-chip">All changes saved</span>;
  }
  return (
    <div className="sadb-savebar">
      <span className="sadb-savebar-note">{dirtyCount} unsaved change{dirtyCount === 1 ? '' : 's'}</span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onDiscard} disabled={saving}>Discard</button>
      <button type="button" className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}

'use client';

/**
 * One organization, opened as a card rather than unfolded in place.
 *
 * The super-admin dashboard used to disclose a tenant by expanding its row:
 * the facilities slid in underneath, the rows below moved, and the actions on
 * that tenant — add a facility, add an account, edit it, deactivate it — lived
 * on a different screen entirely. The registry at /admin/organizations already
 * answered the same question with a card; this is that card, shared, and grown
 * to carry what the expansion carried:
 *
 *  • the actions sit in the head, so what you can DO to a tenant is visible
 *    before you have read what it is;
 *  • the facilities (and the accounts inside them) render in the body, so the
 *    disclosure the dashboard lost is still one click away;
 *  • `onExpand` promotes the card to the full page it summarises — the card is
 *    a stop on the way, never a dead end.
 *
 * Both callers pass their own `details`: the registry knows a tenant's sync
 * health, the dashboard knows its patient count, and neither should have to
 * learn the other's query to reuse this.
 */

import type { ReactNode } from 'react';
import Modal from '@/components/Modal';
import { X, Maximize2, Edit3, Ban, Plus, Users } from '@/components/icons/lucide';

export interface TenantCardAction {
  key: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  /** Destructive actions read as such wherever they are placed. */
  tone?: 'default' | 'danger' | 'primary';
}

export default function TenantCard({
  title, context, details, actions, onClose, onExpand, expandLabel, closeLabel, bodyTitle, children,
}: {
  title: string;
  /** The line above the name: what kind of thing this is, and since when. */
  context: string;
  details: Array<{ label: string; value: ReactNode }>;
  /** CRUD on the tenant and on what it contains. Rendered in the head. */
  actions: TenantCardAction[];
  onClose: () => void;
  /** Open the page this card summarises. Omitted when the card IS that page. */
  onExpand?: () => void;
  expandLabel?: string;
  closeLabel: string;
  /** Heading for `children` — e.g. "Facilities & accounts". */
  bodyTitle?: string;
  /** What the row used to unfold: the facilities, and their accounts. */
  children?: ReactNode;
}) {
  const titleId = 'tenant-card-title';
  return (
    /* Wide enough for the tenant tree to draw its six columns at the width the
       list behind it uses (SadbGridList minWidth={880}); at 720 the location
       cell ellipsised and the last column fell off the card. Modal caps rather
       than fixes the width, so a narrow viewport still gets a full-width
       dialog and the tree scrolls inside its own box. */
    <Modal onClose={onClose} width={children ? 980 : 640} labelledBy={titleId}>
      <div className="modal-panel" style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="sadb-card-meta">{context}</p>
            <h2 id={titleId} className="text-lg font-bold mt-1 truncate" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          </div>
          <span className="flex items-center gap-1 flex-shrink-0">
            {onExpand && (
              <button
                type="button"
                className="p-2 rounded-lg"
                onClick={onExpand}
                aria-label={expandLabel}
                title={expandLabel}
                data-action="tenant-card-expand"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            )}
            <button type="button" className="p-2 rounded-lg" onClick={onClose} aria-label={closeLabel}>
              <X className="w-4 h-4" />
            </button>
          </span>
        </div>

        {/* The actions, in the head. They used to sit under the details, which
            put "what can I do about this" below a fold on any card long enough
            to need one — and this card now carries a facility tree. */}
        {actions.length > 0 && (
          <div className="sadb-tenant-actions" data-testid="tenant-card-actions">
            {actions.map(action => (
              <button
                key={action.key}
                type="button"
                className={`sadb-tenant-action${action.tone === 'danger' ? ' is-danger' : action.tone === 'primary' ? ' is-primary' : ''}`}
                onClick={action.onClick}
                data-action={`tenant-${action.key}`}
              >
                {action.icon}{action.label}
              </button>
            ))}
          </div>
        )}

        <div className="py-5">
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-light)' }}>
            {details.map(detail => (
              <div key={detail.label} className="sadb-kv" style={{ padding: '12px 14px' }}>
                <span>{detail.label}</span>
                <span className="sadb-kv-value">{detail.value}</span>
              </div>
            ))}
          </div>
        </div>

        {children && (
          <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {bodyTitle && <p className="sadb-card-meta" style={{ marginBottom: 8 }}>{bodyTitle}</p>}
            {/* Its own scroll box: a tenant with thirty facilities must not
                push the card past the viewport and take its actions with it. */}
            <div
              className="rounded-lg"
              style={{ border: '1px solid var(--border-light)', overflow: 'auto', maxHeight: 340, minHeight: 0 }}
            >
              {/* The floor the columns are drawn against — the same one the
                  tenant list uses, so the card and the list behind it line the
                  same facts up under the same headings. */}
              <div style={{ minWidth: 880 }}>{children}</div>
            </div>
          </div>
        )}

        {/* No footer. Close and "open the full page" are both in the head, and
            a card that offers each of them twice reads as four choices where
            there are two — the eye checks the bottom row against the top one
            before it can be sure. */}
      </div>
    </Modal>
  );
}

/** The icons the two callers use for the same four verbs, named once. */
export const TENANT_ACTION_ICONS = {
  addFacility: <Plus className="w-4 h-4" />,
  addUser: <Plus className="w-4 h-4" />,
  users: <Users className="w-4 h-4" />,
  /* No inline colour on these two: .sadb-tenant-action's filled variants
     repaint both `color` and the `stroke` attribute lucide writes out, which
     is what a hard-coded white would have frozen against a rebranded fill. */
  edit: <Edit3 className="w-4 h-4" />,
  deactivate: <Ban className="w-4 h-4" />,
};

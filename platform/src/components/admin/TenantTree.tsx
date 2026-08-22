'use client';

/**
 * The tenant tree on the super-admin dashboard: an organization's facilities,
 * and a facility's accounts.
 *
 * Lives here rather than inside the dashboard page so all three depths can be
 * rendered under test — the accounts depth is invisible on any database whose
 * users carry no facility, which is how it shipped unexercised.
 */

import { useMemo, useState } from 'react';
import { ChevronRight } from '@/components/icons/lucide';
import { SadbChip } from '@/components/admin/sadb-ui';
import { abbreviateProviderName } from '@/lib/patient-utils';
import { getRoleConfig } from '@/lib/permissions';
import type { HospitalDoc, UserDoc } from '@/lib/db-types';

/* Same six-column template the tenant registry on /admin/organizations draws,
   so the two lists of the same thing read as one surface — and the one
   template every depth of this tree uses, which is what keeps a facility's
   cells under the same headings as its organization's. */
export const ORG_GRID_TEMPLATE = 'minmax(200px,1.6fr) repeat(5, minmax(96px,1fr))';

/* Facility levels spelled out — the console shows two tenants side by side, so
   the /hospitals abbreviations (NR, PHCC) would need a legend here. */
export const FACILITY_TYPE_LABELS: Record<string, string> = {
  national_referral: 'National referral',
  state_hospital: 'State hospital',
  county_hospital: 'County hospital',
  phcc: 'PHCC',
  phcu: 'PHCU',
};

/**
 * The facilities behind one tenant, and the accounts behind one facility.
 *
 * All three depths draw on the tenant list's own six-column template, so a
 * reader's eye follows one set of columns down the whole tree. They used to
 * carry a template each — 6 tracks, then 5 indented by 40px, then 4 inside a
 * bordered box — plus a header row apiece, so two expansions stacked three
 * headers and three misaligned column sets inside one card.
 *
 * A child row leaves a parent-only measure blank rather than inventing a
 * column for something it doesn't have, and depth reads from the indent and
 * rail on the first cell instead of from tints and boxes.
 *
 * One interaction rule at every depth: clicking a row discloses what is inside
 * it. Opening a facility's own dashboard is the link on its name — it used to
 * be a hit area stretched across the whole row, so aiming at the sync chip
 * navigated away from the page.
 */
export function OrgFacilities({ facilities, usersByFacility, loading, onOpen }: {
  facilities: HospitalDoc[];
  /** Accounts attached to each facility, keyed by facility id. */
  usersByFacility: Map<string, UserDoc[]>;
  loading: boolean;
  onOpen: (hospitalId: string) => void;
}) {
  /* A set, not one id: comparing who staffs two sites is a reason to open
     both, the same argument the tenant rows above make. */
  const [openUsers, setOpenUsers] = useState<Set<string>>(new Set());
  const toggleUsers = (id: string) => setOpenUsers(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  if (facilities.length === 0) {
    return <p className="sadb-subrow-empty" style={{ ['--depth' as string]: 1 }}>No facilities registered for this organization yet.</p>;
  }

  return (
    <>
      {facilities.map(f => {
        const retired = f.isActive === false;
        const facilityUsers = usersByFacility.get(f._id) || [];
        const usersOpen = openUsers.has(f._id);
        return (
          <div key={f._id}>
            <div
              className={`sadb-tenant-grid sadb-subrow${usersOpen ? ' is-open' : ''}`}
              style={{ gridTemplateColumns: ORG_GRID_TEMPLATE, ['--depth' as string]: 1 }}
              role="button"
              tabIndex={0}
              aria-expanded={usersOpen}
              aria-controls={`facusers-${f._id}`}
              onClick={() => toggleUsers(f._id)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleUsers(f._id); }
              }}
            >
              <span className="min-w-0 flex items-center gap-1.5">
                <ChevronRight className="sadb-subrow-caret w-3.5 h-3.5 flex-shrink-0" aria-hidden />
                {/* The one thing on this row that leaves the page, and the only
                    part of it you have to aim at to do so. */}
                <button
                  type="button"
                  className="sadb-subrow-link truncate"
                  style={{ color: retired ? 'var(--text-muted)' : undefined }}
                  onClick={e => { e.stopPropagation(); onOpen(f._id); }}
                  title={`Open ${f.name}`}
                >
                  {f.name}{retired ? ' · retired' : ''}
                </button>
              </span>
              <span className="truncate">{FACILITY_TYPE_LABELS[f.facilityType] || f.facilityType}</span>
              <span className="truncate">{[f.town, f.state].filter(Boolean).join(', ') || '—'}</span>
              <span className="sadb-tenant-num">{loading ? '…' : facilityUsers.length}</span>
              <span className="sadb-subrow-blank">—</span>
              <span style={{ textAlign: 'end' }}>
                {/* No sync chip: HospitalDoc.syncStatus is frozen at record
                    creation (every app-created facility read "offline"
                    forever). Real liveness lives in sync events — reintroduce
                    only from that source. */}
              </span>
            </div>
            {usersOpen && (
              <FacilityUserList id={`facusers-${f._id}`} users={facilityUsers} facilityId={f._id} />
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * The accounts attached to one facility.
 *
 * Home sites sort first: a user whose `hospitalId` is this facility works
 * here, while one who reaches it through `facilityIds` covers it from
 * somewhere else, and an operator reading a staffing question needs to tell
 * those apart. Leaf rows — there is nothing inside an account to disclose —
 * so they are text, not controls.
 */
export function FacilityUserList({ id, users, facilityId }: { id: string; users: UserDoc[]; facilityId: string }) {
  const rows = useMemo(() => [...users].sort((a, b) => {
    const home = Number(b.hospitalId === facilityId) - Number(a.hospitalId === facilityId);
    return home || a.name.localeCompare(b.name);
  }), [users, facilityId]);

  if (rows.length === 0) {
    return (
      <p className="sadb-subrow-empty" id={id} style={{ ['--depth' as string]: 2 }}>
        No accounts are attached to this facility yet.
      </p>
    );
  }

  return (
    <div id={id}>
      {rows.map(u => (
        <div
          key={u._id}
          className="sadb-tenant-grid sadb-subrow sadb-subrow--leaf"
          style={{ gridTemplateColumns: ORG_GRID_TEMPLATE, ['--depth' as string]: 2 }}
        >
          <span className="min-w-0">
            <span className="sadb-subrow-name truncate">{abbreviateProviderName(u.name)}</span>
            <span className="sadb-subrow-sub truncate">@{u.username}</span>
          </span>
          <span className="truncate">{getRoleConfig(u.role).label}</span>
          <span className="truncate">{u.hospitalId === facilityId ? 'Home site' : 'Covering'}</span>
          <span className="sadb-subrow-blank">—</span>
          <span className="sadb-subrow-blank">—</span>
          <span style={{ textAlign: 'end' }}>
            <SadbChip tone={u.isActive === false ? 'neutral' : 'green'}>
              {u.isActive === false ? 'inactive' : 'active'}
            </SadbChip>
          </span>
        </div>
      ))}
    </div>
  );
}

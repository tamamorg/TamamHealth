'use client';

/**
 * One facility's page.
 *
 * This lived inside `FacilityNetworkView.tsx`, a component whose other half
 * was the national "Health Facility Performance" list at `/hospitals`. That
 * route was deleted in 2026-08 and the list went unreferenced with it, so the
 * profile was the only live export of a 1,000-line file — 500 lines of which
 * were a screen nothing could reach. Extracted here; the rest is gone.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MapPin, Phone, Mail, UserPlus, Edit3, Ban, RotateCcw,
} from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  SadbCard, SadbChip, SadbGridList, SadbGridRow, SadbKpiTile, SadbSearch,
} from '@/components/admin/sadb-ui';
import { CreateUserModal, CredentialHandoffModal, type CreatedCredentials } from '@/modules/identity/client';
import { canCreateUsers } from '@/lib/people-nav';
import { isFacilityActive } from '@/lib/services/hospital-service';
import { getRoleConfig } from '@/lib/permissions';
import { formatDate } from '@/lib/format-utils';
import { userWorksAtFacility } from '@/modules/tenancy/client';
import type { DataScope } from '@/lib/services/data-scope';
import type { HospitalDoc, UserDoc } from '@/lib/db-types';

/* Account · Role · Status · Last login — the same row anatomy the
   organization page's facility list uses, so dropping a level does not
   re-flow the reader's expectations. */
const STAFF_GRID = 'minmax(200px, 1.7fr) minmax(140px, 1fr) minmax(100px, 0.7fr) minmax(110px, 0.8fr)';

/** How many role tiles ride the KPI strip before the tail is summed into one. */
const ROLE_TILE_CAP = 4;

const TYPE_LABEL_KEYS: Record<string, string> = {
  national_referral: 'hospitals.typeNationalReferral',
  state_hospital: 'hospitals.typeStateHospital',
  county_hospital: 'hospitals.typeCountyHospital',
  phcc: 'hospitals.typePhcc',
  phcu: 'hospitals.typePhcu',
};

const OWNERSHIP_LABEL_KEYS: Record<string, string> = {
  public: 'hospitals.ownershipPublic',
  ngo: 'hospitals.ownershipNgo',
  private: 'hospitals.ownershipPrivate',
  faith_based: 'hospitals.ownershipFaithBased',
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  functional: 'hospitals.statusFunctional',
  partially_functional: 'hospitals.statusPartial',
  non_functional: 'hospitals.statusNonFunctional',
  closed: 'hospitals.statusClosed',
};

const STATUS_COLORS: Record<string, string> = {
  functional: 'var(--accent-primary)',
  partially_functional: 'var(--color-warning)',
  non_functional: 'var(--color-danger)',
  closed: 'var(--text-muted)',
};

/**
 * ONE FACILITY — its people.
 *
 * The page is the roster. A facility row on the organization page is clicked
 * to answer "who works here", so that is what opens: the staff list, already
 * there, with Add user beside it.
 *
 * It has been three other things. First a profile whose seven management
 * sections (staff, wards, equipment, inventory, schedules, performance,
 * settings) hid behind a `Overview ▾` DROPDOWN — one mounted at a time, the
 * other six invisible until you opened a menu to discover they existed. Then a
 * column of nine folded cards, which made them visible and turned the page
 * into a table of contents: nine headings and no content, and the roster you
 * came for was the third row down.
 *
 * What the other sections did is not stranded — each has a module of its own
 * (`/wards`, `/equipment`, `/pharmacy`, `/hr/schedule`,
 * `/facility-assessments`), and the facility's own record is edited through
 * the Edit button in this header.
 */
export function FacilityProfile({ hospital, canCreate, onEdit, onRetire }: {
  hospital: HospitalDoc;
  /* There is no `canManage` gate on the roster.
     It guarded the seven management sections, which are gone, and applying it
     to the roster would leave a `hospital_manager` — a role with `person:view`
     but outside FACILITY_MANAGE_ROLES — on a facility page holding nothing but
     a heading. `StaffTab` gates its own Add-user button on `canCreateUsers`,
     and every read underneath is scoped, so reading the roster is the right
     default for anyone who could open this page at all. */
  /** Registering, editing and retiring are all organisation-level acts. */
  canCreate: boolean;
  onEdit: () => void;
  onRetire: () => void;
}) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const router = useRouter();

  // Scope every service call the roster makes to this facility, in this org,
  // as this role — the same object the standalone manage page built from the URL.
  const scope: DataScope | undefined = useMemo(() => {
    if (!currentUser) return undefined;
    return { role: currentUser.role, orgId: currentUser.orgId, hospitalId: hospital._id };
  }, [currentUser, hospital._id]);

  /* Adding staff belongs beside Edit facility: hiring into a facility is
     something you decide while looking at the facility. Reading the roster and
     writing to it are different grants — the superintendent and HRIO who reach
     this page are not /api/users' WRITE_ROLES — so the button is gated on
     canCreateUsers, not on canManage. */
  const canAddUser = canCreateUsers(currentUser?.role || '');
  const [showAddUser, setShowAddUser] = useState(false);
  const [userHandoff, setUserHandoff] = useState<CreatedCredentials | null>(null);
  const contact = hospital as unknown as { phone?: string; email?: string };

  /* ── The roster ────────────────────────────────────────────────────── */
  const [staff, setStaff] = useState<UserDoc[] | null>(null);
  const [search, setSearch] = useState('');

  const loadStaff = useCallback(async () => {
    if (!scope) return;
    try {
      const { getAllUsers } = await import('@/modules/identity/services/user-service');
      const all = await getAllUsers(scope);
      // `filterByScope` has already answered the tenant question; this is the
      // facility one — home site or covered site, the rule stated once in
      // `userWorksAtFacility` so every count of "who works here" agrees.
      setStaff(all.filter(user => userWorksAtFacility(user, hospital._id)));
    } catch (error) {
      console.error('Failed to load facility staff:', error);
      // Unknown, not empty — a failed read has not proved an absence.
      setStaff(null);
    }
  }, [scope, hospital._id]);

  useEffect(() => { void loadStaff(); }, [loadStaff]);

  /**
   * The strip above the roster: how many people, and in what roles.
   *
   * Role tiles replace the "All roles" dropdown that used to sit beside the
   * search. A dropdown made you open it to find out which roles the facility
   * even had; the tiles say so on arrival, and each one narrows the list to
   * that role — so it filters AND answers, where the select only filtered.
   */
  const roleTiles = useMemo(() => {
    if (!staff) return [];
    const counts = new Map<string, number>();
    for (const user of staff) counts.set(user.role, (counts.get(user.role) ?? 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const head = ranked.slice(0, ROLE_TILE_CAP);
    const tail = ranked.slice(ROLE_TILE_CAP);
    return [
      ...head.map(([role, count]) => ({ role, label: getRoleConfig(role as UserDoc['role']).label, count })),
      // Never a silent truncation: the tail is summed rather than dropped.
      ...(tail.length
        ? [{
          role: null,
          label: t('management.otherRoles', { count: tail.length }),
          count: tail.reduce((sum, [, count]) => sum + count, 0),
        }]
        : []),
    ];
  }, [staff, t]);

  /** Set by clicking a role tile; '' is every role. */
  const [roleFilter, setRoleFilter] = useState('');

  const visibleStaff = useMemo(() => {
    if (!staff) return [];
    const query = search.trim().toLowerCase();
    return staff
      .filter(user => !roleFilter || user.role === roleFilter)
      .filter(user => !query || `${user.name} ${user.username}`.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [staff, roleFilter, search]);

  const activeStaff = staff?.filter(user => user.isActive !== false).length ?? null;

  return (
    <>
      {/* ═══ Identity, and everything you can do TO this facility ═══ */}
      <div className="sadb-card" style={{ gap: 10, padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <h2 className="sadb-panel-title truncate" style={{ marginBottom: 6 }}>{hospital.name}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-secondary)' }}>
              <span className="badge" style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)', fontSize: 11 }}>
                {TYPE_LABEL_KEYS[hospital.facilityType] ? t(TYPE_LABEL_KEYS[hospital.facilityType]) : hospital.facilityType}
              </span>
              {hospital.ownership && <span style={{ color: 'var(--text-muted)' }}>{t(OWNERSHIP_LABEL_KEYS[hospital.ownership])}</span>}
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--text-muted)' }}>
                <MapPin style={{ width: 12, height: 12 }} />{hospital.town}, {hospital.state}
              </span>
              {hospital.operationalStatus && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600, color: STATUS_COLORS[hospital.operationalStatus] }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLORS[hospital.operationalStatus] }} />
                  {t(STATUS_LABEL_KEYS[hospital.operationalStatus])}
                </span>
              )}
              {contact.phone && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--text-muted)' }}>
                  <Phone style={{ width: 12, height: 12 }} />{contact.phone}
                </span>
              )}
              {contact.email && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--text-muted)' }}>
                  <Mail style={{ width: 12, height: 12 }} />{contact.email}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
            {/* Add user is NOT here. It is the Staff card's head action, one
                card down, directly above the list it adds a row to — this
                line held a second copy of the same button. */}
            {canCreate && (
              <>
                <button type="button" onClick={onEdit} className="btn btn-secondary btn-sm" style={{ gap: 4 }} data-action="edit-facility">
                  <Edit3 style={{ width: 13, height: 13 }} /> {t('orgHospitals.edit')}
                </button>
                <button
                  type="button"
                  onClick={onRetire}
                  className={isFacilityActive(hospital)
                    ? 'btn btn-sm sadb-btn-danger'
                    : 'btn btn-secondary btn-sm'}
                  style={{ gap: 4 }}
                  data-action={isFacilityActive(hospital) ? 'retire-facility' : 'restore-facility'}
                >
                  {isFacilityActive(hospital)
                    ? <><Ban style={{ width: 13, height: 13 }} /> {t('orgHospitals.retire')}</>
                    : <><RotateCcw style={{ width: 13, height: 13 }} /> {t('orgHospitals.restore')}</>}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Who works here, and in what roles ═══ */}
      <div className="sadb-kpi-row">
        <SadbKpiTile
          label={t('hospitals.tabStaff')}
          value={staff === null ? '…' : staff.length}
          delta={activeStaff === null ? undefined : t('management.activeCount', { count: activeStaff })}
          onClick={roleFilter ? () => setRoleFilter('') : undefined}
        />
        {roleTiles.map(tile => (
          <SadbKpiTile
            key={tile.role ?? 'other'}
            label={tile.label}
            value={tile.count}
            delta={tile.role && roleFilter === tile.role ? t('management.filtering') : undefined}
            deltaTone={tile.role && roleFilter === tile.role ? 'up' : undefined}
            onClick={tile.role
              ? () => setRoleFilter(current => (current === tile.role ? '' : tile.role as string))
              : undefined}
          />
        ))}
      </div>

      {/* ═══ THE ROSTER — the page, not a section of it ═══ */}
      <SadbCard
        title={t('hospitals.tabStaff')}
        meta={staff === null
          ? undefined
          : t('management.showingOf', { shown: visibleStaff.length, total: staff.length })}
        action={canAddUser ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-action="add-facility-user"
            onClick={() => setShowAddUser(true)}
          >
            <UserPlus className="w-4 h-4" /> {t('hospitals.addUser')}
          </button>
        ) : undefined}
      >
        <div className="sadb-search-row" style={{ paddingBottom: 12 }}>
          <SadbSearch
            value={search}
            onChange={setSearch}
            placeholder={t('hospitals.searchNameUsername')}
            ariaLabel={t('hospitals.searchNameUsername')}
          />
          {/* The "All roles" select is gone. The tiles above are the filter,
              and unlike the select they say what there is to filter BY before
              you click. This clears whichever one is engaged. */}
          {roleFilter && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRoleFilter('')}>
              {t('management.clearRoleFilter', { role: getRoleConfig(roleFilter as UserDoc['role']).label })}
            </button>
          )}
        </div>

        <SadbGridList
          template={STAFF_GRID}
          minWidth={620}
          head={[
            t('management.person'),
            t('orgUsers.colRole'),
            t('hospitals.colLastLogin'),
            // Status is LAST, because the chip is what `alignEndLast` pins to
            // the end of the row — heading it third put "last login" under
            // "Status" and the chip under "Last login".
            t('management.status'),
          ]}
          alignEndLast
          empty={staff === null ? t('orgAdmin.loading') : t('hospitals.emptyStaff')}
        >
          {visibleStaff.map(user => {
            const inactive = user.isActive === false;
            const lastLogin = (user as unknown as { lastLoginAt?: string }).lastLoginAt;
            return (
              <SadbGridRow
                key={user._id}
                template={STAFF_GRID}
                onClick={() => router.push(
                  `/admin/users/${encodeURIComponent(user._id)}`
                  + `?returnTo=${encodeURIComponent(`/admin/facilities/${hospital._id}`)}`,
                )}
              >
                <span className="min-w-0">
                  <span className="sadb-tenant-name truncate">{user.name}</span>
                  <span className="sadb-tenant-sub truncate">@{user.username}</span>
                </span>
                <span className="truncate">{getRoleConfig(user.role).label}</span>
                <span className="truncate">{lastLogin ? formatDate(lastLogin) : '—'}</span>
                <span style={{ textAlign: 'end' }}>
                  <SadbChip tone={inactive ? 'neutral' : 'green'}>
                    {inactive ? t('management.inactive') : t('management.active')}
                  </SadbChip>
                </span>
              </SadbGridRow>
            );
          })}
        </SadbGridList>
      </SadbCard>

      {showAddUser && (
        <CreateUserModal
          hospitals={[hospital]}
          presetHospitalId={hospital._id}
          lockFacility
          onClose={() => setShowAddUser(false)}
          onCreated={(credentials) => {
            setShowAddUser(false);
            // The temporary password is unrecoverable once this closes.
            setUserHandoff(credentials);
            // Re-read, or the facility shows one person short.
            void loadStaff();
          }}
        />
      )}
      {userHandoff && (
        <CredentialHandoffModal
          title={t('orgUsers.handoffCreatedTitle')}
          description={t('orgUsers.handoffDescription')}
          username={userHandoff.username}
          password={userHandoff.password}
          invitation={userHandoff.invitation}
          onClose={() => setUserHandoff(null)}
        />
      )}
    </>
  );
}

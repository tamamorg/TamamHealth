'use client';

import { CreateUserModal, CredentialHandoffModal } from '@/modules/identity/client';
import type { CreatedCredentials } from '@/modules/identity/client';
/**
 * The per-facility management surface: Staff, Wards, Equipment, Inventory,
 * Schedules, Performance and Settings for one hospital.
 *
 * This used to be a page of its own at /hospitals/[hospitalId]/manage, reached
 * by a "Manage" button on the facility profile — so a facility's record and the
 * work you do on that facility lived on two screens, and getting from one to
 * the other meant a navigation and a trip back. The tabs now mount inside the
 * facility profile on /hospitals (the profile's own content is its Overview
 * tab), and the old route redirects into it. Nothing was dropped in the move:
 * the header facts that only the manage page carried — contacts and the
 * occupancy estimate — moved onto the profile.
 *
 * Every service call takes the caller's DataScope with the URL's hospitalId,
 * so a user from another org who guesses an id still gets an empty result:
 * filterByScope drops rows whose orgId doesn't match.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import TableCols from '@/components/TableCols';
import {
  Building2, Users, BedDouble, Package, Pill, Calendar,
  Activity, Settings, Loader2, AlertTriangle, CheckCircle, Save,
  Phone, Plus, FlaskConical, Syringe, ArrowLeft, UserPlus, Stethoscope,
} from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { FilterBar, SearchInput, FilterSelect } from '@/components/filters';
import type {
  HospitalDoc, UserDoc, UserRole, AppointmentDoc, PrescriptionDoc,
  ImmunizationDoc, LabResultDoc, StaffScheduleDoc, PharmacyInventoryDoc,
} from '@/lib/db-types';
import type { WardDoc, AdmissionDoc } from '@/lib/db-types-ward';
import type { AssetDoc } from '@/lib/db-types-asset';
import type { DataScope } from '@/lib/services/data-scope';
import { useToast } from '@/components/Toast';
import { isValidPhone, isValidEmail, normalizePhone, normalizeEmail } from '@/lib/field-formats';
import Select from '@/components/Select';
import { todayIso } from '@/lib/date-utils';
import { getPerformanceColor } from '@/lib/performance-colors';
import { canCreateUsers } from '@/lib/people-nav';
import { useApp } from '@/lib/context';

// ── Permission ───────────────────────────────────────────────────────────────
/** Roles that may open a facility's management tabs. */
export const FACILITY_MANAGE_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'medical_superintendent', 'hrio',
];

/** org_admin + super_admin can write facility settings; the others read-only. */
export const FACILITY_SETTINGS_WRITE_ROLES: UserRole[] = ['super_admin', 'org_admin'];

// ── Tab definitions ─────────────────────────────────────────────────────────
export type FacilityTabId =
  | 'staff' | 'wards' | 'equipment' | 'inventory'
  | 'schedules' | 'performance' | 'settings';

export const FACILITY_MANAGE_TABS: { id: FacilityTabId; labelKey: string; icon: typeof Building2 }[] = [
  { id: 'staff',       labelKey: 'hospitals.tabStaff',       icon: Users },
  { id: 'wards',       labelKey: 'hospitals.tabWards',       icon: BedDouble },
  { id: 'equipment',   labelKey: 'hospitals.tabEquipment',   icon: Package },
  { id: 'inventory',   labelKey: 'hospitals.tabInventory',   icon: Pill },
  { id: 'schedules',   labelKey: 'hospitals.tabSchedules',   icon: Calendar },
  { id: 'performance', labelKey: 'hospitals.tabPerformance', icon: Activity },
  { id: 'settings',    labelKey: 'hospitals.tabSettings',    icon: Settings },
];

/**
 * Renders the body of one management tab for `hospital`.
 *
 * Only the active tab is mounted, so an unopened tab fires no fetch — the
 * property the old page depended on, kept here.
 */
export default function FacilityManageTabs({ hospital, tab, scope, canWriteSettings, onHospitalSaved, staffRefreshToken }: {
  hospital: HospitalDoc;
  tab: FacilityTabId;
  scope: DataScope | undefined;
  canWriteSettings: boolean;
  onHospitalSaved: (hospital: HospitalDoc) => void;
  /** Bumped when an account is created from the profile header, so the roster
   *  below re-reads instead of showing the facility one person short. */
  staffRefreshToken?: number;
}) {
  const hospitalId = hospital._id;
  return (
    <>
      {tab === 'staff' && <StaffTab scope={scope} hospitalId={hospitalId} hospital={hospital} refreshToken={staffRefreshToken} />}
      {tab === 'wards' && <WardsTab scope={scope} hospitalId={hospitalId} hospital={hospital} />}
      {tab === 'equipment' && <EquipmentTab scope={scope} hospitalId={hospitalId} />}
      {tab === 'inventory' && <InventoryTab scope={scope} hospitalId={hospitalId} />}
      {tab === 'schedules' && <SchedulesTab hospitalId={hospitalId} />}
      {tab === 'performance' && <PerformanceTab scope={scope} hospitalId={hospitalId} hospital={hospital} />}
      {tab === 'settings' && (
        <SettingsTab hospital={hospital} canWrite={canWriteSettings} onSaved={onHospitalSaved} />
      )}
    </>
  );
}

// ─── Shared little pieces ────────────────────────────────────────────────────
function LoadingBlock({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="card-elevated" style={{ padding: 40, textAlign: 'center' }}>
      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label ?? t('status.loading')}</p>
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="card-elevated" style={{ padding: 40, textAlign: 'center' }}>
      <AlertTriangle className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--color-danger)' }} />
      <p style={{ fontSize: 12, color: 'var(--color-danger-text)' }}>{message}</p>
    </div>
  );
}

function EmptyBlock({ icon: Icon, label }: { icon: typeof Building2; label: string }) {
  return (
    <div className="card-elevated" style={{ padding: 40, textAlign: 'center' }}>
      <Icon className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
      <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const { t } = useTranslation();
  const map: Record<string, { bg: string; color: string; label: string }> = {
    functional: { bg: 'rgba(79, 199, 155,0.12)', color: 'var(--color-success)', label: t('hospitals.statusFunctional') },
    partially_functional: { bg: 'rgba(253, 217, 95,0.12)', color: 'var(--color-warning)', label: t('hospitals.statusPartiallyFunctional') },
    non_functional: { bg: 'rgba(224, 49, 39,0.12)', color: 'var(--color-danger)', label: t('hospitals.statusNonFunctional') },
    closed: { bg: 'rgba(148, 162, 179,0.12)', color: 'var(--text-muted)', label: t('hospitals.statusClosed') },
  };
  const tok = map[status] || map.closed;
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full"
      style={{ background: tok.bg, color: tok.color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: tok.color }} />
      {tok.label}
    </span>
  );
}

function formatRelative(iso?: string, t?: (key: string, vars?: Record<string, string | number>) => string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return t ? t('hospitals.timeJustNow') : 'just now';
  if (min < 60) return t ? t('hospitals.timeMinutesAgo', { count: min }) : `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return t ? t('hospitals.timeHoursAgo', { count: hr }) : `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return t ? t('hospitals.timeDaysAgo', { count: days }) : `${days}d ago`;
}

function StaffTab({ scope, hospitalId, hospital, refreshToken }: {
  scope: DataScope | undefined;
  hospitalId: string;
  hospital: HospitalDoc;
  refreshToken?: number;
}) {
  const { t } = useTranslation();
  const { currentUser } = useApp();
  const { showToast } = useToast();
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  // Adding staff to the facility you are standing in. Reading this roster and
  // writing to it are different grants: the superintendent and HRIO who reach
  // this tab are not /api/users' WRITE_ROLES, so the button is gated on
  // canCreateUsers rather than on having got here.
  const canAddUser = canCreateUsers(currentUser?.role || '');
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [handoff, setHandoff] = useState<CreatedCredentials | null>(null);

  const loadUsers = useCallback(async () => {
    if (!scope) return;
    setLoading(true);
    setError(null);
    try {
      const { getAllUsers } = await import('@/modules/identity/services/user-service');
      const all = await getAllUsers(scope);
      // Narrow to this facility (data-scope already restricted to orgId).
      setUsers(all.filter(u => u.hospitalId === hospitalId));
    } catch {
      setError(t('hospitals.errorLoadStaff'));
    } finally {
      setLoading(false);
    }
  }, [scope, hospitalId, t]);

  // `refreshToken` is in the deps on purpose: an account created from the
  // header is written by a different component, so nothing else here would
  // know the roster changed.
  useEffect(() => { loadUsers(); }, [loadUsers, refreshToken]);

  const addUserButton = canAddUser ? (
    <button
      type="button"
      className="btn btn-primary btn-sm"
      style={{ gap: 4 }}
      onClick={() => setShowCreateUser(true)}
      data-action="add-facility-user"
    >
      <UserPlus style={{ width: 13, height: 13 }} color="#fff" /> {t('hospitals.addUser')}
    </button>
  ) : null;

  const userDialogs = (
    <>
      {showCreateUser && (
        <CreateUserModal
          hospitals={[hospital]}
          presetHospitalId={hospitalId}
          lockFacility
          onClose={() => setShowCreateUser(false)}
          onCreated={async (credentials) => {
            setShowCreateUser(false);
            // The temporary password is unrecoverable once this closes.
            setHandoff(credentials);
            showToast(t('hospitals.userAdded', { name: hospital.name }), 'success');
            await loadUsers();
          }}
        />
      )}
      {handoff && (
        <CredentialHandoffModal
          title={t('orgUsers.handoffCreatedTitle')}
          description={t('orgUsers.handoffDescription')}
          username={handoff.username}
          password={handoff.password}
          invitation={handoff.invitation}
          onClose={() => setHandoff(null)}
        />
      )}
    </>
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(u => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (!q) return true;
      return (u.name || '').toLowerCase().includes(q) ||
             (u.username || '').toLowerCase().includes(q);
    });
  }, [users, search, roleFilter]);

  const roleCounts = useMemo(() => {
    const m: Record<string, number> = {};
    users.forEach(u => { m[u.role] = (m[u.role] || 0) + 1; });
    return m;
  }, [users]);

  if (loading) return <LoadingBlock label={t('hospitals.loadingStaff')} />;
  if (error) return <ErrorBlock message={error} />;
  // An empty roster is where adding staff matters most, so the empty state
  // carries the action rather than describing the absence and stopping.
  if (users.length === 0) {
    return (
      <>
        <div className="card-elevated" style={{ padding: 40, textAlign: 'center' }}>
          <Users className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: canAddUser ? 12 : 0 }}>
            {t('hospitals.emptyStaff')}
          </p>
          {addUserButton}
        </div>
        {userDialogs}
      </>
    );
  }

  return (
    <div className="card-elevated" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-light)' }}>
        <FilterBar>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('hospitals.searchNameUsername')}
            aria-label={t('hospitals.searchNameUsername')}
          />
          <FilterSelect
            value={roleFilter}
            onChange={setRoleFilter}
            options={[
              { value: 'all', label: t('hospitals.allRoles') },
              ...Object.keys(roleCounts).map(r => ({
                value: r,
                label: `${r.replace(/_/g, ' ')} (${roleCounts[r]})`,
              })),
            ]}
            aria-label={t('hospitals.colRole')}
          />
          <FilterBar.Spacer />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {t('hospitals.countOf', { shown: filtered.length, total: users.length })}
          </span>
          {addUserButton}
        </FilterBar>
      </div>
      <div style={{ overflow: 'auto' }}>
        <table className="data-table" style={{ minWidth: 600, tableLayout: 'fixed' }}>
          <TableCols widths={[1.6, 1.2, 1.1, 0.8, 1.1]} />
          <thead>
            <tr>
              <th>{t('hospitals.colName')}</th>
              <th>{t('hospitals.colUsername')}</th>
              <th>{t('hospitals.colRole')}</th>
              <th>{t('hospitals.colStatus')}</th>
              <th>{t('hospitals.colLastLogin')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => {
              const initials = (u.name || '').split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
              const last = (u as unknown as { lastLoginAt?: string }).lastLoginAt;
              return (
                <tr key={u._id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: 8,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'linear-gradient(135deg, #2191D0 0%, #015697 100%)',
                        color: '#fff', fontSize: 11, fontWeight: 700,
                      }}>{initials || '?'}</div>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{u.name}</span>
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>@{u.username}</td>
                  <td>
                    <span className="badge" style={{ fontSize: 10, background: 'var(--accent-light)', color: 'var(--accent-primary)' }}>
                      {u.role.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td>
                    {u.isActive ? (
                      <span style={{ fontSize: 11, color: 'var(--color-success-text)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-success)' }} />
                        {t('hospitals.statusActive')}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('hospitals.statusDisabled')}</span>
                    )}
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatRelative(last, t)}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>{t('hospitals.noMatches')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {userDialogs}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  WARDS TAB
// ═══════════════════════════════════════════════════════════════════════════
function WardsTab({ scope, hospitalId, hospital }: {
  scope: DataScope | undefined;
  hospitalId: string;
  hospital: HospitalDoc;
}) {
  const [wards, setWards] = useState<WardDoc[]>([]);
  const [admissions, setAdmissions] = useState<AdmissionDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();
  const { t } = useTranslation();

  const load = useCallback(async () => {
    if (!scope) return;
    setLoading(true);
    setError(null);
    try {
      const [{ getAllWards, getActiveAdmissions }] = await Promise.all([
        import('@/lib/services/ward-service'),
      ]);
      const [w, a] = await Promise.all([getAllWards(scope), getActiveAdmissions(scope)]);
      setWards(w.filter(x => x.facilityId === hospitalId));
      setAdmissions(a.filter(x => x.facilityId === hospitalId));
    } catch {
      setError(t('hospitals.errorLoadWards'));
    } finally {
      setLoading(false);
    }
  }, [scope, hospitalId, t]);

  useEffect(() => { load(); }, [load]);

  const handleQuickCreate = async () => {
    const name = window.prompt(t('hospitals.newWardPrompt'));
    if (!name?.trim()) return;
    try {
      const { createWard } = await import('@/lib/services/ward-service');
      await createWard({
        name: name.trim(),
        wardType: 'general_male',
        facilityId: hospitalId,
        facilityName: hospital.name,
        facilityLevel: hospital.facilityLevel || 'county',
        totalBeds: 0,
        isActive: true,
        orgId: hospital.orgId,
      });
      showToast(t('hospitals.toastWardCreated', { name }), 'success');
      load();
    } catch {
      showToast(t('hospitals.toastWardCreateFailed'), 'error');
    }
  };

  if (loading) return <LoadingBlock label={t('hospitals.loadingWards')} />;
  if (error) return <ErrorBlock message={error} />;

  return (
    <div className="card-elevated" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
          {t('hospitals.wardsSummary', { wards: wards.length, admissions: admissions.length })}
        </span>
        <button onClick={handleQuickCreate} className="btn btn-primary btn-sm" style={{ gap: 4 }}>
          <Plus style={{ width: 13, height: 13 }} /> {t('hospitals.newWard')}
        </button>
      </div>
      {wards.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <BedDouble className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('hospitals.emptyWards')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
        <table className="data-table" style={{ minWidth: 720, tableLayout: 'fixed' }}>
          <TableCols widths={[1.7, 1.1, 0.8, 0.8, 0.9, 1.1]} />
          <thead>
            <tr>
              <th>{t('hospitals.colName')}</th>
              <th>{t('hospitals.colType')}</th>
              <th>{t('hospitals.colTotalBeds')}</th>
              <th>{t('hospitals.colOccupied')}</th>
              <th>{t('hospitals.colAvailable')}</th>
              <th>{t('hospitals.colActiveAdmissions')}</th>
            </tr>
          </thead>
          <tbody>
            {wards.map(w => {
              const wardAdmissions = admissions.filter(a => a.wardId === w._id).length;
              return (
                <tr key={w._id}>
                  <td style={{ fontWeight: 600 }}>{w.name}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{w.wardType.replace(/_/g, ' ')}</td>
                  <td className="stat-value">{w.totalBeds}</td>
                  <td className="stat-value">{w.occupiedBeds}</td>
                  <td className="stat-value">{w.availableBeds}</td>
                  <td className="stat-value">{wardAdmissions}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  EQUIPMENT TAB
// ═══════════════════════════════════════════════════════════════════════════
function EquipmentTab({ scope, hospitalId }: { scope: DataScope | undefined; hospitalId: string }) {
  const { t } = useTranslation();
  const [assets, setAssets] = useState<AssetDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    if (!scope) return;
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const { getAllAssets } = await import('@/lib/services/asset-service');
        const all = await getAllAssets(scope);
        if (alive) setAssets(all.filter(a => a.facilityId === hospitalId));
      } catch {
        if (alive) setError(t('hospitals.errorLoadEquipment'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [scope, hospitalId, t]);

  const statusColors: Record<string, string> = {
    operational: 'var(--color-success)',
    needs_service: 'var(--color-warning)',
    under_repair: 'var(--color-warning)',
    decommissioned: 'var(--text-muted)',
    lost_or_stolen: 'var(--color-danger)',
  };

  const filtered = useMemo(() =>
    statusFilter === 'all' ? assets : assets.filter(a => a.status === statusFilter),
  [assets, statusFilter]);

  if (loading) return <LoadingBlock label={t('hospitals.loadingEquipment')} />;
  if (error) return <ErrorBlock message={error} />;
  if (assets.length === 0) return <EmptyBlock icon={Package} label={t('hospitals.emptyEquipment')} />;

  return (
    <div className="card-elevated" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-light)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <Select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{
            background: 'var(--bg-card)', color: 'var(--text-primary)',
            border: '1px solid var(--border-light)', borderRadius: 'var(--input-radius)',
            padding: '5px 12px', fontSize: 12, minHeight: 30,
          }}
        >
          <option value="all">{t('hospitals.allStatuses')}</option>
          <option value="operational">{t('hospitals.equipOperational')}</option>
          <option value="needs_service">{t('hospitals.equipNeedsService')}</option>
          <option value="under_repair">{t('hospitals.equipUnderRepair')}</option>
          <option value="decommissioned">{t('hospitals.equipDecommissioned')}</option>
          <option value="lost_or_stolen">{t('hospitals.equipLostStolen')}</option>
        </Select>
        <span style={{ marginInlineStart: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
          {t('hospitals.countOf', { shown: filtered.length, total: assets.length })}
        </span>
      </div>
      <div className="overflow-x-auto">
      <table className="data-table" style={{ minWidth: 720, tableLayout: 'fixed' }}>
        <TableCols widths={[1.9, 1.1, 1, 0.9, 1, 1.1]} />
        <thead>
          <tr>
            <th>{t('hospitals.colAsset')}</th>
            <th>{t('hospitals.colCategory')}</th>
            <th>{t('hospitals.colTag')}</th>
            <th>{t('hospitals.colStatus')}</th>
            <th>{t('hospitals.colCondition')}</th>
            <th>{t('hospitals.colLastService')}</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(a => (
            <tr key={a._id}>
              <td>
                <div style={{ fontWeight: 600 }}>{a.name}</div>
                {a.model && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.manufacturer} · {a.model}</div>}
              </td>
              <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.category.replace(/_/g, ' ')}</td>
              <td style={{ fontFamily: 'var(--font-platform-mono)', fontSize: 11 }}>{a.assetTag}</td>
              <td>
                <span style={{
                  fontSize: 11, fontWeight: 600,
                  color: statusColors[a.status] || 'var(--text-muted)',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusColors[a.status] || 'var(--text-muted)' }} />
                  {a.status.replace(/_/g, ' ')}
                </span>
              </td>
              <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.condition}</td>
              <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatRelative(a.lastServicedAt, t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  INVENTORY TAB
// ═══════════════════════════════════════════════════════════════════════════
function InventoryTab({ scope, hospitalId }: { scope: DataScope | undefined; hospitalId: string }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<PharmacyInventoryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!scope) return;
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const { getAllInventory } = await import('@/lib/services/pharmacy-inventory-service');
        const all = await getAllInventory(scope);
        if (alive) setItems(all.filter(x => x.hospitalId === hospitalId));
      } catch {
        if (alive) setError(t('hospitals.errorLoadInventory'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [scope, hospitalId, t]);

  if (loading) return <LoadingBlock label={t('hospitals.loadingInventory')} />;
  if (error) return <ErrorBlock message={error} />;
  if (items.length === 0) return <EmptyBlock icon={Pill} label={t('hospitals.emptyInventory')} />;

  return (
    <div className="card-elevated" style={{ overflow: 'hidden' }}>
      <div className="overflow-x-auto">
      <table className="data-table" style={{ minWidth: 720, tableLayout: 'fixed' }}>
        <TableCols widths={[1.9, 1.1, 0.8, 0.9, 1, 1]} />
        <thead>
          <tr>
            <th>{t('hospitals.colMedication')}</th>
            <th>{t('hospitals.colCategory')}</th>
            <th>{t('hospitals.colStock')}</th>
            <th>{t('hospitals.colStatus')}</th>
            <th>{t('hospitals.colExpiry')}</th>
            <th>{t('hospitals.colBatch')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map(i => {
            const ratio = i.reorderLevel ? i.stockLevel / i.reorderLevel : 1;
            const expired = i.expiryDate && i.expiryDate < todayIso();
            const status: { label: string; bg: string; color: string } = expired
              ? { label: t('hospitals.stockExpired'), bg: 'rgba(224, 49, 39,0.12)', color: 'var(--color-danger)' }
              : i.stockLevel <= 0
                ? { label: t('hospitals.stockOut'), bg: 'rgba(224, 49, 39,0.12)', color: 'var(--color-danger)' }
                : ratio < 0.3
                  ? { label: t('hospitals.stockCritical'), bg: 'rgba(224, 49, 39,0.12)', color: 'var(--color-danger)' }
                  : ratio < 1
                    ? { label: t('hospitals.stockLow'), bg: 'rgba(253, 217, 95,0.12)', color: 'var(--color-warning)' }
                    : { label: t('hospitals.stockOk'), bg: 'rgba(79, 199, 155,0.12)', color: 'var(--color-success)' };
            return (
              <tr key={i._id}>
                <td style={{ fontWeight: 600 }}>{i.medicationName}</td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{i.category}</td>
                <td className="stat-value">{i.stockLevel} {i.unit}</td>
                <td>
                  <span className="badge" style={{ fontSize: 10, background: status.bg, color: status.color }}>
                    {status.label}
                  </span>
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{i.expiryDate || '—'}</td>
                <td style={{ fontSize: 11, fontFamily: 'var(--font-platform-mono)', color: 'var(--text-muted)' }}>{i.batchNumber}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  SCHEDULES TAB
// ═══════════════════════════════════════════════════════════════════════════
function SchedulesTab({ hospitalId }: { hospitalId: string }) {
  const { t } = useTranslation();
  const today = todayIso();
  const [date, setDate] = useState(today);
  const [schedules, setSchedules] = useState<StaffScheduleDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const { getSchedulesByDate } = await import('@/lib/services/staff-scheduling-service');
        const s = await getSchedulesByDate(date, hospitalId);
        if (alive) setSchedules(s);
      } catch {
        if (alive) setError(t('hospitals.errorLoadSchedules'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [date, hospitalId, t]);

  return (
    <div className="card-elevated" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-light)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('hospitals.dateLabel')}</label>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border-light)',
            color: 'var(--text-primary)', borderRadius: 'var(--input-radius)',
            padding: '4px 10px', fontSize: 12,
          }}
        />
        <span style={{ marginInlineStart: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
          {t('hospitals.shiftsCount', { count: schedules.length })}
        </span>
      </div>
      {loading ? <LoadingBlock label={t('hospitals.loadingSchedules')} />
       : error ? <ErrorBlock message={error} />
       : schedules.length === 0 ? (
         <div style={{ padding: 32, textAlign: 'center' }}>
           <Calendar className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
           <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('hospitals.emptySchedules')}</p>
         </div>
       ) : (
        <div className="overflow-x-auto">
        <table className="data-table" style={{ minWidth: 720, tableLayout: 'fixed' }}>
          <TableCols widths={[1.7, 1.1, 1, 1, 1.2, 0.9]} />
          <thead>
            <tr>
              <th>{t('hospitals.colStaff')}</th>
              <th>{t('hospitals.colRole')}</th>
              <th>{t('hospitals.colShift')}</th>
              <th>{t('hospitals.colTime')}</th>
              <th>{t('hospitals.colDepartment')}</th>
              <th>{t('hospitals.colStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map(s => (
              <tr key={s._id}>
                <td style={{ fontWeight: 600 }}>{s.userName}</td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.role.replace(/_/g, ' ')}</td>
                <td>
                  <span className="badge" style={{ fontSize: 10, background: 'var(--accent-light)', color: 'var(--accent-primary)' }}>
                    {s.shiftType.replace('_', ' ')}
                  </span>
                </td>
                <td style={{ fontFamily: 'var(--font-platform-mono)', fontSize: 11 }}>{s.startTime} – {s.endTime}</td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.department || '—'}</td>
                <td style={{ fontSize: 11 }}>{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
       )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  PERFORMANCE TAB
// ═══════════════════════════════════════════════════════════════════════════
function PerformanceTab({ scope, hospitalId, hospital }: {
  scope: DataScope | undefined; hospitalId: string; hospital: HospitalDoc;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kpis, setKpis] = useState({
    visitsToday: 0,
    activeAdmissions: 0,
    dischargesToday: 0,
    transfersToday: 0,
    labTatHours: 0,
    prescriptionsDispensedToday: 0,
    immunizationsToday: 0,
  });

  useEffect(() => {
    if (!scope) return;
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const today = todayIso();
        const [
          { getTodaysAppointments },
          { getAllAdmissions },
          { getAllLabResults },
          { getAllPrescriptions },
          { getAllImmunizations },
        ] = await Promise.all([
          import('@/lib/services/appointment-service'),
          import('@/lib/services/ward-service'),
          import('@/lib/services/lab-service'),
          import('@/lib/services/prescription-service'),
          import('@/lib/services/immunization-service'),
        ]);

        const [apts, admns, labs, rx, immuns] = await Promise.all([
          getTodaysAppointments(scope),
          getAllAdmissions(scope),
          getAllLabResults(scope),
          getAllPrescriptions(scope),
          getAllImmunizations(scope),
        ]);

        const hereApts = (apts as AppointmentDoc[]).filter(a => a.facilityId === hospitalId);
        const hereAdmns = (admns as AdmissionDoc[]).filter(a => a.facilityId === hospitalId);
        const hereLabs = (labs as LabResultDoc[]).filter(l => l.hospitalId === hospitalId);
        const hereRx = (rx as PrescriptionDoc[]).filter(p => p.hospitalId === hospitalId);
        const hereImmuns = (immuns as ImmunizationDoc[]).filter(i =>
          (i as unknown as { facilityId?: string }).facilityId === hospitalId,
        );

        // Discharges today: admissions whose dischargeDate is today
        const dischargesToday = hereAdmns.filter(a => (a.dischargeDate || '').slice(0, 10) === today).length;
        const transfersToday = hereAdmns.filter(a =>
          a.dischargeType === 'transfer' && (a.dischargeDate || '').slice(0, 10) === today,
        ).length;
        const activeAdmissions = hereAdmns.filter(a => a.status === 'admitted').length;

        // Lab TAT (hours, mean over completed labs from this facility)
        const completedLabs = hereLabs.filter(l => l.status === 'completed' && l.orderedAt && l.completedAt);
        const tat = completedLabs.length
          ? completedLabs.reduce((s, l) => {
              const o = new Date(l.orderedAt).getTime();
              const c = new Date(l.completedAt).getTime();
              return s + Math.max(0, (c - o) / 3600000);
            }, 0) / completedLabs.length
          : 0;

        const dispensedToday = hereRx.filter(p =>
          p.status === 'dispensed' && (p.dispensedAt || '').slice(0, 10) === today,
        ).length;

        const immunsToday = hereImmuns.filter(i => {
          const when = (i as unknown as { administeredAt?: string; date?: string }).administeredAt
            || (i as unknown as { date?: string }).date;
          return when && when.slice(0, 10) === today;
        }).length;

        if (alive) {
          setKpis({
            visitsToday: hereApts.length,
            activeAdmissions,
            dischargesToday,
            transfersToday,
            labTatHours: Math.round(tat * 10) / 10,
            prescriptionsDispensedToday: dispensedToday,
            immunizationsToday: immunsToday,
          });
        }
      } catch {
        if (alive) setError(t('hospitals.errorLoadPerformance'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [scope, hospitalId, t]);

  if (loading) return <LoadingBlock label={t('hospitals.loadingPerformance')} />;
  if (error) return <ErrorBlock message={error} />;

  const cards: { label: string; value: number | string; icon: typeof Calendar; tint: string }[] = [
    { label: t('hospitals.kpiVisitsToday'),       value: kpis.visitsToday,                  icon: Calendar,    tint: 'var(--accent-primary)' },
    { label: t('hospitals.kpiActiveAdmissions'),  value: kpis.activeAdmissions,             icon: BedDouble,   tint: '#FFD2A6' },
    { label: t('hospitals.kpiDischargesToday'),   value: kpis.dischargesToday,              icon: CheckCircle, tint: 'var(--color-success)' },
    { label: t('hospitals.kpiTransfersToday'),    value: kpis.transfersToday,               icon: ArrowLeft,   tint: 'var(--accent-primary)' },
    { label: t('hospitals.kpiAvgLabTat'),         value: kpis.labTatHours || '—',           icon: FlaskConical, tint: 'var(--color-warning)' },
    { label: t('hospitals.kpiRxDispensedToday'),  value: kpis.prescriptionsDispensedToday,  icon: Pill,        tint: 'var(--chart-2)' },
    { label: t('hospitals.kpiImmunizationsToday'), value: kpis.immunizationsToday,          icon: Syringe,     tint: 'var(--accent-primary)' },
  ];

  /* The facility's last assessment, above today's throughput.
     Two different questions wear the word "performance": what this facility
     did today, and how well it is set up to do it at all. The tab answered
     only the first, so a reader who arrived from a 52% reporting score — the
     organization page links straight here — landed on a board that never
     mentions reporting. Same scores, same four-band ramp, same component. */
  const assessment = hospital.performance;
  const scores: { label: string; value: number | undefined }[] = assessment ? [
    { label: t('hospitals.kpiReporting'), value: assessment.reportingCompleteness },
    { label: t('hospitals.kpiReadiness'), value: assessment.serviceReadinessScore },
    { label: t('hospitals.colMedicines'), value: assessment.tracerMedicineAvailability },
    { label: t('hospitals.colStaffing'), value: assessment.staffingScore },
    { label: t('hospitals.colAncCoverage'), value: assessment.ancCoverage },
    { label: t('hospitals.colEpiCoverage'), value: assessment.immunizationCoverage },
  ] : [];

  return (
    <>
      <div className="fac-assess">
        <p className="fac-assess-head">{t('hospitals.assessmentTitle')}</p>
        {scores.length === 0 ? (
          <p className="fac-assess-empty">{t('hospitals.assessmentNone')}</p>
        ) : (
          <div className="fac-assess-grid">
            {scores.map(sc => (
              <div key={sc.label} className="fac-assess-item">
                <span className="fac-assess-label">{sc.label}</span>
                <span className="orgfac-meter">
                  <span className="orgfac-meter-track">
                    {typeof sc.value === 'number' && (
                      <span
                        className="orgfac-meter-fill"
                        style={{ width: `${Math.max(0, Math.min(100, sc.value))}%`, background: getPerformanceColor(sc.value) }}
                      />
                    )}
                  </span>
                  <b
                    className="orgfac-meter-value"
                    style={{ color: typeof sc.value === 'number' ? getPerformanceColor(sc.value) : 'var(--text-muted)' }}
                  >
                    {typeof sc.value === 'number' ? `${sc.value}%` : '—'}
                  </b>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="kpi-grid">
        {cards.map(c => (
          <div key={c.label} className="kpi">
            <div className="icon-box-sm">
              <c.icon style={{ color: c.tint }} />
            </div>
            <div className="kpi__body">
              <div className="kpi__value">{c.value}</div>
              <div className="kpi__label">{c.label}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  SETTINGS TAB (write-gated)
// ═══════════════════════════════════════════════════════════════════════════
function SettingsTab({ hospital, canWrite, onSaved }: {
  hospital: HospitalDoc;
  canWrite: boolean;
  onSaved: (h: HospitalDoc) => void;
}) {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const [name, setName] = useState(hospital.name || '');
  const [phone, setPhone] = useState((hospital as unknown as { phone?: string }).phone || '');
  const [email, setEmail] = useState((hospital as unknown as { email?: string }).email || '');
  const [operationalStatus, setOperationalStatus] = useState<string>(hospital.operationalStatus || 'functional');
  const [services, setServices] = useState({
    epi: hospital.serviceFlags?.epi || false,
    anc: hospital.serviceFlags?.anc || false,
    delivery: hospital.serviceFlags?.delivery || false,
    hiv: hospital.serviceFlags?.hiv || false,
    tb: hospital.serviceFlags?.tb || false,
    emergencySurgery: hospital.serviceFlags?.emergencySurgery || false,
    laboratory: hospital.serviceFlags?.laboratory || false,
    pharmacy: hospital.serviceFlags?.pharmacy || false,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ phone?: string; email?: string }>({});

  const handleSave = useCallback(async () => {
    if (!canWrite) return;
    // Phone/email are optional — block save only when a non-empty value is
    // malformed (isValid* return true for empty).
    const fe: { phone?: string; email?: string } = {};
    if (!isValidPhone(phone)) fe.phone = t('validation.errPhone');
    if (!isValidEmail(email)) fe.email = t('validation.errEmail');
    setFieldErrors(fe);
    if (Object.keys(fe).length > 0) return;
    setSaving(true);
    setErr(null);
    try {
      // Normalize to canonical form before persisting.
      const normPhone = normalizePhone(phone) ?? phone;
      const normEmail = normalizeEmail(email);
      const { updateHospitalStatus } = await import('@/lib/services/hospital-service');
      const updated = await updateHospitalStatus(hospital._id, {
        name: name.trim() || hospital.name,
        operationalStatus: operationalStatus as HospitalDoc['operationalStatus'],
        serviceFlags: services,
        // Phone / email are not part of the HospitalDoc type today but the
        // doc is a free-form PouchDB record — extra fields are preserved
        // round-trip without a migration.
        ...(normPhone ? { phone: normPhone } : {}),
        ...(normEmail ? { email: normEmail } : {}),
      } as Partial<HospitalDoc>);
      if (updated) {
        onSaved(updated);
        showToast(t('hospitals.toastFacilityUpdated'), 'success');
      } else {
        setErr(t('hospitals.updateFailed'));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('hospitals.updateFailed'));
    } finally {
      setSaving(false);
    }
  }, [canWrite, hospital._id, hospital.name, name, operationalStatus, services, phone, email, onSaved, showToast, t]);

  const toggleService = (key: keyof typeof services) => {
    setServices(s => ({ ...s, [key]: !s[key] }));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {!canWrite && (
        <div className="card-elevated lg:col-span-2" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(253, 217, 95,0.10)' }}>
          <AlertTriangle style={{ width: 16, height: 16, color: 'var(--color-warning)' }} />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {t('hospitals.readOnlyNotice')}
          </span>
        </div>
      )}

      {/* Profile */}
      <div className="card-elevated" style={{ padding: 16 }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>{t('hospitals.profile')}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Field label={t('hospitals.fieldFacilityName')}>
            <input
              disabled={!canWrite}
              value={name}
              onChange={e => setName(e.target.value)}
              style={inputStyle(canWrite)}
            />
          </Field>
          <Field label={t('hospitals.fieldPhone')}>
            <input
              disabled={!canWrite}
              value={phone}
              onChange={e => { setPhone(e.target.value); if (fieldErrors.phone) setFieldErrors(fe => ({ ...fe, phone: undefined })); }}
              aria-invalid={!!fieldErrors.phone}
              style={inputStyle(canWrite)}
            />
            {fieldErrors.phone && <p className="text-[11px] mt-1" role="alert" style={{ color: 'var(--color-danger-text)' }}>{fieldErrors.phone}</p>}
          </Field>
          <Field label={t('hospitals.fieldEmail')}>
            <input
              type="email"
              disabled={!canWrite}
              value={email}
              onChange={e => { setEmail(e.target.value); if (fieldErrors.email) setFieldErrors(fe => ({ ...fe, email: undefined })); }}
              aria-invalid={!!fieldErrors.email}
              style={inputStyle(canWrite)}
            />
            {fieldErrors.email && <p className="text-[11px] mt-1" role="alert" style={{ color: 'var(--color-danger-text)' }}>{fieldErrors.email}</p>}
          </Field>
          <Field label={t('hospitals.operatingStatus')}>
            <Select
              disabled={!canWrite}
              value={operationalStatus}
              onChange={e => setOperationalStatus(e.target.value)}
              style={inputStyle(canWrite)}
            >
              <option value="functional">{t('hospitals.statusFunctional')}</option>
              <option value="partially_functional">{t('hospitals.statusPartiallyFunctional')}</option>
              <option value="non_functional">{t('hospitals.statusNonFunctional')}</option>
              <option value="closed">{t('hospitals.statusClosed')}</option>
            </Select>
          </Field>
        </div>
      </div>

      {/* Services Offered */}
      <div className="card-elevated" style={{ padding: 16 }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>{t('hospitals.servicesOffered')}</h3>
        <div className="data-row-divider-sm" style={{ display: 'flex', flexDirection: 'column' }}>
          {[
            { key: 'epi', label: t('hospitals.serviceEpi') },
            { key: 'anc', label: t('hospitals.serviceAnc') },
            { key: 'delivery', label: t('hospitals.serviceDelivery') },
            { key: 'hiv', label: t('hospitals.serviceHiv') },
            { key: 'tb', label: t('hospitals.serviceTb') },
            { key: 'emergencySurgery', label: t('hospitals.serviceEmergencySurgery') },
            { key: 'laboratory', label: t('hospitals.serviceLaboratory') },
            { key: 'pharmacy', label: t('hospitals.servicePharmacy') },
          ].map(svc => (
            <div key={svc.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{svc.label}</span>
              <button
                disabled={!canWrite}
                onClick={() => toggleService(svc.key as keyof typeof services)}
                className="tbn-toggle"
                style={{
                  background: services[svc.key as keyof typeof services] ? 'var(--accent-primary)' : 'var(--toggle-track)',
                  opacity: canWrite ? 1 : 0.5,
                  cursor: canWrite ? 'pointer' : 'not-allowed',
                }}
              >
                <span
                  className="tbn-toggle__knob"
                  style={{ transform: services[svc.key as keyof typeof services] ? 'translateX(22px)' : 'translateX(3px)' }}
                />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Save */}
      <div className="lg:col-span-2 flex items-center justify-end gap-3">
        {err && (
          <span className="text-xs font-bold flex items-center gap-1" style={{ color: 'var(--color-danger-text)' }}>
            <AlertTriangle className="w-3.5 h-3.5" /> {err}
          </span>
        )}
        <button
          disabled={!canWrite || saving}
          onClick={handleSave}
          className="btn btn-primary btn-sm"
          style={{ gap: 6 }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? t('hospitals.saving') : t('hospitals.saveChanges')}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}

function inputStyle(enabled: boolean): React.CSSProperties {
  return {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-light)',
    color: 'var(--text-primary)',
    borderRadius: 'var(--input-radius)',
    padding: '8px 12px',
    fontSize: 13,
    width: '100%',
    outline: 'none',
    opacity: enabled ? 1 : 0.6,
    cursor: enabled ? 'text' : 'not-allowed',
  };
}

// Stethoscope import is reserved for future tab additions; reference it here
// so the import isn't flagged unused.
void Stethoscope;

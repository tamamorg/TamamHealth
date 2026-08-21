'use client';

/**
 * Organization admin settings are a policy/configuration hub. Full operational
 * editors stay on their dedicated org-admin pages; this panel summarizes those
 * areas and links to the canonical editor to avoid duplicate management UI.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/context';
import {
  ArrowUpRight, Building2, CheckCircle, CreditCard, ExternalLink, Info, Lock,
  Mail, Palette, Shield, Timer, Users, XCircle, Zap,
} from '@/components/icons/lucide';
import type { HospitalDoc, OrganizationDoc, UserDoc } from '@/lib/db-types';
import type { FeeScheduleDoc } from '@/lib/db-types-billing';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import Select from '@/components/Select';

export type OrganizationSettingsSection =
  | 'profile'
  | 'subscription'
  | 'security'
  | 'modules'
  | 'branding'
  | 'facilities'
  | 'people'
  | 'billing';

type Props = {
  section: OrganizationSettingsSection;
  users?: UserDoc[];
  hospitals?: HospitalDoc[];
  onNavigate?: (panelId: string) => void;
};

const sectionCopy: Record<OrganizationSettingsSection, { title: string; note: string; icon: typeof Building2 }> = {
  profile: { title: 'Organization profile', note: 'Tenant identity and official contact information', icon: Building2 },
  subscription: { title: 'Subscription & limits', note: 'Plan status, seat capacity, and facility capacity', icon: CreditCard },
  security: { title: 'Security policy', note: 'Shared-device lock behavior for this organization', icon: Shield },
  modules: { title: 'Modules & feature access', note: 'Plan-gated modules available to this tenant', icon: Zap },
  branding: { title: 'Branding & patient-facing details', note: 'How this organization appears across staff and patient surfaces', icon: Palette },
  facilities: { title: 'Facilities', note: 'Facility coverage and canonical management route', icon: Building2 },
  people: { title: 'People & access', note: 'Account coverage and role distribution', icon: Users },
  billing: { title: 'Billing & service pricing', note: 'Charging setup, price catalog, and payment-facing details', icon: CreditCard },
};

export default function OrganizationSettingsPanel({ section, users = [], hospitals = [], onNavigate }: Props) {
  const { t } = useTranslation();
  const { currentUser, refreshCurrentUser } = useAuth();
  const { showToast } = useToast();
  const [org, setOrg] = useState<OrganizationDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [lockTimeout, setLockTimeout] = useState<number>(1);
  const [savingTimeout, setSavingTimeout] = useState(false);
  const [fees, setFees] = useState<FeeScheduleDoc[]>([]);

  const brandColor = currentUser?.branding?.primaryColor || 'var(--accent-primary)';

  useEffect(() => {
    if (!currentUser?.orgId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { getOrganizationById } = await import('@/lib/services/organization-service');
        const o = await getOrganizationById(currentUser.orgId!);
        if (!cancelled && o) {
          setOrg(o);
          setLockTimeout(o.lockTimeoutMinutes ?? 1);
        }
      } catch (err) {
        console.error('Failed to load org settings:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [currentUser?.orgId]);

  useEffect(() => {
    if (!currentUser || section !== 'billing') return;
    let cancelled = false;
    const loadFees = async () => {
      try {
        const { getFeeSchedule } = await import('@/lib/services/fee-schedule-service');
        const rows = await getFeeSchedule({
          orgId: currentUser.orgId,
          hospitalId: currentUser.hospitalId,
          role: currentUser.role,
        });
        if (!cancelled) setFees(rows);
      } catch {
        if (!cancelled) setFees([]);
      }
    };
    loadFees();
    return () => { cancelled = true; };
  }, [currentUser, section]);

  const planLabels: Record<string, string> = {
    basic: t('orgSettings.planBasic'),
    professional: t('orgSettings.planProfessional'),
    enterprise: t('orgSettings.planEnterprise'),
  };

  const statusColors: Record<string, string> = {
    active: 'var(--accent-primary)',
    trial: 'var(--color-warning)',
    suspended: 'var(--color-danger)',
    cancelled: '#6B7F96',
  };

  const featureFlags = org?.featureFlags ? [
    { key: 'epidemicIntelligence', label: t('orgSettings.flagEpidemicIntelligence'), desc: t('orgSettings.flagEpidemicIntelligenceDesc') },
    { key: 'mchAnalytics', label: t('orgSettings.flagMchAnalytics'), desc: t('orgSettings.flagMchAnalyticsDesc') },
    { key: 'dhis2Export', label: t('orgSettings.flagDhis2Export'), desc: t('orgSettings.flagDhis2ExportDesc') },
    { key: 'aiClinicalSupport', label: t('orgSettings.flagAiClinicalSupport'), desc: t('orgSettings.flagAiClinicalSupportDesc') },
    { key: 'communityHealth', label: t('orgSettings.flagCommunityHealth'), desc: t('orgSettings.flagCommunityHealthDesc') },
    { key: 'facilityAssessments', label: t('orgSettings.flagFacilityAssessments'), desc: t('orgSettings.flagFacilityAssessmentsDesc') },
  ] : [];

  const roleCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const user of users) map.set(user.role, (map.get(user.role) || 0) + 1);
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [users]);

  const facilityTypes = useMemo(() => {
    const map = new Map<string, number>();
    for (const hospital of hospitals) map.set(hospital.facilityType, (map.get(hospital.facilityType) || 0) + 1);
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [hospitals]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: brandColor }} />
      </div>
    );
  }

  const meta = sectionCopy[section];
  const Icon = meta.icon;

  const header = (action?: ReactNode) => (
    <div className="org-set-head">
      <span><Icon /></span>
      <div>
        <h3>{meta.title}</h3>
        <small>{meta.note}</small>
      </div>
      {action}
    </div>
  );

  const goButton = (label: string, panelId: string) => (
    <button type="button" className="org-set-link-btn" onClick={() => onNavigate?.(panelId)}>
      {label} <ArrowUpRight />
    </button>
  );

  return (
    <div className="org-set-panel">
      {section === 'profile' && (
        <>
          {header(goButton('Edit brand details', 'org-branding-editor'))}
          <div className="org-set-readonly">
            <Lock />
            <p>Core tenant identity is governed by the platform record. Branding and patient-facing copy can be edited from the branding page.</p>
          </div>
          <div className="org-set-grid two">
            <OrgInfoCard title="Identity" icon={<Building2 />}>
              <InfoRow label={t('orgSettings.fieldName')} value={org?.name || '-'} />
              <InfoRow label={t('orgSettings.fieldSlug')} value={org?.slug || '-'} mono />
              <InfoRow label={t('orgSettings.fieldType')} value={org?.orgType === 'public' ? t('orgSettings.publicSector') : t('orgSettings.privateSector')} />
              <InfoRow label={t('orgSettings.fieldCountry')} value={org?.country || '-'} />
            </OrgInfoCard>
            <OrgInfoCard title="Contact & status" icon={<Mail />}>
              <InfoRow label={t('orgSettings.fieldContactEmail')} value={org?.contactEmail || '-'} />
              <InfoRow label={t('orgSettings.fieldStatus')} value={org?.isActive ? t('orgSettings.statusActive') : t('orgSettings.statusInactive')} badge badgeColor={org?.isActive ? 'var(--accent-primary)' : 'var(--color-danger)'} />
              <InfoRow label={t('orgSettings.fieldCreated')} value={formatDate(org?.createdAt)} />
              <InfoRow label={t('orgSettings.fieldLastUpdated')} value={formatDate(org?.updatedAt)} />
            </OrgInfoCard>
          </div>
        </>
      )}

      {section === 'subscription' && (
        <>
          {header()}
          <div className="org-set-meter-row">
            <UsageMeter label="Users" value={users.length} max={org?.maxUsers || 0} />
            <UsageMeter label="Facilities" value={hospitals.length} max={org?.maxHospitals || 0} />
          </div>
          <div className="org-set-grid two">
            <OrgInfoCard title="Plan" icon={<CreditCard />}>
              <InfoRow label={t('orgSettings.fieldPlan')} value={planLabels[org?.subscriptionPlan || ''] || '-'} badge badgeColor={brandColor} />
              <InfoRow label={t('orgSettings.fieldStatus')} value={org?.subscriptionStatus || '-'} badge badgeColor={statusColors[org?.subscriptionStatus || ''] || '#6B7F96'} />
              <InfoRow label={t('orgSettings.fieldMaxUsers')} value={String(org?.maxUsers || '-')} />
              <InfoRow label={t('orgSettings.fieldMaxHospitals')} value={String(org?.maxHospitals || '-')} />
            </OrgInfoCard>
            <OrgInfoCard title="Plan changes" icon={<Info />}>
              <p className="org-set-copy">Subscription changes are handled by the platform administrator so limits stay aligned with billing, reporting, and support commitments.</p>
            </OrgInfoCard>
          </div>
        </>
      )}

      {section === 'security' && (
        <>
          {header()}
          <div className="org-set-grid two">
            <OrgInfoCard title={t('orgSettings.screenLockTimeout')} icon={<Timer />}>
              <p className="org-set-copy">{t('orgSettings.screenLockTimeoutDesc')}</p>
              <div className="org-set-control-row">
                <Select className="ehr-set-select" value={lockTimeout} onChange={event => setLockTimeout(Number(event.target.value))}>
                  <option value={1}>{t('orgSettings.minuteOne')}</option>
                  <option value={2}>{t('orgSettings.minutes', { count: 2 })}</option>
                  <option value={5}>{t('orgSettings.minutes', { count: 5 })}</option>
                  <option value={10}>{t('orgSettings.minutes', { count: 10 })}</option>
                  <option value={15}>{t('orgSettings.minutes', { count: 15 })}</option>
                  <option value={30}>{t('orgSettings.minutes', { count: 30 })}</option>
                </Select>
                <button
                  className="ehr-set-btn primary"
                  disabled={savingTimeout || lockTimeout === (org?.lockTimeoutMinutes ?? 1)}
                  onClick={async () => {
                    if (!org) return;
                    setSavingTimeout(true);
                    try {
                      const { updateOrganization } = await import('@/lib/services/organization-service');
                      await updateOrganization(org._id, { lockTimeoutMinutes: lockTimeout }, currentUser?._id, currentUser?.username);
                      setOrg({ ...org, lockTimeoutMinutes: lockTimeout });
                      // The idle timer reads `currentUser.organization`, not this
                      // local copy — refresh the session or the new timeout only
                      // takes effect after the next sign-in.
                      await refreshCurrentUser();
                      localStorage.setItem('tamamhealth-lock-timeout', String(lockTimeout * 60_000));
                      showToast(t('orgSettings.toastTimeoutUpdated'), 'success');
                    } catch {
                      showToast(t('orgSettings.toastTimeoutFailed'), 'error');
                    } finally {
                      setSavingTimeout(false);
                    }
                  }}
                >
                  {savingTimeout ? t('orgSettings.saving') : t('action.save')}
                </button>
              </div>
            </OrgInfoCard>
            <OrgInfoCard title={t('orgSettings.lockBehavior')} icon={<Lock />}>
              <ul className="org-set-list">
                <li>{t('orgSettings.lockBehaviorImmediate')}</li>
                <li>{lockTimeout === 1 ? t('orgSettings.lockBehaviorAfterOne') : t('orgSettings.lockBehaviorAfter', { count: lockTimeout })}</li>
                <li>{t('orgSettings.lockBehaviorPin')}</li>
                <li>{t('orgSettings.lockBehaviorSwitchUser')}</li>
              </ul>
            </OrgInfoCard>
          </div>
        </>
      )}

      {section === 'modules' && (
        <>
          {header()}
          <div className="org-set-feature-grid">
            {featureFlags.map(flag => {
              const enabled = org?.featureFlags?.[flag.key as keyof typeof org.featureFlags] || false;
              return (
                <div key={flag.key} className="org-set-feature" data-enabled={enabled}>
                  {enabled ? <CheckCircle /> : <XCircle />}
                  <div>
                    <b>{flag.label}</b>
                    <span>{flag.desc}</span>
                  </div>
                </div>
              );
            })}
            {featureFlags.length === 0 && <div className="org-set-empty">{t('orgSettings.noFeatureFlags')}</div>}
          </div>
          <div className="org-set-readonly">
            <Info />
            <p>{t('orgSettings.featureFlagsInfo')}</p>
          </div>
        </>
      )}

      {section === 'branding' && (
        <>
          {header(goButton('Open branding editor', 'org-branding-editor'))}
          <div className="org-set-grid two">
            <OrgInfoCard title="Brand identity" icon={<Palette />}>
              <InfoRow label="Logo" value={org?.logoUrl ? 'Configured' : 'Not configured'} badge badgeColor={org?.logoUrl ? 'var(--accent-primary)' : '#6B7F96'} />
              <InfoRow label="Primary color" value={org?.primaryColor || '-'} mono />
              <InfoRow label="Secondary color" value={org?.secondaryColor || '-'} mono />
              <InfoRow label="Accent color" value={org?.accentColor || '-'} mono />
            </OrgInfoCard>
            <OrgInfoCard title="Patient-facing billing details" icon={<CreditCard />}>
              <InfoRow label="Bank transfer details" value={org?.bankDetails ? 'Configured' : 'Not configured'} badge badgeColor={org?.bankDetails ? 'var(--accent-primary)' : '#6B7F96'} />
              <p className="org-set-copy">Bank instructions appear in patient payment surfaces. Keep them in the branding editor so there is one source of truth.</p>
            </OrgInfoCard>
          </div>
        </>
      )}

      {section === 'facilities' && (
        <>
          {header(goButton('Manage facilities', 'org-facilities-editor'))}
          <div className="org-set-meter-row">
            <UsageMeter label="Facilities configured" value={hospitals.length} max={org?.maxHospitals || 0} />
          </div>
          <OrgInfoCard title="Facility coverage" icon={<Building2 />}>
            <div className="org-set-chip-row">
              {facilityTypes.length ? facilityTypes.map(([type, count]) => (
                <span key={type}>{humanize(type)} <b>{count}</b></span>
              )) : <span>No facilities configured</span>}
            </div>
            <p className="org-set-copy">Facility creation, bed counts, location, services, and operational details are managed on the dedicated facilities page.</p>
          </OrgInfoCard>
        </>
      )}

      {section === 'people' && (
        <>
          {header(goButton('Manage users', 'org-people-editor'))}
          <div className="org-set-meter-row">
            <UsageMeter label="Users configured" value={users.length} max={org?.maxUsers || 0} />
            <MiniStat label="Active" value={users.filter(user => user.isActive).length} />
            <MiniStat label="Inactive" value={users.filter(user => !user.isActive).length} />
          </div>
          <OrgInfoCard title="Role distribution" icon={<Users />}>
            <div className="org-set-chip-row">
              {roleCounts.length ? roleCounts.map(([role, count]) => (
                <span key={role}>{humanize(role)} <b>{count}</b></span>
              )) : <span>No users configured</span>}
            </div>
            <p className="org-set-copy">Account creation, resets, facility assignment, and activation status live in user management to avoid conflicting controls.</p>
          </OrgInfoCard>
        </>
      )}

      {section === 'billing' && (
        <>
          {header(goButton('Open service pricing', 'org-billing-editor'))}
          <div className="org-set-meter-row">
            <MiniStat label="Catalog rows" value={fees.length} />
            <MiniStat label="Active prices" value={fees.filter(fee => fee.isActive).length} />
            <MiniStat label="Inactive prices" value={fees.filter(fee => !fee.isActive).length} />
          </div>
          <OrgInfoCard title="Pricing source of truth" icon={<ExternalLink />}>
            <p className="org-set-copy">Service prices are edited in the service pricing page. Settings only summarizes catalog health so billing controls are not duplicated.</p>
            <InfoRow label="Bank details" value={org?.bankDetails ? 'Configured' : 'Not configured'} badge badgeColor={org?.bankDetails ? 'var(--accent-primary)' : '#6B7F96'} />
          </OrgInfoCard>
        </>
      )}
    </div>
  );
}

function OrgInfoCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="org-set-card">
      <div className="org-set-card-head">
        <span>{icon}</span>
        <h4>{title}</h4>
      </div>
      <div className="org-set-card-body">{children}</div>
    </section>
  );
}

function UsageMeter({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const tone = pct >= 90 ? 'danger' : pct >= 75 ? 'warn' : 'ok';
  return (
    <div className="org-set-meter" data-tone={tone}>
      <div>
        <span>{label}</span>
        <b>{value}<small>{max > 0 ? ` / ${max}` : ''}</small></b>
      </div>
      <i><em style={{ width: `${pct}%` }} /></i>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="org-set-mini-stat">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono,
  badge,
  badgeColor,
}: {
  label: string;
  value: string;
  mono?: boolean;
  badge?: boolean;
  badgeColor?: string;
}) {
  return (
    <div className="org-set-info-row">
      <span>{label}</span>
      {badge ? (
        <b className="org-set-badge" style={{ color: badgeColor, background: `color-mix(in srgb, ${badgeColor} 10%, transparent)` }}>{value}</b>
      ) : (
        <b className={mono ? 'is-mono' : undefined}>{value}</b>
      )}
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

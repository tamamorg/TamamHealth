'use client';

/**
 * "Add facility" — the one create-a-facility dialog in the platform.
 *
 * Registering a facility used to be the only step of tenant setup with no way
 * in: `/org-admin/hospitals` owned the form but had no nav row, so the only
 * route to it was Settings -> Operations setup -> Facilities -> Manage
 * facilities. Meanwhile the "Facilities" nav row pointed at `/hospitals`, a
 * read-only network directory whose header offered nothing but a CSV export.
 * Staff creation blocks on this (`roleNeedsFacility`), so the hidden step came
 * first in the real order of work.
 *
 * This component is that form, lifted out so the directory, the org-admin
 * editor, and the global Add menu all open the SAME dialog with the same
 * validation instead of three drifting copies.
 *
 * Tenancy: `createHospital` rejects a facility with no `orgId` outright (a
 * facility without one is rejected by CouchDB's tenant validator on push and
 * is invisible to `filterByScope` even locally). A tenant admin has their own
 * `orgId` and never sees the picker; a platform operator carries none, so they
 * must choose which organization the facility belongs to — the reason the
 * super_admin path was broken everywhere before.
 */

import { useEffect, useMemo, useState } from 'react';
import { Building2, AlertCircle, ChevronDown } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { SOUTH_SUDAN_STATES } from '@/lib/geographic-data';
import { FACILITY_TYPES, DEFAULT_FACILITY_TYPE, type FacilityType } from '@/lib/facility-types';
import type { HospitalDoc, OrganizationDoc } from '@/lib/db-types';

export interface CreateFacilityModalProps {
  onClose: () => void;
  /** Called with the saved facility so the caller can refresh and confirm. */
  onCreated: (hospital: HospitalDoc) => void;
  /**
   * The tenant this facility belongs to. Pass the admin's own `orgId` to pin
   * it; omit for a platform operator, who is asked to choose instead.
   */
  orgId?: string;
  /** Choices for the picker. Only read when `orgId` is absent. */
  organizations?: readonly OrganizationDoc[];
  /** Stamped onto the document and the audit entry. */
  actor?: { _id?: string; username?: string };
  /** Tenant brand colour for the primary button; falls back to the app accent. */
  brandColor?: string;
}

export default function CreateFacilityModal({
  onClose,
  onCreated,
  orgId,
  organizations,
  actor,
  brandColor = 'var(--accent-primary)',
}: CreateFacilityModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [state, setState] = useState('');
  const [town, setTown] = useState('');
  const [facilityType, setFacilityType] = useState<FacilityType>(DEFAULT_FACILITY_TYPE);
  const [beds, setBeds] = useState('');
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // A deactivated tenant cannot take new facilities — `validateActiveOrganization`
  // in /api/users refuses to place staff in one, so a facility registered there
  // would be unstaffable the moment it was saved.
  const orgChoices = useMemo(
    () => (organizations ?? []).filter(org => org.isActive !== false),
    [organizations],
  );
  const needsOrgChoice = !orgId;

  // One tenant on the platform is the common case for a single-org deployment;
  // making the operator pick from a list of one is friction with no decision in it.
  useEffect(() => {
    if (needsOrgChoice && !selectedOrgId && orgChoices.length === 1) {
      setSelectedOrgId(orgChoices[0]._id);
    }
  }, [needsOrgChoice, selectedOrgId, orgChoices]);

  const effectiveOrgId = orgId || selectedOrgId;

  const handleCreate = async () => {
    setError('');
    if (!name.trim() || !state || !town.trim() || !facilityType) {
      setError(t('orgHospitals.errRequiredFields'));
      return;
    }
    if (!effectiveOrgId) {
      setError(t('orgHospitals.errSelectOrganization'));
      return;
    }
    // Reject a negative or non-numeric bed count here rather than storing it:
    // occupancy maths divides by `totalBeds` across the ward board and the
    // network KPIs.
    const parsedBeds = beds.trim() === '' ? 0 : Number(beds);
    if (!Number.isFinite(parsedBeds) || parsedBeds < 0) {
      setError(t('orgHospitals.errInvalidBeds'));
      return;
    }

    setSaving(true);
    try {
      const { createHospital } = await import('@/lib/services/hospital-service');
      const hospital = await createHospital(
        {
          name: name.trim(),
          state,
          town: town.trim(),
          facilityType,
          totalBeds: Math.floor(parsedBeds),
          icuBeds: 0,
          maternityBeds: 0,
          pediatricBeds: 0,
          doctors: 0,
          clinicalOfficers: 0,
          nurses: 0,
          labTechnicians: 0,
          pharmacists: 0,
          hasElectricity: false,
          electricityHours: 0,
          hasGenerator: false,
          hasSolar: false,
          hasInternet: false,
          internetType: 'none',
          hasAmbulance: false,
          emergency24hr: false,
          services: [],
          lat: 0,
          lng: 0,
          orgId: effectiveOrgId,
        },
        actor?._id,
        actor?.username,
      );
      onCreated(hospital);
    } catch (err: unknown) {
      const e = err as { message?: string; fields?: Record<string, string> };
      // `createHospital` throws a ValidationError carrying per-field copy that
      // is more useful than its generic message.
      setError(
        (e.fields && Object.values(e.fields)[0])
        || e.message
        || t('orgHospitals.errCreateFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 14,
    background: 'var(--overlay-subtle)',
    border: '1px solid var(--border-light)',
    color: 'var(--text-primary)',
  };

  const label = (text: string) => (
    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>{text}</label>
  );

  return (
    <Modal onClose={onClose} width={460} labelledBy="add-facility-title">
      <div className="sadb-modal">
        <div className="sadb-modal-copy">
          <h2 id="add-facility-title" className="sadb-modal-title">{t('orgHospitals.modalTitle')}</h2>
          <p className="sadb-modal-sub">{t('orgHospitals.modalSubtitle')}</p>
        </div>

        {error && (
          <div
            className="mb-3 p-3 rounded-lg text-sm flex items-start gap-2"
            role="alert"
            style={{ background: 'rgba(224, 49, 39,0.1)', color: 'var(--color-danger-text)', border: '1px solid rgba(224, 49, 39,0.2)' }}
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-3">
          {needsOrgChoice && (
            <div>
              {label(t('orgHospitals.labelOrganization'))}
              <div className="relative">
                <Select
                  value={selectedOrgId}
                  onChange={e => setSelectedOrgId(e.target.value)}
                  style={{ ...inputStyle, paddingInlineEnd: 32, appearance: 'none' }}
                  data-field="facility-org"
                >
                  <option value="">{t('orgHospitals.selectOrganization')}</option>
                  {orgChoices.map(org => (
                    <option key={org._id} value={org._id}>{org.name}</option>
                  ))}
                </Select>
                <ChevronDown className="absolute end-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
              </div>
              {orgChoices.length === 0 && (
                <p className="mt-1.5 text-[11px]" style={{ color: 'var(--color-warning-text, var(--text-muted))' }}>
                  {t('orgHospitals.noOrganizations')}
                </p>
              )}
            </div>
          )}

          <div>
            {label(t('orgHospitals.labelFacilityName'))}
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('orgHospitals.placeholderFacilityName')}
              style={inputStyle}
              data-field="facility-name"
              autoFocus
            />
          </div>

          <div>
            {label(t('orgHospitals.labelState'))}
            <div className="relative">
              <Select
                value={state}
                onChange={e => setState(e.target.value)}
                style={{ ...inputStyle, paddingInlineEnd: 32, appearance: 'none' }}
                data-field="facility-state"
              >
                <option value="">{t('orgHospitals.selectState')}</option>
                {SOUTH_SUDAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
              <ChevronDown className="absolute end-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
            </div>
          </div>

          <div>
            {label(t('orgHospitals.labelTown'))}
            <input
              type="text"
              value={town}
              onChange={e => setTown(e.target.value)}
              placeholder={t('orgHospitals.placeholderTown')}
              style={inputStyle}
              data-field="facility-town"
            />
          </div>

          <div>
            {label(t('orgHospitals.labelFacilityType'))}
            <div className="relative">
              <Select
                value={facilityType}
                onChange={e => setFacilityType(e.target.value as FacilityType)}
                style={{ ...inputStyle, paddingInlineEnd: 32, appearance: 'none' }}
                data-field="facility-type"
              >
                {FACILITY_TYPES.map(ft => (
                  <option key={ft.value} value={ft.value}>{t(ft.labelKey)}</option>
                ))}
              </Select>
              <ChevronDown className="absolute end-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
            </div>
          </div>

          <div>
            {label(t('hospitals.colTotalBeds'))}
            <input
              type="number"
              value={beds}
              onChange={e => setBeds(e.target.value)}
              placeholder="0"
              min="0"
              style={inputStyle}
              data-field="facility-beds"
            />
          </div>
        </div>

        <div className="sadb-modal-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={saving}>
            {t('action.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleCreate}
            disabled={saving}
            style={brandColor === 'var(--accent-primary)' ? undefined : { background: brandColor, borderColor: brandColor }}
            data-action="create-facility"
          >
            {saving
              ? t('orgHospitals.creating')
              : <><Building2 className="w-4 h-4" /> {t('orgHospitals.createFacility')}</>}
          </button>
        </div>
      </div>
    </Modal>
  );
}

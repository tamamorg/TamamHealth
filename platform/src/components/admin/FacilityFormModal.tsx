'use client';

/**
 * Register or edit a facility — the one facility form in the platform.
 *
 * It replaces three things that used to disagree:
 *  • a five-field create dialog on `/org-admin/hospitals`, which had no nav row;
 *  • a twenty-five-field create form in Settings -> Manage, offering three of
 *    the five facility types and unable to name an organization at all;
 *  • no editor whatsoever — beds, type, location, staffing, infrastructure and
 *    coordinates were write-once, so a number typed wrong at registration was
 *    wrong for the life of the facility.
 *
 * The essentials are always visible and the rest sits behind "More details", so
 * registering a site stays a five-field job while everything remains reachable
 * and, now, correctable.
 */

import { useMemo, useState } from 'react';
import { Building2, AlertCircle, ChevronDown, Check } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { SOUTH_SUDAN_STATES } from '@/lib/geographic-data';
import { FACILITY_TYPES, type FacilityType } from '@/lib/facility-types';
import {
  BED_FIELDS, STAFF_FIELDS, INFRASTRUCTURE_FIELDS, ALL_SERVICES,
  emptyFacilityForm, facilityFormFrom, validateFacilityForm, normaliseFacilityForm,
  type FacilityFormValues, type FacilityFormError,
} from '@/lib/facility-form';
import type { HospitalDoc, OrganizationDoc } from '@/lib/db-types';

export interface FacilityFormModalProps {
  onClose: () => void;
  onSaved: (hospital: HospitalDoc) => void;
  /** Present = edit that facility; absent = register a new one. */
  facility?: HospitalDoc;
  /** The tenant a NEW facility belongs to. Omit for a platform operator. */
  orgId?: string;
  /** Choices for the picker. Only read when creating without a fixed `orgId`. */
  organizations?: readonly OrganizationDoc[];
  actor?: { _id?: string; username?: string };
  brandColor?: string;
}

const ERROR_KEY: Record<FacilityFormError, string> = {
  'required': 'orgHospitals.errRequiredFields',
  'beds-negative': 'orgHospitals.errInvalidBeds',
  'beds-breakdown-exceeds-total': 'orgHospitals.errBedBreakdown',
  'coordinates': 'orgHospitals.errCoordinates',
};

export default function FacilityFormModal({
  onClose,
  onSaved,
  facility,
  orgId,
  organizations,
  actor,
  brandColor = 'var(--accent-primary)',
}: FacilityFormModalProps) {
  const { t } = useTranslation();
  const isEdit = !!facility;
  const [form, setForm] = useState<FacilityFormValues>(
    () => (facility ? facilityFormFrom(facility) : emptyFacilityForm),
  );
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // A deactivated or suspended tenant takes no new facilities — `createHospital`
  // refuses one, so offering it here would only produce an error on submit.
  const orgChoices = useMemo(
    () => (organizations ?? []).filter(
      org => org.isActive !== false
        && org.subscriptionStatus !== 'suspended'
        && org.subscriptionStatus !== 'cancelled',
    ),
    [organizations],
  );
  // Editing never asks: `orgId` is immutable, because moving a facility between
  // tenants would strand every admission and bill already stamped with it.
  const needsOrgChoice = !isEdit && !orgId;
  const effectiveOrgId = orgId || selectedOrgId;

  const set = <K extends keyof FacilityFormValues>(key: K, value: FacilityFormValues[K]) =>
    setForm(f => ({ ...f, [key]: value }));

  const toggleService = (service: string) =>
    setForm(f => ({
      ...f,
      services: f.services.includes(service)
        ? f.services.filter(s => s !== service)
        : [...f.services, service],
    }));

  const handleSave = async () => {
    setError('');
    const invalid = validateFacilityForm(form);
    if (invalid) {
      setError(t(ERROR_KEY[invalid]));
      if (invalid !== 'required') setShowDetails(true);
      return;
    }
    if (!isEdit && !effectiveOrgId) {
      setError(t('orgHospitals.errSelectOrganization'));
      return;
    }

    setSaving(true);
    try {
      const values = normaliseFacilityForm(form);
      if (isEdit) {
        const { updateFacility } = await import('@/lib/services/hospital-service');
        const updated = await updateFacility(facility!._id, values);
        if (!updated) throw new Error(t('hospitals.updateFailed'));
        onSaved(updated);
      } else {
        const { createHospital } = await import('@/lib/services/hospital-service');
        onSaved(await createHospital(
          { ...values, orgId: effectiveOrgId },
          actor?._id,
          actor?.username,
        ));
      }
    } catch (err: unknown) {
      const e = err as { message?: string; fields?: Record<string, string> };
      setError((e.fields && Object.values(e.fields)[0]) || e.message || t('orgHospitals.errCreateFailed'));
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 14,
    background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)',
    color: 'var(--text-primary)',
  };
  const selectStyle: React.CSSProperties = { ...inputStyle, paddingInlineEnd: 32, appearance: 'none' };
  const label = (text: string) => (
    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>{text}</label>
  );
  const groupHeading = (text: string) => (
    <h4 className="text-[11px] font-bold uppercase tracking-wider mb-2 mt-1" style={{ color: 'var(--accent-primary)' }}>{text}</h4>
  );
  const numberField = (key: keyof FacilityFormValues, text: string) => (
    <div key={String(key)}>
      {label(text)}
      <input
        type="number" min="0" style={inputStyle}
        data-field={`facility-${String(key)}`}
        value={form[key] as number}
        onChange={e => set(key, (parseInt(e.target.value, 10) || 0) as FacilityFormValues[typeof key])}
      />
    </div>
  );

  return (
    <Modal onClose={onClose} width={520} labelledBy="facility-form-title">
      <div className="sadb-modal">
        <div className="sadb-modal-copy">
          <h2 id="facility-form-title" className="sadb-modal-title">
            {isEdit ? t('orgHospitals.editTitle') : t('orgHospitals.modalTitle')}
          </h2>
          <p className="sadb-modal-sub">
            {isEdit ? t('orgHospitals.editSubtitle') : t('orgHospitals.modalSubtitle')}
          </p>
        </div>

        {error && (
          <div
            className="mb-3 p-3 rounded-lg text-sm flex items-start gap-2" role="alert"
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
                  style={selectStyle}
                  data-field="facility-org"
                >
                  <option value="">{t('orgHospitals.selectOrganization')}</option>
                  {orgChoices.map(org => <option key={org._id} value={org._id}>{org.name}</option>)}
                </Select>
                <ChevronDown className="absolute end-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
              </div>
              {orgChoices.length === 0 && (
                <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {t('orgHospitals.noOrganizations')}
                </p>
              )}
            </div>
          )}

          <div>
            {label(t('orgHospitals.labelFacilityName'))}
            <input
              type="text" style={inputStyle} data-field="facility-name" autoFocus
              value={form.name} onChange={e => set('name', e.target.value)}
              placeholder={t('orgHospitals.placeholderFacilityName')}
            />
          </div>

          <div>
            {label(t('orgHospitals.labelState'))}
            <div className="relative">
              <Select value={form.state} onChange={e => set('state', e.target.value)} style={selectStyle} data-field="facility-state">
                <option value="">{t('orgHospitals.selectState')}</option>
                {SOUTH_SUDAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
              <ChevronDown className="absolute end-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
            </div>
          </div>

          <div>
            {label(t('orgHospitals.labelTown'))}
            <input
              type="text" style={inputStyle} data-field="facility-town"
              value={form.town} onChange={e => set('town', e.target.value)}
              placeholder={t('orgHospitals.placeholderTown')}
            />
          </div>

          <div>
            {label(t('orgHospitals.labelFacilityType'))}
            <div className="relative">
              <Select
                value={form.facilityType}
                onChange={e => set('facilityType', e.target.value as FacilityType)}
                style={selectStyle} data-field="facility-type"
              >
                {FACILITY_TYPES.map(ft => <option key={ft.value} value={ft.value}>{t(ft.labelKey)}</option>)}
              </Select>
              <ChevronDown className="absolute end-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
            </div>
          </div>

          {numberField('totalBeds', t('hospitals.colTotalBeds'))}

          <button
            type="button"
            onClick={() => setShowDetails(v => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold"
            style={{ color: 'var(--accent-text)' }}
            aria-expanded={showDetails}
            data-action="toggle-facility-details"
          >
            <ChevronDown
              className="w-4 h-4"
              style={{ transform: showDetails ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }}
            />
            {showDetails ? t('orgHospitals.hideDetails') : t('orgHospitals.showDetails')}
          </button>

          {showDetails && (
            <div className="space-y-3 pt-1">
              {groupHeading(t('orgHospitals.groupCapacity'))}
              <div className="grid grid-cols-3 gap-2">
                {BED_FIELDS.filter(f => f.key !== 'totalBeds').map(f => numberField(f.key, f.label))}
              </div>

              {groupHeading(t('orgHospitals.groupStaffing'))}
              <div className="grid grid-cols-3 gap-2">
                {STAFF_FIELDS.map(f => numberField(f.key, f.label))}
              </div>

              {groupHeading(t('orgHospitals.groupInfrastructure'))}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {INFRASTRUCTURE_FIELDS.map(f => (
                  <label key={f.key} className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--text-primary)', textTransform: 'none' }}>
                    <input
                      type="checkbox"
                      checked={form[f.key] as boolean}
                      onChange={e => set(f.key, e.target.checked as FacilityFormValues[typeof f.key])}
                      data-field={`facility-${f.key}`}
                    />
                    {f.label}
                  </label>
                ))}
              </div>
              {form.hasElectricity && numberField('electricityHours', t('orgHospitals.labelElectricityHours'))}
              {form.hasInternet && (
                <div>
                  {label(t('orgHospitals.labelInternetType'))}
                  <input
                    type="text" style={inputStyle} data-field="facility-internetType"
                    value={form.internetType} onChange={e => set('internetType', e.target.value)}
                    placeholder="VSAT, fibre, mobile…"
                  />
                </div>
              )}

              {groupHeading(t('orgHospitals.groupServices'))}
              <div className="flex flex-wrap gap-1.5">
                {ALL_SERVICES.map(svc => {
                  const on = form.services.includes(svc);
                  return (
                    <button
                      key={svc} type="button" onClick={() => toggleService(svc)}
                      className="px-2.5 py-1 rounded-full text-xs font-medium"
                      style={{
                        background: on ? 'var(--accent-light)' : 'var(--overlay-subtle)',
                        color: on ? 'var(--accent-primary)' : 'var(--text-muted)',
                        border: `1px solid ${on ? 'var(--accent-border)' : 'var(--border-light)'}`,
                      }}
                    >
                      {on && <Check className="w-3 h-3 inline me-1" style={{ color: 'var(--accent-primary)' }} />}
                      {svc}
                    </button>
                  );
                })}
              </div>

              {groupHeading(t('orgHospitals.groupLocation'))}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  {label(t('orgHospitals.labelLatitude'))}
                  <input
                    type="number" step="0.0001" style={inputStyle} data-field="facility-lat"
                    value={form.lat} onChange={e => set('lat', parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div>
                  {label(t('orgHospitals.labelLongitude'))}
                  <input
                    type="number" step="0.0001" style={inputStyle} data-field="facility-lng"
                    value={form.lng} onChange={e => set('lng', parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="sadb-modal-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={saving}>
            {t('action.cancel')}
          </button>
          <button
            type="button" className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}
            style={brandColor === 'var(--accent-primary)' ? undefined : { background: brandColor, borderColor: brandColor }}
            data-action={isEdit ? 'save-facility' : 'create-facility'}
          >
            {saving
              ? t('orgHospitals.creating')
              : <><Building2 className="w-4 h-4" /> {isEdit ? t('action.save') : t('orgHospitals.createFacility')}</>}
          </button>
        </div>
      </div>
    </Modal>
  );
}

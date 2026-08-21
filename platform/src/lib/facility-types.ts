/**
 * The facility-type vocabulary, in one place.
 *
 * Three surfaces used to carry their own copy of this list and they did not
 * agree: `/settings/manage` offered three types (national referral, state,
 * county) while `/org-admin/hospitals` offered five. A facility created from
 * Settings could therefore never be a PHCC or PHCU — the two commonest
 * facility types in South Sudan — even though `HospitalDoc['facilityType']`
 * has always accepted them and every reader (filters, KPI bands, the network
 * map) renders them.
 *
 * No database or icon imports: this is read by client components, and it must
 * stay cheap enough to import anywhere.
 */
import type { HospitalDoc } from './db-types';

export type FacilityType = HospitalDoc['facilityType'];

export interface FacilityTypeOption {
  value: FacilityType;
  /** English fallback, for surfaces that do not run through i18n. */
  label: string;
  /** Locale key — see `lib/i18n/locales/en.ts`. */
  labelKey: string;
}

/**
 * Ordered most- to least-specialised, which is how the network directory and
 * the referral chain both read them.
 */
export const FACILITY_TYPES: readonly FacilityTypeOption[] = [
  { value: 'national_referral', label: 'National Referral', labelKey: 'hospitals.typeNationalReferral' },
  { value: 'state_hospital', label: 'State Hospital', labelKey: 'hospitals.typeStateHospital' },
  { value: 'county_hospital', label: 'County Hospital', labelKey: 'hospitals.typeCountyHospital' },
  { value: 'phcc', label: 'Primary Health Care Centre', labelKey: 'hospitals.typePhccFull' },
  { value: 'phcu', label: 'Primary Health Care Unit', labelKey: 'hospitals.typePhcuFull' },
] as const;

/**
 * The type a new facility gets unless the admin picks another. A PHCC is by
 * far the commonest facility an organization registers, so it is the default
 * that needs changing least often.
 */
export const DEFAULT_FACILITY_TYPE: FacilityType = 'phcc';

export function isFacilityType(value: unknown): value is FacilityType {
  return FACILITY_TYPES.some(option => option.value === value);
}

/** English label for a stored value; falls back to the raw value. */
export function facilityTypeLabel(value: string): string {
  return FACILITY_TYPES.find(option => option.value === value)?.label ?? value;
}

/** Locale key for a stored value, or null when it is not a known type. */
export function facilityTypeLabelKey(value: string): string | null {
  return FACILITY_TYPES.find(option => option.value === value)?.labelKey ?? null;
}

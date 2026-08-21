/**
 * The facility record's editable shape, in one place.
 *
 * Two forms used to define these fields independently: the quick-create dialog
 * (five fields) and Settings -> Manage (about twenty-five). Nothing could edit
 * either set afterwards, so a bed count typed wrong at registration was wrong
 * forever. Stating the field groups here lets one component render both the
 * create and the edit case, and lets a test assert the two never drift again.
 *
 * No React, no database imports — just the vocabulary.
 */
import type { HospitalDoc } from './db-types';
import { DEFAULT_FACILITY_TYPE, type FacilityType } from './facility-types';

/** Capacity, by bed type. `totalBeds` drives every occupancy figure. */
export const BED_FIELDS = [
  { key: 'totalBeds', label: 'Total beds' },
  { key: 'icuBeds', label: 'ICU beds' },
  { key: 'maternityBeds', label: 'Maternity' },
  { key: 'pediatricBeds', label: 'Pediatric' },
] as const;

/** Establishment — the posts the facility is meant to hold, not its live roster. */
export const STAFF_FIELDS = [
  { key: 'doctors', label: 'Doctors' },
  { key: 'clinicalOfficers', label: 'Clinical officers' },
  { key: 'nurses', label: 'Nurses' },
  { key: 'labTechnicians', label: 'Lab techs' },
  { key: 'pharmacists', label: 'Pharmacists' },
] as const;

export const INFRASTRUCTURE_FIELDS = [
  { key: 'hasElectricity', label: 'Electricity' },
  { key: 'hasGenerator', label: 'Generator' },
  { key: 'hasSolar', label: 'Solar' },
  { key: 'hasInternet', label: 'Internet' },
  { key: 'hasAmbulance', label: 'Ambulance' },
  { key: 'emergency24hr', label: '24hr emergency' },
] as const;

export const ALL_SERVICES = [
  'Surgery', 'Maternity', 'Pediatrics', 'Laboratory', 'X-ray', 'Ultrasound',
  'Pharmacy', 'Emergency', 'ICU', 'Cardiology', 'Orthopedics', 'Dentistry',
  'Ophthalmology', 'Physiotherapy', 'Mental Health', 'TB Treatment', 'HIV/AIDS',
] as const;

export interface FacilityFormValues {
  name: string;
  state: string;
  town: string;
  facilityType: FacilityType;
  totalBeds: number;
  icuBeds: number;
  maternityBeds: number;
  pediatricBeds: number;
  doctors: number;
  clinicalOfficers: number;
  nurses: number;
  labTechnicians: number;
  pharmacists: number;
  hasElectricity: boolean;
  electricityHours: number;
  hasGenerator: boolean;
  hasSolar: boolean;
  hasInternet: boolean;
  internetType: string;
  hasAmbulance: boolean;
  emergency24hr: boolean;
  services: string[];
  lat: number;
  lng: number;
}

export const emptyFacilityForm: FacilityFormValues = {
  name: '', state: '', town: '', facilityType: DEFAULT_FACILITY_TYPE,
  totalBeds: 0, icuBeds: 0, maternityBeds: 0, pediatricBeds: 0,
  doctors: 0, clinicalOfficers: 0, nurses: 0, labTechnicians: 0, pharmacists: 0,
  hasElectricity: false, electricityHours: 0, hasGenerator: false, hasSolar: false,
  hasInternet: false, internetType: 'none', hasAmbulance: false, emergency24hr: false,
  services: [], lat: 0, lng: 0,
};

/** Load an existing facility into the form. */
export function facilityFormFrom(hospital: HospitalDoc): FacilityFormValues {
  return {
    ...emptyFacilityForm,
    name: hospital.name ?? '',
    state: hospital.state ?? '',
    town: hospital.town ?? '',
    facilityType: hospital.facilityType ?? DEFAULT_FACILITY_TYPE,
    totalBeds: hospital.totalBeds ?? 0,
    icuBeds: hospital.icuBeds ?? 0,
    maternityBeds: hospital.maternityBeds ?? 0,
    pediatricBeds: hospital.pediatricBeds ?? 0,
    doctors: hospital.doctors ?? 0,
    clinicalOfficers: hospital.clinicalOfficers ?? 0,
    nurses: hospital.nurses ?? 0,
    labTechnicians: hospital.labTechnicians ?? 0,
    pharmacists: hospital.pharmacists ?? 0,
    hasElectricity: !!hospital.hasElectricity,
    electricityHours: hospital.electricityHours ?? 0,
    hasGenerator: !!hospital.hasGenerator,
    hasSolar: !!hospital.hasSolar,
    hasInternet: !!hospital.hasInternet,
    internetType: hospital.internetType ?? 'none',
    hasAmbulance: !!hospital.hasAmbulance,
    emergency24hr: !!hospital.emergency24hr,
    services: [...(hospital.services ?? [])],
    lat: hospital.lat ?? 0,
    lng: hospital.lng ?? 0,
  };
}

export type FacilityFormError =
  | 'required'
  | 'beds-negative'
  | 'beds-breakdown-exceeds-total'
  | 'coordinates';

/**
 * Validate before writing. Returns an error code (the caller maps it to copy),
 * or null when the form is ready.
 *
 * The bed-breakdown rule is the one that matters clinically: ward occupancy and
 * every network readiness figure divide by `totalBeds`, so a facility claiming
 * more ICU beds than beds reports over 100% occupancy on an empty ward.
 */
export function validateFacilityForm(form: FacilityFormValues): FacilityFormError | null {
  if (!form.name.trim() || !form.state || !form.town.trim() || !form.facilityType) return 'required';
  const numbers = [...BED_FIELDS, ...STAFF_FIELDS].map(f => form[f.key]);
  if (numbers.some(n => !Number.isFinite(n) || n < 0)) return 'beds-negative';
  if (form.icuBeds + form.maternityBeds + form.pediatricBeds > form.totalBeds && form.totalBeds > 0) {
    return 'beds-breakdown-exceeds-total';
  }
  if (Math.abs(form.lat) > 90 || Math.abs(form.lng) > 180) return 'coordinates';
  return null;
}

/** Trim the free-text fields; numbers are already coerced by the inputs. */
export function normaliseFacilityForm(form: FacilityFormValues): FacilityFormValues {
  return {
    ...form,
    name: form.name.trim(),
    town: form.town.trim(),
    internetType: form.hasInternet ? (form.internetType.trim() || 'unknown') : 'none',
    electricityHours: form.hasElectricity ? form.electricityHours : 0,
  };
}

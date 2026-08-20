/**
 * Facility-level settings: the single typed shape for everything an admin can
 * configure for a hospital/clinic, plus the defaults that mirror the values
 * that used to be hard-coded across the platform.
 *
 * Stored as one `facility_settings` doc per hospital in the (already synced)
 * `tamamhealth_hospitals` database, so a change made by an admin replicates to
 * every device/user at that facility. A singleton store (settings-store.ts)
 * keeps the current merged settings available synchronously to non-React
 * services (currency, hospital-number prefix, SLA timers, …), while the
 * SettingsProvider/useSettings hook makes them reactive in components.
 */

/** A single lab investigation the facility offers. */
export interface LabTestDef {
  name: string;
  tier: 'basic' | 'special';
  specimen: string;
  /** LOINC code — the universal standard for lab tests/observations. Enables
   *  interoperable, trendable results and DHIS2/FHIR export. Optional so custom
   *  facility tests can exist without a code. */
  loinc?: string;
}

export type EncounterStationKey =
  | 'registration' | 'triage' | 'rooming' | 'consultation' | 'lab' | 'radiology'
  | 'pharmacy' | 'cashier' | 'clinic_checkout' | 'facility_checkout';

export type PatientProfileKey = 'child' | 'adult' | 'pregnant' | 'postnatal' | 'emergency';

/** Accepted payment method keys (kept as stable keys; labels live in the UI). */
export type PaymentMethodKey =
  | 'cash' | 'mobile_money' | 'voucher' | 'partial_payment' | 'bank_transfer' | 'card';

/** Payor / funding-source keys. */
export type PayorKey =
  | 'out_of_pocket' | 'gov_moh' | 'ngo_donor' | 'pepfar' | 'global_fund'
  | 'private_insurance' | 'cbhi' | 'exemption_waiver' | 'sliding_scale';

export interface FacilitySettings {
  // ── General ─────────────────────────────────────────────────────────────
  /** ISO-ish currency code used for all charges/prices (e.g. 'SSP', 'USD'). */
  currency: string;
  /** Prefix for generated patient hospital numbers (e.g. 'TAB' → TAB-000123). */
  hospitalNumberPrefix: string;
  /** Default display language (locale code) for this facility. */
  language: string;

  // ── Clinical ────────────────────────────────────────────────────────────
  /** Hours before an unreviewed result escalates, by criticality. */
  resultReviewSLA: { criticalHours: number; routineHours: number };
  /** Triage queue aging behaviour. */
  acuity: { timeAging: boolean; agingPerMinute: number };
  /** The lab investigations this facility can order. */
  labCatalog: LabTestDef[];

  // ── Operations ──────────────────────────────────────────────────────────
  /** Exam rooms / bays a patient can be placed in. */
  rooms: string[];
  /** Departments / clinics offered (drives routing + reporting buckets). */
  departments: string[];

  // ── Workflow ────────────────────────────────────────────────────────────
  /** Ordered stations in the facility's default outpatient journey. */
  stationSequence: EncounterStationKey[];
  /** Encounter gates that must be closed before routine facility checkout. */
  checkoutGateKeys: string[];
  /** Which patient groups require triage before consultation. */
  triageRequiredFor: PatientProfileKey[];
  /** Appointment, walk-in, referral, and emergency routing defaults. */
  routingDefaults: {
    appointment: string;
    walkIn: string;
    referral: string;
    emergency: string;
    maternity: string;
    child: string;
  };
  /** Whether direct service orders can skip consultation. */
  directServiceAccess: {
    lab: boolean;
    radiology: boolean;
    pharmacyRefill: boolean;
  };

  // ── Consultation ────────────────────────────────────────────────────────
  /** Profiles drive age/pregnancy-aware consult templates and normal ranges. */
  consultationProfiles: Record<PatientProfileKey, {
    chiefComplaintRequired: boolean;
    vitalsRequired: string[];
    historyPrompts: string[];
    redFlagPrompts: string[];
  }>;

  // ── Reporting / HMIS ───────────────────────────────────────────────────
  reporting: {
    dhis2OrgUnitId: string;
    monthlyDeadlineDay: number;
    requireCompletenessSignoff: boolean;
    diseaseBuckets: string[];
    aggregateSources: Array<'encounters' | 'diagnoses' | 'lab_results' | 'pharmacy_dispenses' | 'vital_events' | 'payments'>;
  };

  // ── IT Operations ──────────────────────────────────────────────────────
  itOperations: {
    backupFrequencyHours: number;
    syncFailureAlertMinutes: number;
    deviceReviewDays: number;
    auditRetentionDays: number;
    requireDeviceRegistration: boolean;
    allowOfflineMode: boolean;
    integrations: Array<'dhis2' | 'sms' | 'email' | 'payments' | 'lab_devices' | 'barcode_printers'>;
  };

  // ── Billing ─────────────────────────────────────────────────────────────
  /** Accepted payment methods. */
  paymentMethods: PaymentMethodKey[];
  /** Payor / funding sources offered at this facility. */
  payors: PayorKey[];
  /** Days into an unpaid balance before each collection stage triggers. */
  collectionStageDays: { followUp: number; warning: number; preWriteOff: number };
  /** Default service tax / VAT applied to bills, as a percent (0 = none, e.g.
   *  public facilities). Private facilities can set a default here. */
  taxRatePercent: number;

  // ── Security ────────────────────────────────────────────────────────────
  /** Idle minutes before the screen auto-locks. */
  lockTimeoutMinutes: number;

}

/** Persisted document shape (one per hospital). */
export interface FacilitySettingsDoc extends FacilitySettings {
  _id: string;
  _rev?: string;
  type: 'facility_settings';
  hospitalId: string;
  orgId?: string;
  createdAt: string;
  updatedAt: string;
}

export const facilitySettingsId = (hospitalId: string) => `facility_settings:${hospitalId}`;

/**
 * Defaults that exactly mirror the values previously hard-coded across the
 * platform, so behaviour is identical until an admin changes something:
 *   - currency / prefix:  ledger-service.ts, patient-service.ts
 *   - resultReviewSLA:    clinical-flow/order-lifecycles.ts (RESULT_REVIEW_SLA)
 *   - acuity:             clinical-flow/payment-model.ts
 *   - labCatalog:         clinical-flow/lab-catalog.ts
 *   - rooms:              dashboard/front-desk ROOM_OPTIONS
 *   - paymentMethods/payors: clinical-flow/payment-model.ts
 *   - collectionStageDays: services/payment-service.ts
 *   - lockTimeoutMinutes:  hooks/useAutoLock.ts
 */
export const DEFAULT_FACILITY_SETTINGS: FacilitySettings = {
  currency: 'SSP',
  hospitalNumberPrefix: 'TAB',
  language: 'en',
  resultReviewSLA: { criticalHours: 24, routineHours: 168 },
  acuity: { timeAging: true, agingPerMinute: 0.1 },
  labCatalog: [
    { name: 'Full Blood Count', tier: 'basic', specimen: 'Blood', loinc: '58410-2' },
    { name: 'Urinalysis', tier: 'basic', specimen: 'Urine', loinc: '24357-6' },
    { name: 'Blood Glucose', tier: 'basic', specimen: 'Blood', loinc: '2339-0' },
    { name: 'Malaria RDT', tier: 'basic', specimen: 'Blood', loinc: '70564-7' },
    { name: 'HIV Rapid Test', tier: 'special', specimen: 'Blood', loinc: '75622-1' },
    { name: 'CD4 Count', tier: 'special', specimen: 'Blood', loinc: '24467-3' },
    { name: 'Liver Function', tier: 'special', specimen: 'Blood', loinc: '24325-3' },
    { name: 'Renal Function', tier: 'special', specimen: 'Blood', loinc: '24362-6' },
    { name: 'Typhoid (Widal)', tier: 'special', specimen: 'Blood' },
    { name: 'Rheumatoid Factor', tier: 'special', specimen: 'Blood', loinc: '11572-5' },
    { name: 'ANA (autoimmune screen)', tier: 'special', specimen: 'Blood', loinc: '5048-4' },
    { name: 'Uric Acid', tier: 'special', specimen: 'Blood', loinc: '3084-1' },
    { name: 'Vitamin D', tier: 'special', specimen: 'Blood', loinc: '35365-6' },
    { name: 'Stool Culture', tier: 'special', specimen: 'Stool', loinc: '625-4' },
    { name: 'Blood Culture', tier: 'special', specimen: 'Blood', loinc: '600-7' },
    { name: 'Lipid Profile', tier: 'special', specimen: 'Blood', loinc: '57698-3' },
    // Imaging studies — specimen 'Imaging' routes these to the radiology queue.
    { name: 'X-Ray — Chest', tier: 'special', specimen: 'Imaging' },
    { name: 'X-Ray — Limb/Skeletal', tier: 'special', specimen: 'Imaging' },
    { name: 'Ultrasound — Abdomen', tier: 'special', specimen: 'Imaging' },
    { name: 'Ultrasound — Obstetric', tier: 'special', specimen: 'Imaging' },
  ],
  rooms: ['Room 1', 'Room 2', 'Room 3', 'Room 4', 'Room 5', 'Room 6', 'Bay A', 'Bay B', 'Bay C', 'Bay D'],
  departments: ['General Medicine', 'Maternity', 'Emergency', 'Pediatrics', 'Ophthalmology', 'Dental', 'Dermatology', 'OPD'],
  stationSequence: ['registration', 'triage', 'rooming', 'consultation', 'lab', 'radiology', 'cashier', 'pharmacy', 'clinic_checkout', 'facility_checkout'],
  checkoutGateKeys: ['all_clinic_visits_closed', 'prescriptions_dispensed', 'critical_labs_reviewed', 'in_clinic_procedures_complete', 'required_documentation_generated', 'payment_status_determined', 'pending_items_flagged'],
  triageRequiredFor: ['child', 'pregnant', 'emergency'],
  routingDefaults: {
    appointment: 'clinic',
    walkIn: 'triage',
    referral: 'clinic',
    emergency: 'emergency',
    maternity: 'maternity',
    child: 'triage',
  },
  directServiceAccess: { lab: false, radiology: false, pharmacyRefill: true },
  consultationProfiles: {
    child: {
      chiefComplaintRequired: true,
      vitalsRequired: ['temperature', 'weight', 'respiratoryRate', 'pulse', 'oxygenSaturation'],
      historyPrompts: ['duration of illness', 'feeding or drinking', 'vomiting/diarrhea', 'immunization status', 'caregiver concerns'],
      redFlagPrompts: ['danger signs', 'seizures', 'lethargy', 'severe dehydration', 'respiratory distress'],
    },
    adult: {
      chiefComplaintRequired: true,
      vitalsRequired: ['temperature', 'bloodPressure', 'pulse', 'respiratoryRate', 'oxygenSaturation'],
      historyPrompts: ['onset and duration', 'associated symptoms', 'medications', 'allergies', 'past medical history'],
      redFlagPrompts: ['chest pain', 'shortness of breath', 'altered mental state', 'severe pain', 'bleeding'],
    },
    pregnant: {
      chiefComplaintRequired: true,
      vitalsRequired: ['temperature', 'bloodPressure', 'pulse', 'respiratoryRate', 'fetalHeartRate'],
      historyPrompts: ['gestational age', 'fetal movement', 'bleeding', 'fluid leakage', 'headache/visual symptoms'],
      redFlagPrompts: ['severe hypertension', 'convulsions', 'heavy bleeding', 'severe abdominal pain', 'reduced fetal movement'],
    },
    postnatal: {
      chiefComplaintRequired: true,
      vitalsRequired: ['temperature', 'bloodPressure', 'pulse', 'bleedingAssessment'],
      historyPrompts: ['delivery date', 'bleeding', 'fever', 'breastfeeding', 'newborn concerns'],
      redFlagPrompts: ['postpartum hemorrhage', 'sepsis signs', 'severe headache', 'convulsions', 'newborn danger signs'],
    },
    emergency: {
      chiefComplaintRequired: true,
      vitalsRequired: ['airway', 'breathing', 'circulation', 'consciousness', 'oxygenSaturation'],
      historyPrompts: ['time of onset', 'mechanism or trigger', 'first aid already given', 'known conditions', 'medications/allergies'],
      redFlagPrompts: ['airway compromise', 'shock', 'unconsciousness', 'major trauma', 'severe respiratory distress'],
    },
  },
  reporting: {
    dhis2OrgUnitId: '',
    monthlyDeadlineDay: 5,
    requireCompletenessSignoff: true,
    diseaseBuckets: ['Malaria', 'Cholera', 'Measles', 'Pneumonia', 'Diarrhea', 'Tuberculosis', 'HIV', 'Maternal complications'],
    aggregateSources: ['encounters', 'diagnoses', 'lab_results', 'pharmacy_dispenses', 'vital_events', 'payments'],
  },
  itOperations: {
    backupFrequencyHours: 24,
    syncFailureAlertMinutes: 30,
    deviceReviewDays: 30,
    auditRetentionDays: 2555,
    requireDeviceRegistration: true,
    allowOfflineMode: true,
    integrations: ['dhis2', 'sms', 'payments', 'barcode_printers'],
  },
  paymentMethods: ['cash', 'mobile_money', 'card', 'bank_transfer', 'voucher', 'partial_payment'],
  payors: ['out_of_pocket', 'gov_moh', 'ngo_donor', 'pepfar', 'global_fund', 'private_insurance', 'cbhi', 'exemption_waiver', 'sliding_scale'],
  collectionStageDays: { followUp: 30, warning: 60, preWriteOff: 90 },
  taxRatePercent: 0,
  lockTimeoutMinutes: 2,
};

/**
 * Merge a stored (possibly partial / older-schema) settings object over the
 * defaults so missing fields always resolve to a sane value. Nested objects
 * are merged shallowly per key.
 */
export function mergeFacilitySettings(partial?: Partial<FacilitySettings> | null): FacilitySettings {
  const d = DEFAULT_FACILITY_SETTINGS;
  if (!partial) return { ...d, labCatalog: [...d.labCatalog], rooms: [...d.rooms], departments: [...d.departments], paymentMethods: [...d.paymentMethods], payors: [...d.payors] };
  return {
    currency: partial.currency ?? d.currency,
    hospitalNumberPrefix: partial.hospitalNumberPrefix ?? d.hospitalNumberPrefix,
    language: partial.language ?? d.language,
    resultReviewSLA: { ...d.resultReviewSLA, ...(partial.resultReviewSLA ?? {}) },
    acuity: { ...d.acuity, ...(partial.acuity ?? {}) },
    labCatalog: partial.labCatalog?.length ? partial.labCatalog : [...d.labCatalog],
    rooms: partial.rooms?.length ? partial.rooms : [...d.rooms],
    departments: partial.departments?.length ? partial.departments : [...d.departments],
    stationSequence: partial.stationSequence?.length ? partial.stationSequence : [...d.stationSequence],
    checkoutGateKeys: partial.checkoutGateKeys?.length ? partial.checkoutGateKeys : [...d.checkoutGateKeys],
    triageRequiredFor: partial.triageRequiredFor?.length ? partial.triageRequiredFor : [...d.triageRequiredFor],
    routingDefaults: { ...d.routingDefaults, ...(partial.routingDefaults ?? {}) },
    directServiceAccess: { ...d.directServiceAccess, ...(partial.directServiceAccess ?? {}) },
    consultationProfiles: {
      child: { ...d.consultationProfiles.child, ...(partial.consultationProfiles?.child ?? {}) },
      adult: { ...d.consultationProfiles.adult, ...(partial.consultationProfiles?.adult ?? {}) },
      pregnant: { ...d.consultationProfiles.pregnant, ...(partial.consultationProfiles?.pregnant ?? {}) },
      postnatal: { ...d.consultationProfiles.postnatal, ...(partial.consultationProfiles?.postnatal ?? {}) },
      emergency: { ...d.consultationProfiles.emergency, ...(partial.consultationProfiles?.emergency ?? {}) },
    },
    reporting: {
      ...d.reporting,
      ...(partial.reporting ?? {}),
      diseaseBuckets: partial.reporting?.diseaseBuckets?.length ? partial.reporting.diseaseBuckets : [...d.reporting.diseaseBuckets],
      aggregateSources: partial.reporting?.aggregateSources?.length ? partial.reporting.aggregateSources : [...d.reporting.aggregateSources],
    },
    itOperations: {
      ...d.itOperations,
      ...(partial.itOperations ?? {}),
      integrations: partial.itOperations?.integrations?.length ? partial.itOperations.integrations : [...d.itOperations.integrations],
    },
    paymentMethods: partial.paymentMethods?.length ? partial.paymentMethods : [...d.paymentMethods],
    payors: partial.payors?.length ? partial.payors : [...d.payors],
    collectionStageDays: { ...d.collectionStageDays, ...(partial.collectionStageDays ?? {}) },
    taxRatePercent: partial.taxRatePercent ?? d.taxRatePercent,
    lockTimeoutMinutes: partial.lockTimeoutMinutes ?? d.lockTimeoutMinutes,
  };
}

/** Stable display labels for the keyed enums (used by settings UI + billing). */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethodKey, string> = {
  cash: 'Cash',
  mobile_money: 'Mobile Money',
  voucher: 'Voucher',
  partial_payment: 'Partial Payment',
  bank_transfer: 'Bank Transfer',
  card: 'Card',
};

export const PAYOR_LABELS: Record<PayorKey, string> = {
  out_of_pocket: 'Out of Pocket',
  gov_moh: 'Government (MoH)',
  ngo_donor: 'NGO / Donor',
  pepfar: 'PEPFAR',
  global_fund: 'Global Fund',
  private_insurance: 'Private Insurance',
  cbhi: 'Community-Based Health Insurance',
  exemption_waiver: 'Exemption / Waiver',
  sliding_scale: 'Sliding Scale',
};

export const ALL_PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethodKey[];
export const ALL_PAYORS = Object.keys(PAYOR_LABELS) as PayorKey[];

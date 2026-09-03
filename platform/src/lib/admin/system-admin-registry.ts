import type { UserRole } from '@/lib/db-types';

export type AdminDomain =
  | 'clinical'
  | 'registration'
  | 'operations'
  | 'billing'
  | 'reporting'
  | 'it'
  | 'security'
  | 'metadata';

export type AppStatus = 'enabled' | 'disabled' | 'configurable';
export type AdminLevel = 'platform' | 'organization' | 'facility';

export interface SystemAppDefinition {
  id: string;
  label: string;
  domain: AdminDomain;
  status: AppStatus;
  level: AdminLevel;
  route?: string;
  ownerRoles: UserRole[];
  description: string;
  dependencies?: string[];
}

export interface SystemExtensionDefinition {
  id: string;
  label: string;
  extensionPoint: string;
  domain: AdminDomain;
  status: AppStatus;
  level: AdminLevel;
  route?: string;
  description: string;
}

export interface SystemPrivilegeDefinition {
  id: string;
  label: string;
  domain: AdminDomain;
  level: AdminLevel;
  roles: UserRole[];
  description: string;
  risk: 'low' | 'medium' | 'high';
}

export interface SystemMetadataDefinition {
  id: string;
  label: string;
  domain: AdminDomain;
  level: AdminLevel;
  route?: string;
  countLabel: string;
  description: string;
}

export interface SystemGlobalPropertyDefinition {
  id: string;
  label: string;
  domain: AdminDomain;
  level: AdminLevel;
  currentValue: string;
  route?: string;
  description: string;
}

const FACILITY_ADMIN_ROLES: UserRole[] = [
  'super_admin',
  'org_admin',
  'medical_superintendent',
  'hospital_manager',
];

const RECORDS_ADMIN_ROLES: UserRole[] = [
  ...FACILITY_ADMIN_ROLES,
  'hrio',
  'records_hmis_officer',
];

const CLINICAL_PROVIDER_ROLES: UserRole[] = [
  'doctor',
  'clinical_officer',
  'clinician',
  'medical_superintendent',
];

export const SYSTEM_APP_DEFINITIONS: SystemAppDefinition[] = [
  {
    id: 'registrationapp.registerPatient',
    label: 'Registration',
    domain: 'registration',
    status: 'enabled',
    level: 'facility',
    route: '/patients',
    ownerRoles: ['front_desk', 'central_registration_clerk', ...FACILITY_ADMIN_ROLES],
    description: 'Register patients, edit demographics, manage identifiers, and open returning patient records.',
  },
  {
    id: 'appointmentschedulingui.homeApp',
    label: 'Appointments',
    domain: 'operations',
    status: 'enabled',
    level: 'facility',
    route: '/appointments',
    ownerRoles: ['front_desk', 'clinic_clerk', ...FACILITY_ADMIN_ROLES],
    description: 'Schedule, confirm, check in, and route appointments and walk-ins.',
  },
  {
    id: 'referenceapplication.vitals',
    label: 'Triage & Vitals',
    domain: 'clinical',
    status: 'enabled',
    level: 'facility',
    // The standalone nurse station is retired — nursing now works from the
    // same shared clinical workspace as doctors, role-adapted rather than a
    // separate app.
    route: '/dashboard',
    ownerRoles: ['nurse', 'triage_nurse', 'rooming_nurse', ...FACILITY_ADMIN_ROLES],
    description: 'Capture vitals, acuity, and routing decisions before consultation, from the shared clinical workspace.',
  },
  {
    id: 'referenceapplication.realTime.simpleVisitNote',
    label: 'Consultation',
    domain: 'clinical',
    status: 'enabled',
    level: 'facility',
    route: '/consultation',
    ownerRoles: [...CLINICAL_PROVIDER_ROLES],
    description: 'Chief complaint, age-aware vitals review, exam, diagnosis, orders, prescriptions, and signoff.',
  },
  {
    id: 'formentryapp.forms',
    label: 'Forms & Templates',
    domain: 'clinical',
    status: 'configurable',
    level: 'facility',
    route: '/facility-settings',
    ownerRoles: FACILITY_ADMIN_ROLES,
    description: 'Configure encounter templates, required documentation, and profile prompts.',
  },
  {
    id: 'coreapps.latestObsForConceptList',
    label: 'Laboratory & Imaging',
    domain: 'clinical',
    status: 'enabled',
    level: 'facility',
    route: '/lab',
    ownerRoles: ['lab_tech', 'radiologist', ...CLINICAL_PROVIDER_ROLES, ...FACILITY_ADMIN_ROLES],
    description: 'Order investigations, collect specimens, process results, and return results to clinicians.',
  },
  {
    id: 'pharmacy.dispenseQueue',
    label: 'Pharmacy',
    domain: 'clinical',
    status: 'enabled',
    level: 'facility',
    route: '/pharmacy',
    ownerRoles: ['pharmacist', ...CLINICAL_PROVIDER_ROLES, ...FACILITY_ADMIN_ROLES],
    description: 'Receive prescription orders, verify payment status, dispense medication, and clear the patient.',
  },
  {
    id: 'billing.cashierWorkstation',
    label: 'Billing & Cashier',
    domain: 'billing',
    status: 'enabled',
    level: 'facility',
    route: '/payments',
    ownerRoles: ['cashier', 'medical_biller', ...FACILITY_ADMIN_ROLES],
    description: 'Receive money, reconcile payments, manage claims, and expose patient balance status.',
  },
  {
    id: 'reportingui.reports',
    label: 'Reporting',
    domain: 'reporting',
    status: 'enabled',
    level: 'organization',
    route: '/reports',
    ownerRoles: RECORDS_ADMIN_ROLES,
    description: 'Generate facility, HMIS, disease, financial, and program reports.',
  },
  {
    id: 'coreapps.activeVisits',
    label: 'Active Visits',
    domain: 'operations',
    status: 'enabled',
    level: 'facility',
    route: '/facility-management',
    ownerRoles: FACILITY_ADMIN_ROLES,
    description: 'Track patients currently moving through registration, triage, consultation, lab, cashier, pharmacy, and checkout.',
  },
  {
    id: 'adminui.systemAdministrationApp',
    label: 'System Administration',
    domain: 'it',
    status: 'enabled',
    level: 'facility',
    route: '/system-admin',
    ownerRoles: RECORDS_ADMIN_ROLES,
    description: 'Tamam-style hub for apps, extensions, accounts, privileges, metadata, and style guide.',
  },
];

export const SYSTEM_EXTENSION_DEFINITIONS: SystemExtensionDefinition[] = [
  {
    id: 'coreapps.patientHeader.secondLineFragments.activeVisitStatus',
    label: 'Active visit status',
    extensionPoint: 'patient.header.secondLine',
    domain: 'clinical',
    status: 'enabled',
    level: 'facility',
    route: '/patients',
    description: 'Shows whether the patient is registered, waiting, in consultation, in lab, at cashier, in pharmacy, or cleared.',
  },
  {
    id: 'coreapps.patientHeader.secondLineFragments.stickyNote',
    label: 'Sticky note',
    extensionPoint: 'patient.header.secondLine',
    domain: 'clinical',
    status: 'configurable',
    level: 'facility',
    route: '/patients',
    description: 'Displays critical operational notes such as isolation, balance due, appointment instructions, or transfer notice.',
  },
  {
    id: 'allergyui.patientDashboard.secondColumnFragments',
    label: 'Allergies card',
    extensionPoint: 'patient.dashboard.secondColumn',
    domain: 'clinical',
    status: 'enabled',
    level: 'facility',
    route: '/patients',
    description: 'Keeps allergy warnings visible in patient details and consultation flows.',
  },
  {
    id: 'appointmentschedulingui.firstColumnFragments.patientAppointments',
    label: 'Patient appointments',
    extensionPoint: 'patient.dashboard.firstColumn',
    domain: 'operations',
    status: 'enabled',
    level: 'facility',
    route: '/appointments',
    description: 'Shows upcoming and recent appointments from the patient dashboard.',
  },
  {
    id: 'attachments.patientDashboard.secondColumnFragments',
    label: 'Attachments',
    extensionPoint: 'patient.dashboard.secondColumn',
    domain: 'clinical',
    status: 'enabled',
    level: 'facility',
    route: '/patients',
    description: 'Adds documents, referral forms, imaging files, and scanned records to the patient dashboard.',
  },
  {
    id: 'attachments.encounterTemplate',
    label: 'Encounter attachments',
    extensionPoint: 'encounter.template',
    domain: 'clinical',
    status: 'enabled',
    level: 'facility',
    route: '/consultation',
    description: 'Allows forms, photos, and files to be linked directly to an encounter.',
  },
  {
    id: 'visitActions.endVisit',
    label: 'End visit',
    extensionPoint: 'visit.actions',
    domain: 'operations',
    status: 'enabled',
    level: 'facility',
    route: '/facility-management',
    description: 'Clears a patient only after required checkout, payment, dispensing, and pending-result gates are resolved.',
  },
  {
    id: 'visitActions.admitTransferDischarge',
    label: 'Admit, transfer, discharge',
    extensionPoint: 'visit.actions',
    domain: 'clinical',
    status: 'enabled',
    level: 'facility',
    route: '/wards',
    description: 'Adds inpatient transition actions to active-visit and ward workflows.',
  },
  {
    id: 'billing.patientHeader.balance',
    label: 'Balance due',
    extensionPoint: 'patient.header.actions',
    domain: 'billing',
    status: 'enabled',
    level: 'facility',
    route: '/payments',
    description: 'Surfaces patient balance and payment status where staff make routing decisions.',
  },
  {
    id: 'reports.completenessSignoff',
    label: 'Completeness signoff',
    extensionPoint: 'reports.actions',
    domain: 'reporting',
    status: 'enabled',
    level: 'facility',
    route: '/reports',
    description: 'Requires HMIS review before monthly aggregates are treated as complete.',
  },
];

export const SYSTEM_PRIVILEGE_DEFINITIONS: SystemPrivilegeDefinition[] = [
  {
    id: 'Create Visit',
    label: 'Create visit',
    domain: 'registration',
    level: 'facility',
    roles: ['front_desk', 'central_registration_clerk', 'clinic_clerk', ...FACILITY_ADMIN_ROLES],
    risk: 'medium',
    description: 'Start a same-day visit from registration, appointment check-in, emergency intake, or referral.',
  },
  {
    id: 'Create Retrospective Visit',
    label: 'Create retrospective visit',
    domain: 'registration',
    level: 'facility',
    roles: ['hrio', 'records_hmis_officer', ...FACILITY_ADMIN_ROLES],
    risk: 'high',
    description: 'Back-enter visits from paper registers or downtime records with audit trail.',
  },
  {
    id: 'Edit Patient Demographics',
    label: 'Edit demographics',
    domain: 'registration',
    level: 'facility',
    roles: ['front_desk', 'central_registration_clerk', 'hrio', 'records_hmis_officer', ...FACILITY_ADMIN_ROLES],
    risk: 'medium',
    description: 'Correct name, age, sex, address, phone, next-of-kin, and patient identifiers.',
  },
  {
    id: 'Merge Patients',
    label: 'Merge duplicate patients',
    domain: 'registration',
    level: 'facility',
    roles: ['hrio', 'records_hmis_officer', ...FACILITY_ADMIN_ROLES],
    risk: 'high',
    description: 'Resolve duplicate charts while preserving identifiers, visits, orders, and audit history.',
  },
  {
    id: 'Mark Patient Dead',
    label: 'Mark patient deceased',
    domain: 'clinical',
    level: 'facility',
    roles: ['doctor', 'clinical_officer', 'clinician', 'medical_superintendent', 'hrio', 'records_hmis_officer'],
    risk: 'high',
    description: 'Record death status and link vital-event documentation.',
  },
  {
    id: 'Delete Patient',
    label: 'Void patient record',
    domain: 'security',
    level: 'platform',
    roles: ['super_admin'],
    risk: 'high',
    description: 'Administrative void only; routine corrections should use merge or demographic edit.',
  },
  {
    id: 'Confirm Appointments',
    label: 'Confirm appointments',
    domain: 'operations',
    level: 'facility',
    roles: ['front_desk', 'central_registration_clerk', 'clinic_clerk', ...FACILITY_ADMIN_ROLES],
    risk: 'medium',
    description: 'Confirm scheduled appointments and create the patient-facing appointment status.',
  },
  {
    id: 'Order Investigations',
    label: 'Order labs and imaging',
    domain: 'clinical',
    level: 'facility',
    roles: CLINICAL_PROVIDER_ROLES,
    risk: 'medium',
    description: 'Create lab and imaging orders from the consultation or authorized direct-service flow.',
  },
  {
    id: 'Release Results',
    label: 'Release results',
    domain: 'clinical',
    level: 'facility',
    roles: ['lab_tech', 'radiologist', 'medical_superintendent'],
    risk: 'high',
    description: 'Finalize laboratory or imaging results and return them to the clinician queue.',
  },
  {
    id: 'Dispense Medication',
    label: 'Dispense medication',
    domain: 'clinical',
    level: 'facility',
    roles: ['pharmacist', 'medical_superintendent'],
    risk: 'high',
    description: 'Mark prescriptions as dispensed after verification, payment status, and stock review.',
  },
  {
    id: 'Receive Payment',
    label: 'Receive payment',
    domain: 'billing',
    level: 'facility',
    roles: ['cashier', 'medical_biller', ...FACILITY_ADMIN_ROLES],
    risk: 'high',
    description: 'Record money received, issue receipts, and update patient account status.',
  },
  {
    id: 'Manage System Administration',
    label: 'Manage system administration',
    domain: 'it',
    level: 'facility',
    roles: RECORDS_ADMIN_ROLES,
    risk: 'high',
    description: 'Configure apps, extensions, privileges, metadata, integrations, and facility-level behavior.',
  },
];

export const SYSTEM_METADATA_DEFINITIONS: SystemMetadataDefinition[] = [
  {
    id: 'locations',
    label: 'Locations',
    domain: 'metadata',
    level: 'facility',
    route: '/facility-settings',
    countLabel: 'Rooms, wards, departments',
    description: 'Physical and service locations used for routing, reports, queues, and visit context.',
  },
  {
    id: 'visitTypes',
    label: 'Visit types',
    domain: 'metadata',
    level: 'facility',
    route: '/facility-settings',
    countLabel: 'Appointment, walk-in, referral, emergency',
    description: 'Controls how patient journeys start and which routing defaults apply.',
  },
  {
    id: 'encounterTypes',
    label: 'Encounter types',
    domain: 'metadata',
    level: 'facility',
    route: '/facility-settings',
    countLabel: 'Registration, triage, consultation, lab, pharmacy, checkout',
    description: 'Typed clinical/operational events used for patient timeline and reporting.',
  },
  {
    id: 'encounterRoles',
    label: 'Encounter roles',
    domain: 'metadata',
    level: 'facility',
    route: '/facility-settings',
    countLabel: 'Provider, nurse, lab, pharmacist, cashier, records',
    description: 'Defines who performed or owned each part of a visit.',
  },
  {
    id: 'identifierTypes',
    label: 'Patient identifier types',
    domain: 'registration',
    level: 'facility',
    route: '/facility-settings',
    countLabel: 'Hospital number, national ID, phone, biometrics',
    description: 'Configures patient lookup and returning-patient reassignment behavior.',
  },
  {
    id: 'providerAttributes',
    label: 'Provider attributes',
    domain: 'security',
    level: 'facility',
    route: '/admin/users',
    countLabel: 'Cadre, license, department, facility',
    description: 'Keeps provider accounts separate from ordinary user accounts.',
  },
  {
    id: 'conceptDictionary',
    label: 'Concept dictionary',
    domain: 'metadata',
    level: 'organization',
    route: '/facility-settings',
    countLabel: 'ICD-11, LOINC, local concepts',
    description: 'Maps symptoms, diagnoses, observations, lab tests, and report buckets to standard codes.',
  },
  {
    id: 'reports',
    label: 'Report definitions',
    domain: 'reporting',
    level: 'organization',
    route: '/reports',
    countLabel: 'HMIS, disease, finance, data-quality',
    description: 'Defines report sources, disease buckets, completeness gates, and DHIS2 export mappings.',
  },
];

export const SYSTEM_GLOBAL_PROPERTY_DEFINITIONS: SystemGlobalPropertyDefinition[] = [
  {
    id: 'defaultEncounterTemplate',
    label: 'Default encounter template',
    domain: 'clinical',
    level: 'facility',
    route: '/facility-settings',
    currentValue: 'Profile-aware SOAP consultation',
    description: 'Starts consultation with chief complaint, then intake, examination, assessment, orders, plan, and signoff.',
  },
  {
    id: 'createRetrospectiveVisit.enabled',
    label: 'Retrospective visits',
    domain: 'registration',
    level: 'facility',
    route: '/system-admin',
    currentValue: 'Records/HMIS and admins only',
    description: 'Permits downtime/paper back-entry without giving all reception staff backdating rights.',
  },
  {
    id: 'activeVisit.checkoutGates',
    label: 'Checkout gates',
    domain: 'operations',
    level: 'facility',
    route: '/facility-settings',
    currentValue: 'Payment, dispensing, critical labs, procedures, documentation',
    description: 'Prevents clearing patients before required work is finished or deferred.',
  },
  {
    id: 'appointments.confirmationPolicy',
    label: 'Appointment confirmation policy',
    domain: 'operations',
    level: 'facility',
    route: '/appointments',
    currentValue: 'Reception confirms; updates auto-stamp actor/time',
    description: 'Clarifies who confirms appointments and how status updates are audited.',
  },
  {
    id: 'reports.monthlyDeadline',
    label: 'HMIS monthly deadline',
    domain: 'reporting',
    level: 'facility',
    route: '/facility-settings',
    currentValue: 'Configured per facility',
    description: 'Controls reporting completeness checks and DHIS2 submission reminders.',
  },
  {
    id: 'it.offlineMode',
    label: 'Offline mode',
    domain: 'it',
    level: 'facility',
    route: '/it',
    currentValue: 'Allowed with sync monitoring',
    description: 'Supports low-connectivity sites while surfacing sync failures and device review requirements.',
  },
];

export function domainLabel(domain: AdminDomain): string {
  return domain
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function statusLabel(status: AppStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

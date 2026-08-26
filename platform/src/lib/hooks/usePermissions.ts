import { useAuth } from '@/lib/context';
import { isRouteAllowed, getRoleConfig } from '@/lib/permissions';
import type { UserRole } from '@/lib/db-types';

export function usePermissions() {
  const { currentUser } = useAuth();
  const role = currentUser?.role as UserRole | undefined;

  const isSuperAdmin = role === 'super_admin';
  const isOrgAdmin = role === 'org_admin';
  const isGovernment = role === 'government';
  const isDataEntry = role === 'data_entry_clerk';
  const isHospitalManager = role === 'hospital_manager';
  const isMedicalBiller = role === 'medical_biller';
  const isCashier = role === 'cashier';
  const isMidwife = role === 'midwife';
  const isCountyDirector = role === 'county_health_director';
  // Clinical-flow workflow stations (EHR Clinical Flow doc §4)
  const isClinician = role === 'clinician';
  const isTriageNurse = role === 'triage_nurse';
  const isRoomingNurse = role === 'rooming_nurse';
  const isRegistrationClerk = role === 'central_registration_clerk';
  const isClinicClerk = role === 'clinic_clerk';
  const isRecordsHmis = role === 'records_hmis_officer';

  // Platform & org management
  const canManagePlatform = isSuperAdmin;
  const canManageOrg = isSuperAdmin || isOrgAdmin;
  const canViewCrossOrg = isSuperAdmin;
  const canEditBranding = isSuperAdmin || isOrgAdmin;
  // Must mirror WRITE_ROLES in /api/users — user accounts are provisioned
  // through that central API (the security boundary), so showing the
  // management UI to roles the API rejects (e.g. government)
  // only produced 403s — or worse, before centralization, stranded local-only
  // accounts that could never log in anywhere.
  const canManageUsers = isSuperAdmin || isOrgAdmin;

  // Clinical work — only clinical staff. super_admin is a SaaS platform
  // operator: it keeps clinical *read* (canViewClinical) for support/QA but
  // not clinical *write* (consult/prescribe/order/dispense/results).
  const isMedSupt = role === 'medical_superintendent';
  const canEditClinical = role === 'doctor' || role === 'clinical_officer' || isClinician || isMedSupt;
  // Midwives provide clinical maternity care, so they can view clinical records.
  const canViewClinical = role === 'doctor' || role === 'clinical_officer' || role === 'nurse' || isMidwife || isClinician || isTriageNurse || isRoomingNurse || isMedSupt || isSuperAdmin;
  const canConsult = role === 'doctor' || role === 'clinical_officer' || isClinician || isMedSupt;
  const canPrescribe = role === 'doctor' || role === 'clinical_officer' || isClinician || isMedSupt;
  const canOrderLabs = role === 'doctor' || role === 'clinical_officer' || isClinician || isMedSupt;

  // Registration is needed at triage/rooming in small facilities. Those are
  // now nurse assignments rather than separate account roles, so the shared
  // nurse role keeps the union of the retired roles' capabilities.
  const canRegisterPatients = role === 'doctor' || role === 'clinical_officer' || role === 'nurse' || isMidwife || isClinician || isTriageNurse || isRoomingNurse || isRegistrationClerk || isClinicClerk || role === 'front_desk' || role === 'hrio' || isMedSupt;

  // Specialized roles
  const canDispense = role === 'pharmacist';
  const canEnterLabResults = role === 'lab_tech';

  // Referrals — clinical staff + front desk + supervisors + midwife (obstetric)
  const canManageReferrals = role === 'doctor' || role === 'clinical_officer' || role === 'nurse' || isClinician || isMidwife || isRegistrationClerk || role === 'front_desk' || isSuperAdmin;

  // Appointments — route visibility is broad, but workflow actions are split
  // by duty: reception schedules/checks in, clinicians advance visits, HMIS
  // and management can export operational lists.
  // Triage/rooming nurses book too: since the nurse station merged into the
  // shared clinical dashboard, "Book appointment" is their path for sending a
  // routine walk-in to a clinic slot instead of holding them in the queue.
  const canBookAppointments = role === 'doctor' || role === 'clinical_officer' || role === 'nurse' || isMidwife || isClinician || isTriageNurse || isRoomingNurse || isRegistrationClerk || isClinicClerk || role === 'front_desk' || isMedSupt || isSuperAdmin;
  const canConfirmAppointments = isRegistrationClerk || isClinicClerk || role === 'front_desk' || isMedSupt || isOrgAdmin || isSuperAdmin;
  const canManageAppointmentSchedule = canConfirmAppointments;
  const canCheckInAppointments = role === 'doctor' || role === 'clinical_officer' || role === 'nurse' || isMidwife || isClinician || isTriageNurse || isRoomingNurse || isRegistrationClerk || isClinicClerk || role === 'front_desk' || isMedSupt || isSuperAdmin;
  const canAdvanceAppointments = role === 'doctor' || role === 'clinical_officer' || role === 'nurse' || isMidwife || isClinician || isTriageNurse || isRoomingNurse || isMedSupt || isSuperAdmin;
  const canExportAppointments = isRegistrationClerk || isClinicClerk || role === 'front_desk' || role === 'hrio' || isRecordsHmis || isHospitalManager || isMedSupt || isOrgAdmin || isSuperAdmin;

  // Messages — any clinical/CHW role can send (view is broader via nav config)
  const canSendMessages = role === 'doctor' || role === 'clinical_officer' || role === 'nurse' || isMidwife || isClinician || isTriageNurse || isRoomingNurse || isRegistrationClerk || isClinicClerk || isRecordsHmis || role === 'front_desk' || isCashier || role === 'pharmacist' || role === 'lab_tech' || isCountyDirector || role === 'hrio' || role === 'nutritionist' || role === 'radiologist' || isMedSupt || isOrgAdmin || isSuperAdmin;

  // Facility assessments — data entry + supervisors + government + hospital manager + county + records/admin
  const canAssessFacility = isDataEntry || role === 'hrio' || isRecordsHmis || isMedSupt || isGovernment || isCountyDirector || isHospitalManager || isSuperAdmin;

  // Analytics & intelligence — management + government + county (moved off doctors)
  const canViewEpidemicIntel = isHospitalManager || isMedSupt || isGovernment || isCountyDirector || isSuperAdmin;
  const canViewMCHAnalytics = role === 'nutritionist' || isHospitalManager || isMedSupt || isGovernment || isCountyDirector || isSuperAdmin;

  // Reports & export — HRIO, records/HMIS officer, and the county director own DHIS2/HMIS reporting.
  const canExportDHIS2 = isGovernment || isHospitalManager || role === 'hrio' || isRecordsHmis || isCountyDirector || isSuperAdmin;
  // Reports/analytics were deliberately moved off clinicians (see canViewEpidemicIntel/
  // canViewMCHAnalytics above) onto HMIS/management/government roles; clinical_officer
  // was a leftover here and is intentionally excluded for consistency.
  const canViewReports = role === 'hrio' || isRecordsHmis || isHospitalManager || isMedSupt || isGovernment || isCountyDirector || isOrgAdmin || isSuperAdmin;

  // Billing & collections — biller + dedicated cashier + management + admins.
  // Front desk no longer handles money (separation of duties).
  const canCollectPayments = isMedicalBiller || isCashier || isMedSupt || isOrgAdmin || isSuperAdmin;
  const canManageBilling = isMedicalBiller || isHospitalManager || isOrgAdmin || isSuperAdmin;

  // Vital events — clinical staff + midwife + BHW/CHV + records/data entry + workflow nurses/clinician
  const canRecordVitalEvents = role === 'doctor' || role === 'clinical_officer' || role === 'nurse' || isMidwife || isClinician || isTriageNurse || isRoomingNurse || isRecordsHmis || role === 'hrio' || isDataEntry || isMedSupt;

  const canAccess = (path: string): boolean => {
    if (!role) return false;
    return isRouteAllowed(role, path);
  };

  const roleConfig = role ? getRoleConfig(role) : null;

  const permissions = {
    role,
    roleConfig,
    isSuperAdmin,
    isOrgAdmin,
    isGovernment,
    isDataEntry,
    isHospitalManager,
    isMedicalBiller,
    isCashier,
    isMidwife,
    isCountyDirector,
    canManagePlatform,
    canManageOrg,
    canViewCrossOrg,
    canEditBranding,
    canManageUsers,
    canEditClinical,
    canViewClinical,
    canConsult,
    canPrescribe,
    canOrderLabs,
    canRegisterPatients,
    canDispense,
    canEnterLabResults,
    canManageReferrals,
    canBookAppointments,
    canConfirmAppointments,
    canManageAppointmentSchedule,
    canCheckInAppointments,
    canAdvanceAppointments,
    canExportAppointments,
    canSendMessages,
    canAssessFacility,
    canViewEpidemicIntel,
    canViewMCHAnalytics,
    canExportDHIS2,
    canViewReports,
    canCollectPayments,
    canManageBilling,
    canRecordVitalEvents,
    canAccess,
  };

  // Total access: the platform super-admin gets every capability boolean.
  // Done as a sweep (not per-flag) so a capability added later is covered
  // without touching this block. `canAccess` stays a function — its own
  // super_admin wildcard already lives in isPathAllowed.
  if (isSuperAdmin) {
    for (const key of Object.keys(permissions) as (keyof typeof permissions)[]) {
      if (key.startsWith('can') && key !== 'canAccess') {
        (permissions as Record<string, unknown>)[key] = true;
      }
    }
  }

  return permissions;
}

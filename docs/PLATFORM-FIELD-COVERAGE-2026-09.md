# Platform field coverage review — 2026-09-07

Scanned 417 TSX files across app, components and domain modules; found 948 authored form controls in 178 files. Dynamic field renderers may represent many runtime fields. Run `node scripts/audit-form-fields.mjs` from platform for the complete per-control JSON inventory (source line, binding, input kind, options and constraints).

## Implemented

- Shared dropdown: translated search/empty states; disabled option groups remain disabled in the custom menu.
- Explicit numeric steps on 74 controls in 36 files: decimal measurements, currency and quantity inputs accept decimals; count/date-interval inputs retain integer steps. Existing clinical bounds are unchanged.
- Facility department suggestions: availability, HR shifts, equipment and referral filters.
- Medication history: existing bundled formulary suggestions and frequency suggestions, retaining free entry for external medicines or nonstandard regimens.
- All specialty field kinds have contextual or type-specific guidance; numeric units and steps remain visible; applicable fields offer explicit not-applicable selection.
- Facility staff and operational assets are offered for relevant specialty references.
- Added missing mhGAP priority-condition choices; retained historical codes.
- Added optional dermatology, optical and referral documentation suggestions without rewriting historical narrative.
- Validation rejects contradictory ETAT choices and invalid calendar dates, in addition to existing type checks.

## Evidence and limits

The research supports workflow content; the quick-entry terms and control design are implementation choices rather than a claim that WHO mandates these exact dropdowns.

- [WHO mhGAP priority conditions](https://www.who.int/publications/b/31377): expanded condition choices.
- [WHO ETAT](https://www.who.int/publications/i/item/9789241510219): danger-sign documentation and separate immediate-action field.
- [CDC dialysis infection prevention](https://www.cdc.gov/dialysis-safety/hcp/clinical-safety/index.html): access and infection-safety context.
- [HL7 VisionPrescription](https://hl7.org/fhir/visionprescription.html): bilateral prescription guidance and units.
- [DermNet terminology](https://dermnetnz.org/topics/terminology): optional morphological finding suggestions.
- [ADA record guidance](https://www.ada.org/resources/practice/practice-management/writing-in-the-dental-record): findings, consent, performed treatment and communication details.
- [WHO rehabilitation package](https://www.who.int/publications/i/item/9789240067097): measure/goal/intervention distinction; measure-specific score ranges remain locally configured.
- [WHO intrapartum guidance](https://www.who.int/publications/i/item/9789241550215): contextual maternal-care documentation.

This inventory is source coverage, not clinical certification of every runtime form. Static option counts exclude choices loaded from catalogues or facility data. No-options states depend on configured data and permissions. Existing free-text diagnostic notes, histories, search filters, local configuration and external identifiers are retained where a closed list would discard legitimate information. New clinical guidance and existing catalogue labels require local language/clinical review; locale-key parity alone does not certify translated clinical terminology.

## File coverage

| File | Controls | Choice/search controls | Numeric controls |
|---|---:|---:|---:|
| src/app/(dashboard)/admin/announcements/page.tsx | 4 | 2 | 0 |
| src/app/(dashboard)/admin/audit/page.tsx | 1 | 0 | 0 |
| src/app/(dashboard)/admin/config/page.tsx | 5 | 0 | 2 |
| src/app/(dashboard)/admin/flags/page.tsx | 2 | 2 | 0 |
| src/app/(dashboard)/admin/risk/page.tsx | 1 | 0 | 0 |
| src/app/(dashboard)/admin/users/[id]/page.tsx | 1 | 1 | 0 |
| src/app/(dashboard)/anc/page.tsx | 34 | 10 | 14 |
| src/app/(dashboard)/appointments/page.tsx | 7 | 4 | 0 |
| src/app/(dashboard)/billing/[id]/page.tsx | 12 | 2 | 5 |
| src/app/(dashboard)/billing/page.tsx | 1 | 1 | 0 |
| src/app/(dashboard)/births/page.tsx | 12 | 5 | 2 |
| src/app/(dashboard)/blood-bank/page.tsx | 10 | 2 | 1 |
| src/app/(dashboard)/controlled-substances/page.tsx | 10 | 2 | 2 |
| src/app/(dashboard)/dashboard/data-entry/page.tsx | 3 | 0 | 1 |
| src/app/(dashboard)/dashboard/front-desk/page.tsx | 3 | 1 | 0 |
| src/app/(dashboard)/dashboard/lab/page.tsx | 3 | 2 | 1 |
| src/app/(dashboard)/dashboard/nutrition/page.tsx | 13 | 1 | 5 |
| src/app/(dashboard)/dashboard/pharmacy/page.tsx | 3 | 1 | 1 |
| src/app/(dashboard)/dashboard/radiology/page.tsx | 2 | 0 | 0 |
| src/app/(dashboard)/deaths/page.tsx | 17 | 3 | 1 |
| src/app/(dashboard)/departments/specialty-care/page.tsx | 16 | 6 | 0 |
| src/app/(dashboard)/dhis2-export/page.tsx | 2 | 1 | 0 |
| src/app/(dashboard)/emergency-preparedness/page.tsx | 10 | 4 | 2 |
| src/app/(dashboard)/equipment/page.tsx | 16 | 3 | 3 |
| src/app/(dashboard)/facility-assessments/page.tsx | 8 | 1 | 4 |
| src/app/(dashboard)/facility-management/queue/page.tsx | 1 | 1 | 0 |
| src/app/(dashboard)/government/alerts/page.tsx | 1 | 0 | 0 |
| src/app/(dashboard)/hr/payroll/page.tsx | 1 | 0 | 0 |
| src/app/(dashboard)/hr/schedule/page.tsx | 1 | 0 | 0 |
| src/app/(dashboard)/immunizations/page.tsx | 19 | 6 | 2 |
| src/app/(dashboard)/inquiries/page.tsx | 5 | 3 | 0 |
| src/app/(dashboard)/lab/page.tsx | 4 | 3 | 0 |
| src/app/(dashboard)/messages/page.tsx | 6 | 0 | 0 |
| src/app/(dashboard)/my-facility/page.tsx | 3 | 2 | 1 |
| src/app/(dashboard)/org-admin/branding/page.tsx | 5 | 0 | 0 |
| src/app/(dashboard)/org-admin/pricing/page.tsx | 7 | 2 | 1 |
| src/app/(dashboard)/patients/page.tsx | 7 | 2 | 1 |
| src/app/(dashboard)/payments/portal/page.tsx | 1 | 0 | 1 |
| src/app/(dashboard)/pharmacy/page.tsx | 14 | 5 | 3 |
| src/app/(dashboard)/referrals/page.tsx | 5 | 1 | 0 |
| src/app/(dashboard)/reports/_ReportControlPanel.tsx | 3 | 2 | 0 |
| src/app/(dashboard)/surveillance/page.tsx | 8 | 6 | 2 |
| src/app/(dashboard)/transfers/page.tsx | 1 | 0 | 0 |
| src/app/(dashboard)/wards/mar/[admissionId]/page.tsx | 4 | 1 | 0 |
| src/app/(dashboard)/wards/page.tsx | 16 | 8 | 0 |
| src/app/accept-invite/page.tsx | 2 | 0 | 0 |
| src/app/checkout/[linkId]/page.tsx | 1 | 0 | 0 |
| src/app/forgot-password/page.tsx | 1 | 0 | 0 |
| src/app/login/page.tsx | 4 | 0 | 0 |
| src/app/patient-portal/activate/page.tsx | 3 | 0 | 0 |
| src/app/patient-portal/page.tsx | 7 | 3 | 0 |
| src/components/admin/FacilityFormModal.tsx | 13 | 4 | 3 |
| src/components/admin/OrganizationForm.tsx | 17 | 3 | 2 |
| src/components/admin/sadb-ui.tsx | 4 | 0 | 0 |
| src/components/admin/UserForm.tsx | 10 | 5 | 0 |
| src/components/appointments/AppointmentDetailFields.tsx | 3 | 3 | 0 |
| src/components/appointments/AppointmentEditModal.tsx | 9 | 6 | 0 |
| src/components/appointments/AppointmentStatusPillSelect.tsx | 1 | 1 | 0 |
| src/components/appointments/AppointmentStatusSelect.tsx | 1 | 1 | 0 |
| src/components/appointments/BookAppointmentModal.tsx | 19 | 12 | 0 |
| src/components/AssignDoctorModal.tsx | 2 | 0 | 0 |
| src/components/AvailabilityModal.tsx | 5 | 1 | 0 |
| src/components/billing/AdmissionDepositControls.tsx | 4 | 2 | 1 |
| src/components/booking/BookingFlow.tsx | 12 | 0 | 0 |
| src/components/booking/primitives.tsx | 2 | 1 | 0 |
| src/components/ChartCard.tsx | 1 | 1 | 0 |
| src/components/clinical-images/ClinicalImageViewer.tsx | 4 | 0 | 0 |
| src/components/clinical-notes/AllergiesModal.tsx | 5 | 2 | 0 |
| src/components/clinical-notes/assessment/IncludeProblemsModal.tsx | 6 | 0 | 0 |
| src/components/clinical-notes/CareCoordinationModal.tsx | 8 | 0 | 0 |
| src/components/clinical-notes/ClinicalNoteEditor.tsx | 5 | 2 | 0 |
| src/components/clinical-notes/FollowUpModal.tsx | 4 | 0 | 0 |
| src/components/clinical-notes/MedicationsModal.tsx | 5 | 1 | 0 |
| src/components/clinical-notes/NoteSectionCard.tsx | 1 | 0 | 0 |
| src/components/clinical-notes/PatientEducationModal.tsx | 2 | 0 | 0 |
| src/components/clinical-notes/prescribe/DrugInfoSection.tsx | 8 | 2 | 2 |
| src/components/clinical-notes/prescribe/PharmacyInfoSection.tsx | 2 | 1 | 0 |
| src/components/clinical-notes/shortcuts/ShortcutSearchInput.tsx | 1 | 0 | 0 |
| src/components/CodedSearchField.tsx | 1 | 0 | 0 |
| src/components/ConfirmDialog.tsx | 1 | 0 | 0 |
| src/components/create-dialogs/AddInquiryDialog.tsx | 5 | 1 | 0 |
| src/components/create-dialogs/AddPayrollEntryDialog.tsx | 6 | 2 | 3 |
| src/components/create-dialogs/CreateShiftDialog.tsx | 8 | 3 | 0 |
| src/components/create-dialogs/RequestLeaveDialog.tsx | 5 | 2 | 0 |
| src/components/DepartmentInput.tsx | 1 | 0 | 0 |
| src/components/ehr/chart/ChartSection.tsx | 1 | 0 | 0 |
| src/components/ehr/chart/panels/ClinicalFormsPanel.tsx | 1 | 0 | 0 |
| src/components/ehr/chart/panels/TaskListPanel.tsx | 2 | 0 | 0 |
| src/components/ehr/chart/panels/VisitNotePanel.tsx | 4 | 2 | 0 |
| src/components/ehr/chart/sections/AllergiesSection.tsx | 7 | 3 | 0 |
| src/components/ehr/chart/sections/ConditionsSection.tsx | 3 | 2 | 0 |
| src/components/ehr/chart/sections/DirectivesSection.tsx | 9 | 3 | 0 |
| src/components/ehr/chart/sections/ImmunizationsSection.tsx | 9 | 2 | 1 |
| src/components/ehr/chart/sections/MedicationsSection.tsx | 1 | 0 | 0 |
| src/components/ehr/chart/sections/OrdersSection.tsx | 1 | 1 | 0 |
| src/components/ehr/chart/sections/ProceduresSection.tsx | 8 | 1 | 0 |
| src/components/ehr/chart/sections/ProgramsSection.tsx | 5 | 2 | 0 |
| src/components/ehr/EhrCareDashboard.tsx | 2 | 1 | 0 |
| src/components/ehr/EhrClinicalDashboard.tsx | 4 | 1 | 0 |
| src/components/ehr/EhrListHeader.tsx | 1 | 0 | 0 |
| src/components/ehr/EhrModuleMenu.tsx | 1 | 0 | 0 |
| src/components/ehr/EhrTopRail.tsx | 1 | 0 | 0 |
| src/components/ehr/EhrVisitPopup.tsx | 4 | 0 | 0 |
| src/components/ehr/RowStatusSelect.tsx | 1 | 1 | 0 |
| src/components/FileUpload.tsx | 1 | 0 | 0 |
| src/components/filters/FilterSelect.tsx | 1 | 1 | 0 |
| src/components/filters/SearchInput.tsx | 1 | 0 | 0 |
| src/components/FingerprintCapture.tsx | 2 | 1 | 0 |
| src/components/front-desk/AssignmentControls.tsx | 2 | 2 | 0 |
| src/components/front-desk/CheckoutModal.tsx | 3 | 1 | 0 |
| src/components/lab/order/LabOrderCreateDialog.tsx | 5 | 2 | 0 |
| src/components/lab/order/LabOrderPatientPicker.tsx | 1 | 0 | 0 |
| src/components/lab/order/steps/ClinicalStep.tsx | 6 | 4 | 0 |
| src/components/lab/order/steps/DiagnosisStep.tsx | 3 | 1 | 0 |
| src/components/lab/order/steps/PatientStep.tsx | 2 | 1 | 0 |
| src/components/lab/order/steps/ReviewStep.tsx | 2 | 0 | 0 |
| src/components/lab/order/steps/TestsStep.tsx | 2 | 0 | 0 |
| src/components/lab/workflow/steps/LabSteps.tsx | 12 | 3 | 0 |
| src/components/lab/workflow/StructuredResultForm.tsx | 2 | 1 | 0 |
| src/components/mobile/patients/MobilePatientsView.tsx | 1 | 0 | 0 |
| src/components/nurse/HandoffWorkflow.tsx | 7 | 0 | 0 |
| src/components/nurse/ListSearch.tsx | 1 | 0 | 0 |
| src/components/nurse/NurseVitalsModal.tsx | 3 | 0 | 1 |
| src/components/nurse/RoomingWorkflow.tsx | 3 | 0 | 1 |
| src/components/nurse/TriageWorkflow.tsx | 29 | 6 | 0 |
| src/components/patient-portal/BillingTab.tsx | 1 | 0 | 0 |
| src/components/patient-portal/PatientLogin.tsx | 3 | 0 | 0 |
| src/components/patients/AddAllergyModal.tsx | 5 | 3 | 0 |
| src/components/patients/AllergyList.tsx | 5 | 2 | 0 |
| src/components/patients/AssessmentsPanel.tsx | 1 | 1 | 0 |
| src/components/patients/BillingTab.tsx | 10 | 2 | 3 |
| src/components/patients/CareAlertFields.tsx | 3 | 2 | 0 |
| src/components/patients/CareAlertsBanner.tsx | 1 | 0 | 0 |
| src/components/patients/DocumentsPanel.tsx | 2 | 1 | 0 |
| src/components/patients/PatientActionModals.tsx | 11 | 5 | 0 |
| src/components/patients/PatientDetailPage.tsx | 17 | 6 | 0 |
| src/components/patients/PhoneNotes.tsx | 6 | 1 | 0 |
| src/components/patients/PhotoCaptureModal.tsx | 1 | 0 | 0 |
| src/components/patients/PortalAccessCard.tsx | 1 | 0 | 0 |
| src/components/patients/RecordSignatureBar.tsx | 1 | 0 | 0 |
| src/components/patients/registration/sections/ContactSection.tsx | 13 | 4 | 1 |
| src/components/patients/registration/sections/CoverageSection.tsx | 4 | 1 | 0 |
| src/components/patients/registration/sections/DemographicsSection.tsx | 10 | 4 | 1 |
| src/components/patients/registration/sections/NextOfKinSection.tsx | 8 | 2 | 0 |
| src/components/patients/RemindersPanel.tsx | 3 | 1 | 0 |
| src/components/patients/ScreeningsPanel.tsx | 3 | 1 | 1 |
| src/components/patients/SuperbillPanel.tsx | 3 | 1 | 1 |
| src/components/patients/TransferHistoryPanel.tsx | 8 | 3 | 0 |
| src/components/patients/TransferPatientModal.tsx | 8 | 3 | 0 |
| src/components/payments/BillingFilterMenu.tsx | 1 | 1 | 0 |
| src/components/payments/BillingWorkspace.tsx | 4 | 0 | 1 |
| src/components/payments/ClaimsPanel.tsx | 9 | 2 | 3 |
| src/components/payments/InsurancePolicyModal.tsx | 13 | 2 | 2 |
| src/components/payments/PaymentPanel.tsx | 18 | 3 | 1 |
| src/components/pharmacy/PatientDispenseModal.tsx | 1 | 1 | 0 |
| src/components/pharmacy/workflow/steps/PharmacySteps.tsx | 11 | 2 | 1 |
| src/components/PopupSelect.tsx | 1 | 0 | 0 |
| src/components/PrintListDialog.tsx | 3 | 0 | 0 |
| src/components/radiology/workflow/steps/RadiologySteps.tsx | 19 | 5 | 1 |
| src/components/radiology/workflow/StudyImageWorkspace.tsx | 1 | 0 | 0 |
| src/components/referrals/ReferralFilters.tsx | 5 | 3 | 0 |
| src/components/referrals/ReferralFormModal.tsx | 5 | 2 | 0 |
| src/components/Select.tsx | 2 | 1 | 0 |
| src/components/settings/FacilityPolicySections.tsx | 1 | 1 | 0 |
| src/components/settings/FacilitySettingsView.tsx | 10 | 2 | 2 |
| src/components/settings/NetworkDefaultsView.tsx | 9 | 0 | 8 |
| src/components/settings/OrganizationSettingsPanel.tsx | 1 | 1 | 0 |
| src/components/settings/RoleSettingsView.tsx | 9 | 1 | 0 |
| src/components/settings/settings-controls.tsx | 3 | 0 | 0 |
| src/components/settings/SystemAdminSections.tsx | 2 | 0 | 0 |
| src/components/settings/TrashPanel.tsx | 1 | 0 | 0 |
| src/components/settings/VisitTypesSection.tsx | 4 | 3 | 0 |
| src/components/TasksPanel.tsx | 6 | 1 | 0 |
| src/modules/communication/components/AnnouncementsPanel.tsx | 5 | 3 | 0 |
| src/modules/communication/components/MessagingDock.tsx | 6 | 0 | 0 |
| src/modules/departments/components/DepartmentDirectoryEditor.tsx | 5 | 1 | 1 |
| src/modules/identity/components/BulkUserImportModal.tsx | 2 | 0 | 0 |
| src/modules/identity/components/ForcePasswordChange.tsx | 2 | 0 | 0 |


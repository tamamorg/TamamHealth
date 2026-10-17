'use client';
import dynamic from 'next/dynamic';
export const ChartPanelLoading = () => (
  <div className="h-24 rounded-lg animate-pulse" style={{ background: 'var(--overlay-subtle)' }} aria-hidden="true" />
);
// Lazy-loaded: recharts is large and only used on the Trends view, so keep it
// out of the patient-record initial bundle.
export const VitalsTrends = dynamic(() => import('@/components/VitalsTrends'), {
  ssr: false,
  loading: () => <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading charts…</div>,
});
// The chart has more than twenty mutually-exclusive sections. Keep each large
// workspace out of the facesheet bundle until its tab or action is opened.
export const PatientTimeline = dynamic(() => import('@/components/PatientTimeline'), { loading: ChartPanelLoading });
export const BillingTab = dynamic(() => import('@/components/patients/BillingTab'), { loading: ChartPanelLoading });
export const PatientSBAR = dynamic(() => import('@/components/patients/PatientSBAR'), { loading: ChartPanelLoading });
export const PortalAccessCard = dynamic(() => import('@/components/patients/PortalAccessCard'), { loading: ChartPanelLoading });
export const NotesList = dynamic(() => import('@/components/clinical-notes/NotesList'), { loading: ChartPanelLoading });
export const PhoneNotes = dynamic(() => import('@/components/patients/PhoneNotes'), { loading: ChartPanelLoading });
export const AssessmentsPanel = dynamic(() => import('@/components/patients/AssessmentsPanel'), { loading: ChartPanelLoading });
export const ScreeningsPanel = dynamic(() => import('@/components/patients/ScreeningsPanel'), { loading: ChartPanelLoading });
export const RemindersPanel = dynamic(() => import('@/components/patients/RemindersPanel'), { loading: ChartPanelLoading });
export const DocumentsPanel = dynamic(() => import('@/components/patients/DocumentsPanel'), { loading: ChartPanelLoading });
export const LabOrderModal = dynamic(() => import('@/components/lab/order/LabOrderModal'));
export const LabWorkspace = dynamic(() => import('@/components/lab/workflow/LabWorkspace'), { loading: ChartPanelLoading });
export const PharmacyWorkspace = dynamic(() => import('@/components/pharmacy/workflow/PharmacyWorkspace'), { loading: ChartPanelLoading });
export const AllergiesSection = dynamic(() => import('@/components/ehr/chart/sections/AllergiesSection'), { loading: ChartPanelLoading });
export const ConditionsSection = dynamic(() => import('@/components/ehr/chart/sections/ConditionsSection'), { loading: ChartPanelLoading });
export const OrdersSection = dynamic(() => import('@/components/ehr/chart/sections/OrdersSection'), { loading: ChartPanelLoading });
export const PatientMessagesSection = dynamic(() => import('@/components/ehr/chart/sections/PatientMessagesSection'), { loading: ChartPanelLoading });
export const HistorySection = dynamic(() => import('@/components/ehr/chart/sections/HistorySection'), { loading: ChartPanelLoading });
export const ProceduresSection = dynamic(() => import('@/components/ehr/chart/sections/ProceduresSection'), { loading: ChartPanelLoading });
export const ProgramsSection = dynamic(() => import('@/components/ehr/chart/sections/ProgramsSection'), { loading: ChartPanelLoading });
export const ImmunizationsSection = dynamic(() => import('@/components/ehr/chart/sections/ImmunizationsSection'), { loading: ChartPanelLoading });
export const DirectivesSection = dynamic(() => import('@/components/ehr/chart/sections/DirectivesSection'), { loading: ChartPanelLoading });
export const AssignDoctorModal = dynamic(() => import('@/components/AssignDoctorModal'));
export const NurseVitalsModal = dynamic(() => import('@/components/nurse/NurseVitalsModal'));
export const PrescribeModal = dynamic(() => import('@/components/patients/PatientActionModals').then(mod => mod.PrescribeModal));
export const ReferModal = dynamic(() => import('@/components/patients/PatientActionModals').then(mod => mod.ReferModal));
export const VisitSummaryDialog = dynamic(() => import('@/components/patient-handover/VisitSummaryDialog'));

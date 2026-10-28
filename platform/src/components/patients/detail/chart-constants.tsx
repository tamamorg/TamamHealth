'use client';
import { Plus } from '@/components/icons/lucide';
import type { MedicalRecordDoc } from '@/lib/db-types';

export type PrintSectionId = 'consultation' | 'problems' | 'vitals' | 'medications' | 'allergies' | 'labs' | 'immunizations' | 'appointments';
export const PRINT_SECTION_OPTIONS: Array<{ id: PrintSectionId; label: string; description: string }> = [
  { id: 'consultation', label: 'Latest consultation', description: 'Reason for visit, examination, assessment, and plan' },
  { id: 'problems', label: 'Problems and diagnoses', description: 'Current problem list and diagnoses from the latest visit' },
  { id: 'vitals', label: 'Vital signs', description: 'Most recently recorded observations' },
  { id: 'medications', label: 'Current medications', description: 'Active prescriptions and instructions' },
  { id: 'allergies', label: 'Allergies', description: 'Active allergies and adverse reactions' },
  { id: 'labs', label: 'Laboratory results', description: 'Recent results, values, units, and reference ranges' },
  { id: 'immunizations', label: 'Immunizations', description: 'Recorded vaccines and doses' },
  { id: 'appointments', label: 'Next appointment', description: 'Upcoming appointment and follow-up details' },
];
export const DEFAULT_PRINT_SECTIONS = new Set<PrintSectionId>(PRINT_SECTION_OPTIONS.map(section => section.id));
export type FacesheetPanelId = 'medications' | 'problems' | 'vitals' | 'recommendations';

/** The subset of a vitals set the chart's read-only surfaces display. Partial
 *  because a single observation rarely carries every reading — the vitals band
 *  and the facesheet both render "-" for whatever is missing. */
export type ChartVitalsLike = Partial<NonNullable<MedicalRecordDoc['vitalSigns']>>;

export const FACESHEET_PANEL_OPTIONS: Array<{ id: FacesheetPanelId; label: string }> = [
  { id: 'problems', label: 'Conditions' },
  { id: 'medications', label: 'Medications' },
  { id: 'vitals', label: 'Latest observations' },
  { id: 'recommendations', label: 'Next care actions' },
];

export const DEFAULT_FACESHEET_PANELS = FACESHEET_PANEL_OPTIONS.map(panel => panel.id);

/** Primary write-action per facesheet card, keyed by panel id. An entry is
 *  omitted when the current role can't perform it, in which case no action
 *  button renders for that card. */
export type FacesheetActions = Partial<Record<FacesheetPanelId, {
  label: string;
  onClick: () => void;
  /** Defaults to a "+" — override for actions that aren't additive (Edit, Review). */
  icon?: typeof Plus;
}>>;

export const ARRIVAL_PARAMS = ['focus', 'value', 'unit', 'range', 'note'];

/** Drop the one-shot arrival params from the address bar. The current history
 *  state is passed through rather than replaced with null: the App Router
 *  keeps its own bookkeeping in that object, and blanking it mid-navigation
 *  made the next history event restore the entry we came from. */
export function stripArrivalParams() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (!ARRIVAL_PARAMS.some(k => params.has(k))) return;
  ARRIVAL_PARAMS.forEach(k => params.delete(k));
  const qs = params.toString();
  window.history.replaceState(window.history.state, '', window.location.pathname + (qs ? `?${qs}` : ''));
}

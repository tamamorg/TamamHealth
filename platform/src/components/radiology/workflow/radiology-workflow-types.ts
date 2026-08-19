/**
 * The reading-room counterpart to ordering an image: the steps a radiographer
 * and radiologist walk a study through, from the requisition that arrived to
 * the report that goes back.
 *
 * Same shape as the lab bench (`lab-workflow-types.ts`), and literally the same
 * lifecycle — imaging studies share the order store with laboratory tests
 * (`orderKind: 'imaging'`), so a study cannot drift out of the encounter it
 * belongs to. What differs is what each stage means in a scanning room, which
 * is what this file names.
 */

import type { LabOrderStatus } from '@/lib/clinical-flow/order-lifecycles';

export type RadiologyWorkflowStepKey = 'order' | 'schedule' | 'safety' | 'acquire' | 'report' | 'release';

export const RADIOLOGY_WORKFLOW_STEPS: RadiologyWorkflowStepKey[] = [
  'order', 'schedule', 'safety', 'acquire', 'report', 'release',
];

export const RADIOLOGY_WORKFLOW_STEP_LABEL: Record<RadiologyWorkflowStepKey, string> = {
  order: 'imgFlow.stepOrder',
  schedule: 'imgFlow.stepSchedule',
  safety: 'imgFlow.stepSafety',
  acquire: 'imgFlow.stepAcquire',
  report: 'imgFlow.stepReport',
  release: 'imgFlow.stepRelease',
};

/**
 * The step a given lifecycle stage is waiting on — i.e. where the department
 * picks the study up.
 *
 * A study sent back for repeat returns to Schedule, which is the whole point of
 * the repeat: the patient has to come back to the machine.
 */
export function stepForStage(stage: LabOrderStatus): RadiologyWorkflowStepKey {
  switch (stage) {
    case 'ordered': return 'schedule';
    case 'specimen_collected': return 'safety';
    case 'rejected_needs_recollection': return 'schedule';
    case 'received_at_lab': return 'acquire';
    case 'in_process': return 'report';
    default: return 'release';
  }
}

/** How far the study has got, as a step index — everything before it is done. */
export function completedThrough(stage: LabOrderStatus): number {
  const order: Record<LabOrderStatus, number> = {
    ordered: 0,
    rejected_needs_recollection: 0,
    specimen_collected: 1,
    received_at_lab: 2,
    in_process: 3,
    resulted: 4,
    reviewed_by_clinician: 5,
    acted_upon: 5,
    communicated_to_patient: 5,
  };
  return order[stage] ?? 0;
}

export const MODALITIES = ['X-Ray', 'Ultrasound', 'CT Scan', 'MRI', 'Fluoroscopy', 'Mammography'];

/** Which modalities carry an ionising-radiation dose — the pregnancy question. */
const IONISING = new Set(['X-Ray', 'CT Scan', 'Fluoroscopy', 'Mammography']);
export const isIonising = (modality?: string): boolean => !!modality && IONISING.has(modality);

/** Which modalities the implant/device question applies to. */
export const needsImplantCheck = (modality?: string): boolean => modality === 'MRI';

export const CONTRAST_OPTIONS: { value: NonNullable<ImagingContrast>; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'oral', label: 'Oral' },
  { value: 'iv', label: 'Intravenous' },
  { value: 'both', label: 'Oral + IV' },
];

type ImagingContrast = 'none' | 'oral' | 'iv' | 'both' | undefined;

/** Why a study has to be done again rather than reported. */
export const REPEAT_REASONS = [
  'Motion artefact',
  'Positioning — anatomy not covered',
  'Exposure / technical factors',
  'Patient could not tolerate the position',
  'Equipment fault',
  'Contrast not tolerated',
  'Other',
];

/**
 * Accession fallback for studies booked before accessions were stamped.
 * Same convention as the lab's, with an IMG marker so a film and a specimen
 * can never be confused at the desk.
 */
export function fallbackAccessionNumber(study: { _id: string; accessionNumber?: string; orderedAt?: string }): string {
  if (study.accessionNumber) return study.accessionNumber;
  const ordered = new Date(study.orderedAt || Date.now());
  const day = Number.isNaN(ordered.getTime())
    ? new Date().toISOString().slice(2, 10).replace(/-/g, '')
    : ordered.toISOString().slice(2, 10).replace(/-/g, '');
  return `IMG-${day}-${study._id.replace(/^lab-/, '').slice(0, 5).toUpperCase()}`;
}

/** The study as one line — modality, region, side. */
export const studyLine = (study: { modality?: string; bodyRegion?: string; laterality?: string; testName?: string }): string =>
  [study.modality, study.bodyRegion, study.laterality].filter(Boolean).join(' · ') || study.testName || '—';

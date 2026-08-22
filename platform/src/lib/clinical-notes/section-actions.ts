/**
 * What a clinician can DO from each section of a note.
 *
 * This replaces the section templates. A template produced prose — tick some
 * boxes, get a paragraph — which read as documentation but changed nothing in
 * the chart: the medicine was still unprescribed, the lab still unordered. The
 * sections instead offer the actions that belong to what is being written, so
 * the decision and the order that carries it out happen in one place.
 *
 * Pure data, like the rest of the catalog: ids and labels only, no icons and no
 * React, so services, tests and the Edge-runtime route gate can all read it.
 */

import { isPathAllowed } from '@/lib/role-routes';
import type { NoteSectionId } from './note-catalog';

export type NoteSectionActionId =
  | 'include_problems'
  | 'review_medications'
  | 'prescribe'
  | 'manage_allergies'
  | 'record_vitals'
  | 'order_lab'
  | 'order_vaccine'
  | 'patient_education'
  | 'refer'
  | 'schedule_followup';

export interface NoteSectionActionDef {
  id: NoteSectionActionId;
  label: string;
  /** Tooltip — says what pressing it actually does. */
  description: string;
}

export const NOTE_SECTION_ACTIONS: Readonly<Record<NoteSectionActionId, NoteSectionActionDef>> = {
  include_problems: {
    id: 'include_problems', label: 'Include Problems',
    description: 'Pick problems from the chart to cite in this assessment',
  },
  review_medications: {
    id: 'review_medications', label: 'Review Meds',
    description: 'Open the medication list: renew, discontinue, reconcile',
  },
  prescribe: {
    id: 'prescribe', label: 'Prescribe',
    description: 'Write a new prescription for this patient',
  },
  manage_allergies: {
    id: 'manage_allergies', label: 'Allergies',
    description: 'Record or update this patient’s allergies',
  },
  record_vitals: {
    id: 'record_vitals', label: 'Record Vitals',
    description: 'Open the chart’s vitals flowsheet',
  },
  order_lab: {
    id: 'order_lab', label: 'Labs/Studies',
    description: 'Raise a laboratory or imaging order from this plan',
  },
  order_vaccine: {
    id: 'order_vaccine', label: 'Vaccines',
    description: 'Order a vaccine from this plan',
  },
  patient_education: {
    id: 'patient_education', label: 'Patient Education',
    description: 'Send education material to the patient',
  },
  refer: {
    id: 'refer', label: 'Refer',
    description: 'Refer this patient onward from the plan',
  },
  schedule_followup: {
    id: 'schedule_followup', label: 'Schedule Follow-up',
    description: 'Book the follow-up appointment this note asks for',
  },
};

/**
 * Actions offered per section, in the order they are shown.
 *
 * A section only lists an action when the action is the natural next move from
 * what is being documented there — Plan raises orders, Medications reaches the
 * medication list, Assessment cites the problem list. Sections that are purely
 * narrative (CC, HPI, ROS…) carry none, because a row of buttons that do not
 * apply is noise in the place a clinician is trying to think.
 */
export const SECTION_ACTIONS: Readonly<Partial<Record<NoteSectionId, readonly NoteSectionActionId[]>>> = {
  assessment: ['include_problems'],
  medications: ['review_medications', 'prescribe'],
  discharge_medications: ['review_medications', 'prescribe'],
  allergies: ['manage_allergies'],
  vitals: ['record_vitals'],
  plan: ['prescribe', 'order_lab', 'order_vaccine', 'patient_education', 'refer'],
  recommendations: ['order_lab', 'refer'],
  follow_up: ['schedule_followup'],
  patient_education: ['patient_education'],
};

/**
 * Actions that LEAVE the note for a module route, and the route they need.
 *
 * Every other action opens a dialog over the note — only this one navigates
 * (ClinicalNoteEditor pushes `/immunizations?patientId=…`, which opens the
 * add-immunization form prefilled). A role without that module got the button
 * like everyone else and landed on "Access Restricted" mid-note, so the offer
 * is withdrawn instead of the click failing.
 */
const ACTION_ROUTE: Partial<Record<NoteSectionActionId, string>> = {
  order_vaccine: '/immunizations',
};

export function actionsForSection(
  sectionId: NoteSectionId | string,
  role?: string,
): NoteSectionActionDef[] {
  const ids = SECTION_ACTIONS[sectionId as NoteSectionId] ?? [];
  return ids
    .filter(id => {
      const route = ACTION_ROUTE[id];
      // No role passed means no gate — server-side and test callers that only
      // want the catalogue keep the full list.
      return !route || !role || isPathAllowed(role, route);
    })
    .map(id => NOTE_SECTION_ACTIONS[id]);
}

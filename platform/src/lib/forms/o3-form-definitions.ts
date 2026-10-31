/**
 * The structured clinical forms, as O3Form pages (components/forms/O3Form).
 * Each is opened from the chart's Clinical forms list and filed against the
 * patient:
 *
 *  - Laboratory Test Results — built from the lab bench's own result catalogue
 *    (lab-result-catalog), so a doctor entering a result and the lab entering
 *    it fill the same fields; filed as completed lab results.
 *  - Covid 19, Mental Health Assessment (PHQ-2/PHQ-9, scored), Surgical
 *    Operation — filed as clinical notes of their own type, the answers kept
 *    structured on the note (`formData`) with a readable copy in its body.
 */

import type { O3Field, O3Page } from '@/components/forms/O3Form';
import {
  CHEMISTRY_PROFILE, HEMATOLOGY_PROFILE, STOOL_PROFILE, URINE_PROFILE,
  type LabResultProfile,
} from '@/components/lab/workflow/lab-result-catalog';

export type StructuredFormId = 'lab_results' | 'covid19' | 'mental_health' | 'surgical_operation';

export interface StructuredFormDef {
  id: StructuredFormId;
  /** Shown in the Clinical forms list and as the workspace title. */
  name: string;
  pages: O3Page[];
}

// ── Laboratory Test Results ─────────────────────────────────────────────────

/** A lab catalogue profile as O3 sections — choices drawn as radio buttons. */
export function labProfileSections(profile: LabResultProfile): O3Page['sections'] {
  return profile.sections.map(section => ({
    id: `${profile.id}-${section.id}`,
    label: section.label,
    fields: section.fields.map((f): O3Field => ({
      id: f.id,
      label: f.label,
      kind: f.kind === 'select' ? 'radio' : f.kind,
      unit: f.unit,
      options: f.options,
      step: f.kind === 'number' ? 0.1 : undefined,
    })),
  }));
}

/** One lab profile as a single O3 page (the bench's per-order entry). */
export const labProfilePage = (profile: LabResultProfile): O3Page => ({
  id: profile.id, label: profile.label, sections: labProfileSections(profile),
});

export const LAB_RESULT_PROFILES: LabResultProfile[] = [HEMATOLOGY_PROFILE, CHEMISTRY_PROFILE, URINE_PROFILE, STOOL_PROFILE];

const LAB_RESULTS_FORM: StructuredFormDef = {
  id: 'lab_results',
  name: 'Laboratory Test Results',
  pages: [
    labProfilePage(HEMATOLOGY_PROFILE),
    labProfilePage(CHEMISTRY_PROFILE),
    {
      id: 'other',
      label: 'Other',
      sections: [
        ...labProfileSections(URINE_PROFILE).map(s => ({ ...s, label: `Urine — ${s.label}` })),
        ...labProfileSections(STOOL_PROFILE).map(s => ({ ...s, label: `Stool — ${s.label}` })),
      ],
    },
  ],
};

// ── Covid 19 ────────────────────────────────────────────────────────────────

const COVID19_FORM: StructuredFormDef = {
  id: 'covid19',
  name: 'Covid 19',
  pages: [
    {
      id: 'signs',
      label: 'Covid 19 Signs and Symptoms',
      sections: [{
        id: 'signs',
        label: 'Covid 19 Signs and Symptoms',
        caption: 'Covid 19 Set',
        fields: [
          {
            id: 'covid.symptoms',
            label: 'Covid 19 Signs and Symptoms in past 14 days',
            kind: 'checkboxes',
            options: [
              'Congestion', 'Cough', 'Sneezing', 'Fever', 'Sore throat or pain with swallowing',
              'Shortness of breath', 'Loss of taste', 'Loss of smell',
              'Diarrhea, Vomiting or Abdominal pain', 'Practicing social distancing',
              'Rash, nonvesicular, unspec.',
            ],
          },
          { id: 'covid.onset', label: 'Onset Date', kind: 'date' },
        ],
      }],
    },
    {
      id: 'test',
      label: 'Covid 19 Test',
      sections: [{
        id: 'test',
        label: 'Covid 19 Test',
        caption: 'Covid 19 Test',
        fields: [
          { id: 'covid.tested', label: 'Tested for COVID 19', kind: 'select', options: ['Yes', 'No', 'Unknown'] },
          { id: 'covid.test_done', label: 'Test Done', kind: 'select', options: ['PCR', 'Rapid antigen test', 'Antibody test'] },
          { id: 'covid.result', label: 'Test Results', kind: 'select', options: ['Positive', 'Negative', 'Indeterminate', 'Pending'] },
        ],
      }],
    },
  ],
};

// ── Mental Health Assessment (PHQ-2 / PHQ-9) ────────────────────────────────

const PHQ_OPTIONS = ['Not at all', 'Several days', 'More than half the days', 'Nearly every day'];
const PHQ_ITEMS = [
  'Little interest or pleasure in doing things',
  'Feeling down, depressed or hopeless',
  'Trouble falling asleep, staying asleep, or sleeping too much',
  'Feeling tired or having little energy',
  'Poor appetite or overeating',
  "Feeling bad about yourself - or that you're a failure or have let yourself or your family down",
  'Trouble concentrating on things, such as reading the newspaper or watching television',
  'Moving or speaking so slowly that other people could have noticed. Or, the opposite - being so fidgety or restless that you have been moving around a lot more than usual',
  'Thoughts that you would be better off dead or of hurting yourself in some way',
];
const phqId = (n: number) => `phq.q${n}`;
const phqField = (n: number): O3Field => ({
  id: phqId(n), label: `${n}. ${PHQ_ITEMS[n - 1]}`, kind: 'radio', options: PHQ_OPTIONS, required: true, allowUnspecified: true,
});
/** 0–3 per answered item; an unanswered or unspecified item adds nothing. */
const phqSum = (values: Record<string, string>, items: number[]) => String(items.reduce((sum, n) => {
  const i = PHQ_OPTIONS.indexOf(values[phqId(n)] ?? '');
  return sum + (i >= 0 ? i : 0);
}, 0));

const MENTAL_HEALTH_FORM: StructuredFormDef = {
  id: 'mental_health',
  name: 'Mental Health Assessment Form',
  pages: [
    {
      id: 'phq2',
      label: 'PHQ-2 Screening',
      sections: [
        {
          id: 'intro',
          label: 'Introduction',
          intro: {
            heading: 'PHQ-9 Depression Screening',
            paragraphs: [
              { text: 'This form is used for screening, diagnosing, monitoring and measuring the severity of depression.' },
              { lead: 'Instructions:', text: 'Over the last 2 weeks, how often have you been bothered by any of the following problems?' },
            ],
          },
          fields: [],
        },
        {
          id: 'phq2',
          label: 'Patient Health Questionnaire-2 (PHQ-2)',
          fields: [
            { id: 'phq.date', label: 'Screening Date', kind: 'date', required: true, allowUnspecified: true },
            phqField(1),
            phqField(2),
          ],
        },
      ],
    },
    {
      id: 'phq9',
      label: 'PHQ-9 Additional Questions',
      sections: [{ id: 'further', label: 'Further evaluation', fields: [3, 4, 5, 6, 7, 8, 9].map(phqField) }],
    },
    {
      id: 'scoring',
      label: 'Scoring and Results',
      sections: [{
        id: 'scoring',
        label: 'PHQ-9 Scoring',
        fields: [
          { id: 'phq.score2', label: 'PHQ-2 Score (Questions 1-2)', kind: 'number', compute: v => phqSum(v, [1, 2]) },
          { id: 'phq.score9', label: 'PHQ-9 Total Score (Questions 1-9)', kind: 'number', compute: v => phqSum(v, [1, 2, 3, 4, 5, 6, 7, 8, 9]) },
        ],
      }],
    },
    {
      id: 'notes',
      label: 'Notes',
      sections: [{ id: 'notes', label: 'Additional Notes', fields: [{ id: 'phq.notes', label: 'Clinician Notes', kind: 'textarea' }] }],
    },
  ],
};

// ── Surgical Operation ──────────────────────────────────────────────────────

const SURGICAL_OPERATION_FORM: StructuredFormDef = {
  id: 'surgical_operation',
  name: 'Surgical Operation',
  pages: [{
    id: 'operation',
    label: 'Surgical Operation',
    sections: [{
      id: 'progress',
      label: 'Surgical progress',
      fields: [
        { id: 'op.pre_dx', label: 'Pre-Operative Diagnosis', kind: 'textarea' },
        { id: 'op.post_dx', label: 'Post-Operative Diagnosis', kind: 'textarea' },
        { id: 'op.procedure', label: 'Procedure', kind: 'textarea' },
        { id: 'op.assistants', label: 'Assistants', kind: 'textarea' },
        {
          id: 'op.anesthesia', label: 'Anesthesia Type', kind: 'radio', options: [
            'General', 'Monitored Anesthesia Care', 'Knee Block', 'Axillary Block', 'Interscalene Block',
            'Intravenous Block', 'Local Anesthesia and Sedation', 'Local Anesthesia',
          ],
        },
        { id: 'op.blood_loss', label: 'Estimated Blood Loss', unit: 'mls', kind: 'number', step: 10 },
        { id: 'op.complications', label: 'Complications', kind: 'textarea' },
        { id: 'op.specimens', label: 'Specimens', kind: 'textarea' },
        { id: 'op.drains', label: 'Drains', kind: 'textarea' },
        { id: 'op.condition', label: 'Condition upon discharge from OR', kind: 'textarea' },
        { id: 'op.surgeons', label: 'Surgeon(s)', kind: 'textarea' },
        { id: 'op.time', label: 'Time of Procedure', kind: 'datetime' },
        { id: 'op.instructions', label: 'Post-Operative Instructions', kind: 'textarea' },
      ],
    }],
  }],
};

export const STRUCTURED_FORMS: Record<StructuredFormId, StructuredFormDef> = {
  lab_results: LAB_RESULTS_FORM,
  covid19: COVID19_FORM,
  mental_health: MENTAL_HEALTH_FORM,
  surgical_operation: SURGICAL_OPERATION_FORM,
};

/** The note-backed forms (Laboratory Test Results files lab results instead). */
export const NOTE_FORM_IDS = ['covid19', 'mental_health', 'surgical_operation'] as const;
export type NoteFormId = typeof NOTE_FORM_IDS[number];

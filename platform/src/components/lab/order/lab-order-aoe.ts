/**
 * Ask-at-Order-Entry (AOE) questions.
 *
 * A requisition that arrives at the bench without its AOEs is either run wrong
 * or sent back: a glucose is uninterpretable without the fasting state, a
 * culture without recent-antibiotic history reads as a false negative, and an
 * X-ray on a woman of childbearing age needs a pregnancy answer before the
 * exposure. This module is the single place those rules live — the Clinical
 * step just renders whatever `aoeQuestionsFor` returns.
 *
 * Every question carries a `help` line saying what the bench does with the
 * answer. The clinician is the one filling these in for someone else to read,
 * so a question with no stated use reads as paperwork — the test suite holds
 * the line that none ships without one.
 *
 * Matching is by catalogue name with a regex fallback, so a facility that
 * renames "Blood Culture" to "Blood culture (aerobic)" still gets the culture
 * questions.
 */

import type { AoeQuestion, OrderedTest } from './lab-order-types';

export interface AoePatientContext {
  sex?: string;
  /** Years. Used for the childbearing-age pregnancy questions. */
  age?: number;
}

const YES_NO_UNKNOWN = ['Yes', 'No', 'Unknown'];

const FASTING: AoeQuestion = {
  id: 'fasting',
  label: 'Was the patient fasting?',
  type: 'select',
  options: YES_NO_UNKNOWN,
  required: true,
  help: 'A non-fasting sample changes the reference range the bench applies.',
};

const HOURS_SINCE_MEAL: AoeQuestion = {
  id: 'hours_since_meal',
  label: 'Hours since the last meal',
  type: 'number',
  help: 'Tells the bench whether a sample labelled non-fasting was in fact taken hours after eating.',
};

const RECENT_ANTIBIOTICS: AoeQuestion = {
  id: 'recent_antibiotics',
  label: 'Antimicrobials in the last 72 hours?',
  type: 'select',
  options: YES_NO_UNKNOWN,
  required: true,
  help: 'Recent antibiotics suppress growth and make a negative culture unreliable.',
};

const ANTIBIOTIC_NAMES: AoeQuestion = {
  id: 'antibiotic_names',
  label: 'Which antimicrobials?',
  type: 'text',
  help: 'Names the drug that may be suppressing growth, and which sensitivities matter most.',
};

const TEMP_AT_COLLECTION: AoeQuestion = {
  id: 'temp_at_collection',
  label: 'Temperature at collection (°C)',
  type: 'number',
  help: 'Recorded with the culture, so the result is read against how unwell the patient was at the draw.',
};

const PREGNANCY: AoeQuestion = {
  id: 'pregnant',
  label: 'Is the patient pregnant?',
  type: 'select',
  options: YES_NO_UNKNOWN,
  required: true,
  help: 'The imaging unit must justify, shield or change a radiation study when pregnancy is possible.',
};

const LMP: AoeQuestion = {
  id: 'lmp',
  label: 'Last menstrual period',
  type: 'date',
  help: 'Dates the pregnancy, so an hCG level is read against the range expected for that week.',
};

/** Rules are evaluated in order; every match contributes its questions. */
const RULES: { match: (test: OrderedTest) => boolean; questions: AoeQuestion[] }[] = [
  {
    match: t => /glucose|lipid|cholesterol|triglyceride/i.test(t.name),
    questions: [FASTING, HOURS_SINCE_MEAL],
  },
  {
    match: t => /culture/i.test(t.name),
    questions: [
      RECENT_ANTIBIOTICS,
      ANTIBIOTIC_NAMES,
      TEMP_AT_COLLECTION,
      { id: 'collection_site', label: 'Collection site', type: 'text', help: 'e.g. left antecubital fossa, wound margin. Tells the bench which organisms are likely contaminants.' },
    ],
  },
  {
    match: t => /hiv|cd4/i.test(t.name),
    questions: [
      { id: 'counselling', label: 'Pre-test counselling given and consent recorded?', type: 'select', options: ['Yes', 'No'], required: true, help: 'HIV testing needs recorded consent; the bench checks for it before running the test.' },
      { id: 'previous_test', label: 'Previously tested for HIV?', type: 'select', options: YES_NO_UNKNOWN, help: 'Tells the bench whether this is a first screen or a repeat, which follow different testing steps.' },
      { id: 'on_art', label: 'Currently on ART?', type: 'select', options: YES_NO_UNKNOWN, help: 'Treatment status changes how a CD4 count or a repeat test is read.' },
    ],
  },
  {
    match: t => /malaria/i.test(t.name),
    questions: [
      { id: 'fever_onset_days', label: 'Days since fever onset', type: 'number', required: true, help: 'Helps the bench judge whether a negative rapid test should be followed by microscopy.' },
      { id: 'recent_antimalarial', label: 'Antimalarial taken in the last 28 days?', type: 'select', options: YES_NO_UNKNOWN, required: true, help: 'Recent treatment can leave a rapid test positive after the parasite has cleared.' },
    ],
  },
  {
    match: t => /afb|tb|tuberculo|sputum/i.test(t.name),
    questions: [
      { id: 'sample_number', label: 'Which sample is this?', type: 'select', options: ['First (spot)', 'Second (morning)', 'Third'], required: true, help: 'Spot and morning samples are logged and reported together as one set.' },
      { id: 'cough_weeks', label: 'Duration of cough (weeks)', type: 'number', help: 'Entered in the TB laboratory register with the request.' },
      { id: 'tb_history', label: 'Previously treated for TB?', type: 'select', options: YES_NO_UNKNOWN, help: 'Previously treated patients are prioritised for drug-resistance testing.' },
    ],
  },
  {
    match: t => /hcg|pregnancy/i.test(t.name),
    questions: [LMP],
  },
  {
    match: t => /urinalysis|urine/i.test(t.name) || t.specimen === 'Urine',
    questions: [
      { id: 'collection_method', label: 'Collection method', type: 'select', options: ['Clean-catch midstream', 'Catheter', 'Bag (infant)', 'Random'], required: true, help: 'Sets how much contamination the bench expects and the growth threshold it reports against.' },
    ],
  },
  {
    match: t => /renal|liver|creatinine|urea/i.test(t.name),
    questions: [
      { id: 'current_medications', label: 'Current medications', type: 'text', help: 'Nephrotoxic or hepatotoxic drugs change how the result is read.' },
    ],
  },
  {
    match: t => t.specimen === 'Imaging' || /x-ray|ultrasound|ct\b|mri/i.test(t.name),
    questions: [
      { id: 'clinical_question', label: 'Clinical question for the radiographer', type: 'text', required: true, help: 'What the study needs to answer — "rule out lobar pneumonia", not "chest pain".' },
      { id: 'body_site', label: 'Body site / laterality', type: 'text', required: true, help: 'Tells the radiographer exactly which region and side to image.' },
      { id: 'prior_imaging', label: 'Prior imaging of this site available?', type: 'select', options: YES_NO_UNKNOWN, help: 'Lets the reader compare against the earlier study.' },
    ],
  },
];

/** True when a pregnancy answer is clinically required before this test runs. */
const needsPregnancyCheck = (test: OrderedTest, ctx: AoePatientContext): boolean => {
  const female = (ctx.sex || '').toLowerCase().startsWith('f');
  const childbearing = ctx.age == null || (ctx.age >= 12 && ctx.age <= 55);
  const irradiating = /x-ray|ct\b|fluoro/i.test(test.name);
  return female && childbearing && irradiating;
};

/**
 * The AOE questions for one test, given who the patient is. Deduplicated by id
 * so a test matching two rules never asks the same thing twice.
 */
export function aoeQuestionsFor(test: OrderedTest, ctx: AoePatientContext = {}): AoeQuestion[] {
  const out: AoeQuestion[] = [];
  const seen = new Set<string>();
  const push = (question: AoeQuestion) => {
    if (seen.has(question.id)) return;
    seen.add(question.id);
    out.push(question);
  };
  for (const rule of RULES) {
    if (!rule.match(test)) continue;
    rule.questions.forEach(push);
  }
  if (needsPregnancyCheck(test, ctx)) push(PREGNANCY);
  return out;
}

/** Every test that has at least one question, with its questions. */
/** Every question any rule can ask — what the "none ships without help" test walks. */
export const ALL_AOE_QUESTIONS: AoeQuestion[] = [...RULES.flatMap(rule => rule.questions), PREGNANCY];

export function aoeSchedule(tests: OrderedTest[], ctx: AoePatientContext = {}): { test: OrderedTest; questions: AoeQuestion[] }[] {
  return tests
    .map(test => ({ test, questions: aoeQuestionsFor(test, ctx) }))
    .filter(entry => entry.questions.length > 0);
}

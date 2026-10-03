/**
 * Reason for test — the rules behind the lab order's "why".
 *
 * The wizard used to demand a "Diagnosis" before the test that would establish
 * one, and offered only confirmed diseases to pick from. These tests hold the
 * replacement: a symptom or a screening code is a complete reason, complaint
 * text suggests symptoms (never conclusions), and every order-entry question
 * says what the bench does with its answer.
 */
import { COMMON_ICD11_CODES } from '@/lib/icd11-codes';
import { ALL_AOE_QUESTIONS, aoeQuestionsFor } from '@/components/lab/order/lab-order-aoe';
import { LAB_ORDER_STEPS } from '@/components/lab/order/lab-order-types';
import {
  NO_SYMPTOM_REASONS,
  REASON_SEARCH_OPTIONS,
  SUSPECTED_REASONS,
  SYMPTOM_REASONS,
  problemListReasons,
  reasonContextFromNote,
  suggestReasonsFromText,
} from '@/components/lab/order/lab-order-reasons';

const codes = (reasons: { code: string }[]) => reasons.map(reason => reason.code);

describe('the wizard no longer has a Diagnosis step', () => {
  it('runs Patient → Tests → Clinical → Review → Complete', () => {
    expect(LAB_ORDER_STEPS).toEqual(['patient', 'tests', 'clinical', 'review', 'complete']);
  });
});

describe('symptom reasons', () => {
  it('are symptoms and signs only — no disease is offered as a default', () => {
    const symptomCodes = new Set(
      COMMON_ICD11_CODES.filter(entry => entry.chapter === 'Symptoms & signs').map(entry => entry.code),
    );
    expect(SYMPTOM_REASONS.length).toBe(symptomCodes.size);
    for (const reason of SYMPTOM_REASONS) expect(symptomCodes.has(reason.code)).toBe(true);
  });

  it('lead with what a patient walks in with', () => {
    expect(codes(SYMPTOM_REASONS).slice(0, 4)).toEqual(['MG26', 'MD12', 'MB4D', 'MD81.4']);
  });

  it('never overlap the suspected-condition list', () => {
    const suspected = new Set(codes(SUSPECTED_REASONS));
    expect(codes(SYMPTOM_REASONS).filter(code => suspected.has(code))).toEqual([]);
  });
});

describe('no-symptom reasons', () => {
  it('cover a well patient, a screen and a follow-up', () => {
    expect(codes(NO_SYMPTOM_REASONS)).toEqual(['QA00', 'QA08', 'QA08.4', 'QA07']);
  });

  it('do not collide with a code already in the clinical list', () => {
    const clinical = new Set(COMMON_ICD11_CODES.map(entry => entry.code));
    expect(codes(NO_SYMPTOM_REASONS).filter(code => clinical.has(code))).toEqual([]);
  });

  it('are reachable from the search box', () => {
    const searchable = new Set(REASON_SEARCH_OPTIONS.map(option => option.code));
    for (const reason of NO_SYMPTOM_REASONS) expect(searchable.has(reason.code)).toBe(true);
    // …alongside everything the old diagnosis search could find.
    for (const entry of COMMON_ICD11_CODES) expect(searchable.has(entry.code)).toBe(true);
  });
});

describe('suggestReasonsFromText', () => {
  it('suggests the symptoms a complaint names, in the order named', () => {
    expect(codes(suggestReasonsFromText('Headache and fever for 3 days, now coughing'))).toEqual(['MB4D', 'MG26', 'MD12']);
  });

  it('suggests the symptom, never the disease that lists it as a keyword', () => {
    // 1A40 (falciparum malaria) carries the keyword "fever".
    const suggested = codes(suggestReasonsFromText('fever and chills'));
    expect(suggested).toContain('MG26');
    expect(suggested).not.toContain('1A40');
    expect(suggested.every(code => SYMPTOM_REASONS.some(reason => reason.code === code))).toBe(true);
  });

  it('skips a symptom negated in its own clause', () => {
    expect(codes(suggestReasonsFromText('No cough, fever since yesterday. Denies headache.'))).toEqual(['MG26']);
  });

  it('matches by keyword as well as title', () => {
    expect(codes(suggestReasonsFromText('short of breath? shortness of breath on exertion'))).toEqual(['MD11.5']);
    expect(codes(suggestReasonsFromText('stomach pain after meals'))).toEqual(['MD81.4']);
    // How it is actually written in a note: "tired", not "tiredness".
    expect(codes(suggestReasonsFromText('Feels tired all the time'))).toEqual(['MG22']);
  });

  it('returns nothing for empty or unrelated text', () => {
    expect(suggestReasonsFromText(undefined)).toEqual([]);
    expect(suggestReasonsFromText('   ')).toEqual([]);
    expect(suggestReasonsFromText('routine antenatal booking visit')).toEqual([]);
  });

  it('honours the limit', () => {
    const text = 'fever, cough, headache, fatigue, wheeze, abdominal pain, swelling, fainting';
    expect(suggestReasonsFromText(text, 3)).toHaveLength(3);
  });
});

describe('problemListReasons', () => {
  it('codes the chart’s problems and drops what it cannot code', () => {
    const typhoid = COMMON_ICD11_CODES.find(entry => entry.code === '1A07')!;
    expect(problemListReasons([typhoid.title, 'something unheard of', typhoid.title])).toEqual([
      { code: '1A07', title: typhoid.title },
    ]);
    expect(problemListReasons(undefined)).toEqual([]);
  });
});

describe('reasonContextFromNote', () => {
  const note = {
    sections: [
      { sectionId: 'cc', text: 'Fever and headache' },
      { sectionId: 'hpi', text: 'Three days of fever, no cough' },
      {
        sectionId: 'assessment',
        text: 'Likely malaria',
        diagnoses: [
          { name: 'Malaria, unspecified', icd11Code: '1A42' },
          { name: 'Malaria, unspecified', icd11Code: '1A42' },
          { name: 'Typhoid fever' },
          { name: 'Feeling generally off' },
        ],
      },
      { sectionId: 'plan', text: 'RDT, FBC' },
    ],
  };

  it('puts the note’s coded diagnoses on the order, once each', () => {
    expect(reasonContextFromNote(note).indications).toEqual([
      { code: '1A42', title: 'Malaria, unspecified' },
      // No code on the line, but the name is a title the ICD list knows.
      { code: '1A07', title: 'Typhoid fever' },
    ]);
  });

  it('carries the complaint narrative for the symptom suggestions', () => {
    const { complaintText } = reasonContextFromNote(note);
    expect(complaintText).toBe('Fever and headache. Three days of fever, no cough');
    expect(codes(suggestReasonsFromText(complaintText))).toEqual(['MG26', 'MB4D']);
  });

  it('is empty for a note with nothing to offer', () => {
    expect(reasonContextFromNote({ sections: [{ sectionId: 'plan', text: 'review' }] })).toEqual({
      indications: [],
      complaintText: '',
    });
  });
});

describe('order-entry questions', () => {
  it('each say what the bench does with the answer', () => {
    expect(ALL_AOE_QUESTIONS.length).toBeGreaterThan(15);
    const silent = ALL_AOE_QUESTIONS.filter(question => !question.help?.trim()).map(question => question.id);
    expect(silent).toEqual([]);
  });

  it('still ask only what the selected test needs', () => {
    const ids = (name: string, specimen = 'Blood') =>
      aoeQuestionsFor({ name, specimen, tier: 'basic' }).map(question => question.id);
    expect(ids('Blood Glucose')).toEqual(['fasting', 'hours_since_meal']);
    expect(ids('Full Blood Count')).toEqual([]);
    expect(ids('Malaria RDT')).toEqual(['fever_onset_days', 'recent_antimalarial']);
  });
});

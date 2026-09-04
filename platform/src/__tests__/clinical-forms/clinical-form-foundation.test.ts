import {
  clinicalFormVersionKey,
  compareClinicalFormVersions,
  evaluateClinicalFormCondition,
  isClinicalFormFieldVisible,
  localizeClinicalText,
  parseClinicalFormSchema,
  validateClinicalFormAnswers,
  validateClinicalFormSchema,
  type ClinicalFormSchema,
} from '@/modules/clinical-forms';
import { validateClinicalFormAnswers as validateOnClient } from '@/modules/clinical-forms/client';

const label = (en: string, apd = `apd:${en}`) => ({ en, apd });

const schema: ClinicalFormSchema = {
  id: 'triage_assessment',
  version: 2,
  status: 'published',
  title: label('Triage assessment'),
  sections: [{
    id: 'assessment',
    label: label('Assessment'),
    fields: [
      { id: 'patientName', type: 'text', label: label('Patient name'), required: true },
      { id: 'temperature', type: 'number', label: label('Temperature') },
      { id: 'dangerSigns', type: 'boolean', label: label('Danger signs') },
      {
        id: 'dangerDetails',
        type: 'textarea',
        label: label('Danger sign details'),
        required: true,
        visibility: {
          match: 'all',
          rules: [{ fieldId: 'dangerSigns', operator: 'equals', value: true }],
        },
      },
      {
        id: 'symptoms',
        type: 'multiSelect',
        label: label('Symptoms'),
        options: [
          { value: 'fever', label: label('Fever') },
          { value: 'cough', label: label('Cough') },
        ],
      },
      {
        id: 'contacts',
        type: 'group',
        label: label('Contacts'),
        repeatable: { minItems: 1, maxItems: 2 },
        fields: [
          { id: 'contactName', type: 'text', label: label('Contact name'), required: true },
          { id: 'isGuardian', type: 'boolean', label: label('Guardian') },
          {
            id: 'guardianRelationship',
            type: 'select',
            label: label('Relationship'),
            required: true,
            options: [
              { value: 'parent', label: label('Parent') },
              { value: 'other', label: label('Other') },
            ],
            visibility: {
              match: 'all',
              rules: [{ fieldId: 'isGuardian', operator: 'equals', value: true }],
            },
          },
        ],
      },
    ],
  }],
};

describe('clinical form schemas', () => {
  test('accepts a valid bilingual, versioned schema through both public surfaces', () => {
    expect(validateClinicalFormSchema(schema)).toEqual([]);
    expect(clinicalFormVersionKey(schema)).toBe('triage_assessment@2');
    expect(compareClinicalFormVersions({ id: schema.id, version: 1 }, schema)).toBeLessThan(0);
    expect(localizeClinicalText(schema.title, 'apd')).toBe('apd:Triage assessment');
    expect(validateOnClient(schema, { patientName: 'A', contacts: [{ contactName: 'B' }] }).valid).toBe(true);
  });

  test('rejects malformed versions, missing translations, duplicate ids, and invalid repeat limits', () => {
    const invalid: ClinicalFormSchema = {
      ...schema,
      version: 0,
      title: { en: 'Assessment', apd: ' ' },
      sections: [{
        ...schema.sections[0],
        fields: [
          { id: 'duplicate', type: 'text', label: label('First') },
          { id: 'duplicate', type: 'text', label: label('Second') },
          {
            id: 'group',
            type: 'group',
            label: label('Group'),
            repeatable: { minItems: 3, maxItems: 2 },
            fields: [],
          },
        ],
      }],
    };

    const issues = validateClinicalFormSchema(invalid);
    expect(issues.map(issue => issue.path)).toEqual(expect.arrayContaining([
      'version',
      'title.apd',
      'sections[0].fields[1].id',
      'sections[0].fields[2].repeatable',
      'sections[0].fields[2].fields',
    ]));
  });

  test('only compares versions belonging to the same schema', () => {
    expect(() => compareClinicalFormVersions(
      { id: 'one', version: 1 },
      { id: 'two', version: 2 },
    )).toThrow('same schema id');
  });
});

describe('clinical form conditions', () => {
  test('supports equality, existence, containment, numeric comparisons, and any/all matching', () => {
    const answers = { active: true, symptoms: ['fever'], age: 12, note: '' };
    expect(evaluateClinicalFormCondition({ fieldId: 'active', operator: 'equals', value: true }, answers)).toBe(true);
    expect(evaluateClinicalFormCondition({ fieldId: 'note', operator: 'exists', value: false }, answers)).toBe(true);
    expect(evaluateClinicalFormCondition({ fieldId: 'symptoms', operator: 'contains', value: 'fever' }, answers)).toBe(true);
    expect(evaluateClinicalFormCondition({ fieldId: 'age', operator: 'greaterThanOrEqual', value: 12 }, answers)).toBe(true);
    expect(isClinicalFormFieldVisible({
      match: 'any',
      rules: [
        { fieldId: 'age', operator: 'lessThan', value: 5 },
        { fieldId: 'active', operator: 'equals', value: true },
      ],
    }, answers)).toBe(true);
  });

  test('resolves sibling answers in groups and explicit root references', () => {
    const root = { active: true, status: 'open' };
    const group = { active: false, status: 'local' };
    expect(evaluateClinicalFormCondition({ fieldId: 'active', operator: 'equals', value: false }, root, group)).toBe(true);
    expect(evaluateClinicalFormCondition({ fieldId: '$root.status', operator: 'equals', value: 'open' }, root, group)).toBe(true);
  });
});

describe('clinical form answer validation', () => {
  test('does not require a hidden field and treats false as a completed boolean answer', () => {
    const result = validateClinicalFormAnswers(schema, {
      patientName: 'Nyandeng',
      dangerSigns: false,
      contacts: [{ contactName: 'Ajak', isGuardian: false }],
    });
    expect(result).toEqual({ valid: true, errors: [] });
  });

  test('returns exact paths for visible required fields inside repeatable groups', () => {
    const result = validateClinicalFormAnswers(schema, {
      patientName: 'Nyandeng',
      dangerSigns: true,
      contacts: [{ contactName: '', isGuardian: true }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.map(error => [error.path, error.code])).toEqual([
      ['dangerDetails', 'required'],
      ['contacts[0].contactName', 'required'],
      ['contacts[0].guardianRelationship', 'required'],
    ]);
    expect(result.errors[0].messageKey).toBe('clinicalForms.validation.required');
  });

  test('rejects malformed imported JSON without throwing', () => {
    expect(parseClinicalFormSchema({ id: 'broken' })).toEqual({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'version', code: 'invalidType' }),
        expect.objectContaining({ path: 'sections', code: 'invalidType' }),
      ]),
    });
  });

  test('rejects unknown properties and returns a detached immutable schema', () => {
    const input = structuredClone(schema) as ClinicalFormSchema & { titel?: string };
    input.titel = 'typo';
    expect(parseClinicalFormSchema(input)).toEqual(expect.objectContaining({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ path: '$.titel', code: 'invalidValue' })]),
    }));

    delete input.titel;
    const parsed = parseClinicalFormSchema(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).not.toBe(input);
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(Object.isFrozen(parsed.value.sections[0].fields)).toBe(true);
    (input.sections[0].label as { en: string; apd: string }).en = 'Changed after validation';
    expect(parsed.value.sections[0].label.en).toBe('Assessment');
  });

  test('bounds imported form field collections', () => {
    const oversized = {
      ...schema,
      sections: [{
        ...schema.sections[0],
        fields: Array.from({ length: 501 }, (_, index) => ({
          id: `field_${index}`,
          type: 'text',
          label: label(`Field ${index}`),
        })),
      }],
    };
    expect(parseClinicalFormSchema(oversized)).toEqual(expect.objectContaining({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'invalidValue', path: 'sections[0].fields' }),
      ]),
    }));
  });

  test('validates condition references, comparison types, and cycles', () => {
    const invalidConditions: ClinicalFormSchema = {
      ...schema,
      sections: [{
        ...schema.sections[0],
        fields: [
          {
            id: 'one',
            type: 'number',
            label: label('One'),
            visibility: { match: 'all', rules: [{ fieldId: 'two', operator: 'greaterThan', value: 1 }] },
          },
          {
            id: 'two',
            type: 'text',
            label: label('Two'),
            visibility: { match: 'all', rules: [{ fieldId: 'one', operator: 'greaterThan', value: 1 }] },
          },
          {
            id: 'three',
            type: 'text',
            label: label('Three'),
            visibility: { match: 'all', rules: [{ fieldId: 'missing', operator: 'equals', value: 'x' }] },
          },
        ],
      }],
    };
    const issues = validateClinicalFormSchema(invalidConditions);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'cycle' }),
      expect.objectContaining({ code: 'unknownReference' }),
      expect.objectContaining({ code: 'invalidType' }),
    ]));
  });

  test('enforces clinical constraints, unknown fields, and resolved value sets', () => {
    const question = { system: 'https://tamamhealth.org/codes', version: '1', code: 'DIAGNOSIS' } as const;
    const malaria = { system: 'https://tamamhealth.org/codes', version: '1', code: 'MAL' } as const;
    const valueSet = { canonicalUrl: 'https://tamamhealth.org/value-sets/diagnoses', version: '1' } as const;
    const constrained: ClinicalFormSchema = {
      id: 'coded_assessment',
      version: 1,
      status: 'published',
      title: label('Coded assessment'),
      sections: [{
        id: 'main',
        label: label('Main'),
        fields: [
          { id: 'score', type: 'number', label: label('Score'), min: 0, max: 10, precision: 1 },
          { id: 'visitDate', type: 'date', label: label('Visit date') },
          {
            id: 'diagnosis',
            type: 'select',
            label: label('Diagnosis'),
            valueSet,
            observation: {
              concept: question,
            },
          },
        ],
      }],
    };
    expect(validateClinicalFormSchema(constrained, { concepts: [question], valueSets: [valueSet] })).toEqual([]);
    expect(validateClinicalFormAnswers(constrained, {
      score: 9.25,
      visitDate: '2026-02-31',
      diagnosis: malaria,
      injected: true,
    }).errors.map(error => error.code)).toEqual(expect.arrayContaining([
      'precision', 'invalidDate', 'unresolvedValueSet', 'unknownField',
    ]));
    expect(validateClinicalFormAnswers(constrained, { diagnosis: malaria }, {
      valueSetsByField: { diagnosis: { binding: valueSet, concepts: [malaria] } },
    })).toEqual({ valid: true, errors: [] });
    expect(validateClinicalFormAnswers(constrained, {
      diagnosis: { ...malaria, system: 'https://other.example/codes' },
    }, {
      valueSetsByField: { diagnosis: { binding: valueSet, concepts: [malaria] } },
    }).errors.map(error => error.code)).toContain('invalidOption');
  });

  test('rejects persisted answers for fields that became hidden', () => {
    const result = validateClinicalFormAnswers(schema, {
      patientName: 'Nyandeng',
      dangerSigns: false,
      dangerDetails: 'stale answer',
      contacts: [{ contactName: 'Ajak' }],
    });
    expect(result.errors).toContainEqual(expect.objectContaining({ path: 'dangerDetails', code: 'hiddenField' }));
  });

  test('keeps nested unprefixed conditions inside their sibling group', () => {
    const invalid: ClinicalFormSchema = {
      ...schema,
      sections: [{
        ...schema.sections[0],
        fields: [{
          id: 'outer', type: 'text', label: label('Outer'),
        }, {
          id: 'nested', type: 'group', label: label('Nested'), fields: [{
            id: 'inside', type: 'text', label: label('Inside'),
            visibility: { match: 'all', rules: [{ fieldId: 'outer', operator: 'equals', value: 'yes' }] },
          }],
        }],
      }],
    };
    expect(validateClinicalFormSchema(invalid)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unknownReference', path: 'sections[0].fields[1].fields[0].visibility.rules[0].fieldId' }),
    ]));
  });

  test('checks repeat limits, answer types, and configured options', () => {
    const result = validateClinicalFormAnswers(schema, {
      patientName: 'Nyandeng',
      temperature: 'hot',
      symptoms: ['unknown'],
      contacts: [
        { contactName: 'One' },
        { contactName: 'Two' },
        { contactName: 'Three' },
      ],
    });
    expect(result.errors.map(error => [error.path, error.code])).toEqual(expect.arrayContaining([
      ['temperature', 'invalidType'],
      ['symptoms', 'invalidOption'],
      ['contacts', 'maxItems'],
    ]));
  });
});

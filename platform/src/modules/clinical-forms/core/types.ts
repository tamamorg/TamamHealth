import type {
  TerminologyConceptBinding,
  TerminologyValueSetBinding,
} from '@/modules/terminology/client';

export const CLINICAL_FORM_LOCALES = ['en', 'apd'] as const;

export type ClinicalFormLocale = (typeof CLINICAL_FORM_LOCALES)[number];

/** Every clinician-facing schema label must be usable in both supported locales. */
export type LocalizedClinicalText = Readonly<Record<ClinicalFormLocale, string>>;

export type ClinicalFormStatus = 'draft' | 'published' | 'retired';

export type ClinicalFormScalar = string | number | boolean | null;
export type ClinicalFormConditionValue = ClinicalFormScalar | TerminologyConceptBinding;
export type ClinicalFormAnswers = Readonly<Record<string, unknown>>;

export type ClinicalFormConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'exists'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'contains';

export interface ClinicalFormConditionRule {
  /** A sibling field is preferred inside a group; `$root.<id>` always targets the root answers. */
  readonly fieldId: string;
  readonly operator: ClinicalFormConditionOperator;
  readonly value?: ClinicalFormConditionValue;
}

export interface ClinicalFormVisibility {
  readonly match: 'all' | 'any';
  readonly rules: readonly ClinicalFormConditionRule[];
}

interface ClinicalFormFieldBase {
  readonly id: string;
  readonly label: LocalizedClinicalText;
  readonly helpText?: LocalizedClinicalText;
  readonly required?: boolean;
  readonly visibility?: ClinicalFormVisibility;
}

export interface ClinicalFormObservationBinding {
  readonly concept: TerminologyConceptBinding;
  readonly unit?: TerminologyConceptBinding;
}

interface ClinicalFormObservationField {
  readonly observation?: ClinicalFormObservationBinding;
}

export interface ClinicalFormTextField extends ClinicalFormFieldBase, ClinicalFormObservationField {
  readonly type: 'text' | 'textarea';
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: 'phone' | 'email' | 'identifier';
}

export interface ClinicalFormNumberField extends ClinicalFormFieldBase, ClinicalFormObservationField {
  readonly type: 'number';
  readonly min?: number;
  readonly max?: number;
  readonly precision?: number;
}

export interface ClinicalFormDateField extends ClinicalFormFieldBase, ClinicalFormObservationField {
  readonly type: 'date' | 'datetime';
  readonly min?: string;
  readonly max?: string;
}

export interface ClinicalFormBooleanField extends ClinicalFormFieldBase, ClinicalFormObservationField {
  readonly type: 'boolean';
}

export interface ClinicalFormChoiceOption {
  readonly value: string;
  readonly label: LocalizedClinicalText;
}

export interface ClinicalFormChoiceField extends ClinicalFormFieldBase, ClinicalFormObservationField {
  readonly type: 'select' | 'multiSelect';
  /** Exactly one of inline options or a published value-set binding is required. */
  readonly options?: readonly ClinicalFormChoiceOption[];
  readonly valueSet?: TerminologyValueSetBinding;
}

export interface ClinicalFormGroupField extends ClinicalFormFieldBase {
  readonly type: 'group';
  readonly fields: readonly ClinicalFormField[];
  /** Omit for a single object-valued group. */
  readonly repeatable?: Readonly<{
    minItems?: number;
    maxItems?: number;
  }>;
}

export type ClinicalFormField =
  | ClinicalFormTextField
  | ClinicalFormNumberField
  | ClinicalFormDateField
  | ClinicalFormBooleanField
  | ClinicalFormChoiceField
  | ClinicalFormGroupField;

export interface ClinicalFormSection {
  readonly id: string;
  readonly label: LocalizedClinicalText;
  readonly description?: LocalizedClinicalText;
  readonly fields: readonly ClinicalFormField[];
}

export interface ClinicalFormSchema {
  /** Stable across every version of this form. */
  readonly id: string;
  /** Positive, monotonically increasing version within a form id. */
  readonly version: number;
  readonly status: ClinicalFormStatus;
  readonly title: LocalizedClinicalText;
  readonly description?: LocalizedClinicalText;
  readonly sections: readonly ClinicalFormSection[];
}

export type ClinicalFormValidationCode =
  | 'required'
  | 'invalidType'
  | 'invalidOption'
  | 'minItems'
  | 'maxItems'
  | 'invalidDate'
  | 'minimum'
  | 'maximum'
  | 'precision'
  | 'minLength'
  | 'maxLength'
  | 'pattern'
  | 'duplicateSelection'
  | 'unresolvedValueSet'
  | 'hiddenField'
  | 'unknownField';

export interface ClinicalFormValidationError {
  readonly path: string;
  readonly fieldId: string;
  readonly code: ClinicalFormValidationCode;
  /** The UI resolves this stable key through the application translation catalogue. */
  readonly messageKey: `clinicalForms.validation.${ClinicalFormValidationCode}`;
}

export interface ClinicalFormValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ClinicalFormValidationError[];
}

export interface ClinicalFormAnswerValidationContext {
  /** Exact versioned value sets resolved by field id. */
  readonly valueSetsByField?: Readonly<Record<string, Readonly<{
    binding: TerminologyValueSetBinding;
    concepts: readonly TerminologyConceptBinding[];
  }>>>;
}

export interface ClinicalFormTerminologyContext {
  readonly concepts?: readonly TerminologyConceptBinding[];
  readonly valueSets?: readonly TerminologyValueSetBinding[];
}

export interface ClinicalFormSchemaIssue {
  readonly path: string;
  readonly code: 'required' | 'invalidType' | 'invalidValue' | 'duplicate' | 'unknownReference' | 'cycle';
  readonly message: string;
}

export type ClinicalFormSchemaParseResult =
  | { readonly ok: true; readonly value: ClinicalFormSchema }
  | { readonly ok: false; readonly issues: readonly ClinicalFormSchemaIssue[] };

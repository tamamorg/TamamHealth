/**
 * The registration read-back's content: every field the form collects, grouped
 * under the section heading it was filled in under.
 *
 * Labels are the FORM's own translation keys rather than review-specific ones,
 * so the review says the same words the field said and nothing new is left
 * untranslated. `t()` falls back to printing the raw key, and ten of the eleven
 * locales lag `en.ts`, so a new key would have shown as "patientNew.reviewFoo"
 * to non-English users.
 *
 * Pure and separate from the component so the grouping can be read and tested
 * without rendering the form.
 */

export interface ReviewGroup {
  /** Index into SECTION_ANCHORS — what the group's Edit link jumps to. */
  section: number;
  title: string;
  /** [label, value] pairs; an empty value renders as an em dash. */
  rows: [string, string][];
}

/** The slice of registration state the read-back displays. */
export interface ReviewSource {
  form: Record<string, string>;
  additionalNok: { name: string; relationship: string; phone: string; address: string }[];
  fingerprintCount: number;
  geocodeId?: string;
  /**
   * Facility the patient is being registered at, by name — present only when
   * the registering user had to choose one (they carry no posting of their
   * own). Omitted otherwise, so a clerk's read-back does not grow a row
   * restating the hospital they are standing in.
   */
  registrationFacilityName?: string;
}

export function buildReviewGroups(
  steps: string[],
  source: ReviewSource,
  t: (key: string, vars?: Record<string, string | number>) => string,
): ReviewGroup[] {
  const { form, additionalNok, fingerprintCount, geocodeId, registrationFacilityName } = source;
  return [
    {
      section: 0,
      title: steps[0],
      rows: [
        ...(registrationFacilityName !== undefined
          ? ([[t('patientNew.registrationFacility'), registrationFacilityName]] as [string, string][])
          : []),
        [t('patientNew.firstName'), form.firstName],
        [t('patientNew.middleName'), form.middleName],
        [t('patientNew.surname'), form.surname],
        [t('patientNew.maidenName'), form.maidenName],
        [t('patientNew.dateOfBirth'), form.dateOfBirth],
        [t('patientNew.estimatedAge'), form.estimatedAge],
        [t('patientNew.gender'), form.gender],
        [t('patientNew.tribe'), form.tribe],
        [t('patientNew.primaryLanguage'), form.primaryLanguage],
      ] as [string, string][],
    },
    {
      section: 1,
      title: steps[1],
      rows: [
        [t('patientNew.stepBiometrics'), fingerprintCount > 0
          ? t('patientNew.reviewFingerprintsEnrolled', { count: fingerprintCount })
          : t('patientNew.reviewFingerprintsNotCaptured')],
      ] as [string, string][],
    },
    {
      section: 2,
      title: steps[2],
      rows: [
        [t('patientNew.phone'), form.phone],
        [t('patientNew.altPhone'), form.altPhone],
        [t('patientNew.whatsapp'), form.whatsapp],
        [t('patientNew.email'), form.email],
        [t('patientNew.state'), form.state],
        [t('patientNew.county'), form.county],
        [t('patientNew.payam'), form.payam],
        [t('patientNew.boma'), form.boma],
        [t('patientNew.bomaCode'), form.bomaCode],
        [t('patientNew.householdNumber'), form.householdNumber],
        [t('patientNew.geocodeId'), geocodeId || ''],
        [t('patientNew.residentialAddress'), form.address],
        [t('patientNew.nationalId'), form.nationalId],
      ] as [string, string][],
    },
    {
      section: 3,
      title: steps[3],
      rows: [
        [t('patientNew.fullName'), form.nokName],
        [t('patientNew.relationship'), form.nokRelationship],
        [t('patientNew.nokPhone'), form.nokPhone],
        [t('patientNew.nokAddress'), form.nokAddress],
        // Extra contacts are numbered rather than labelled, so the read-back
        // grows with them instead of silently reporting only the first.
        ...additionalNok.flatMap((nok, i): [string, string][] => ([
          [`${i + 2}. ${t('patientNew.fullName')}`, nok.name],
          [`${i + 2}. ${t('patientNew.relationship')}`, nok.relationship],
          [`${i + 2}. ${t('patientNew.nokPhone')}`, nok.phone],
          [`${i + 2}. ${t('patientNew.nokAddress')}`, nok.address],
        ])),
      ] as [string, string][],
    },
    {
      section: 4,
      title: steps[4],
      rows: [
        [t('patientNew.coverageTypeLabel'), form.payorCoverageType],
        [t('patientNew.programName'), form.payorProgram],
        [t('patientNew.ngoName'), form.payorNgo],
        [t('patientNew.exemptionReasonLabel'), form.payorExemptionReason === 'Other'
          ? (form.payorExemptionOther || t('patientNew.exemptionOther'))
          : form.payorExemptionReason],
      ] as [string, string][],
    },
  ];
}

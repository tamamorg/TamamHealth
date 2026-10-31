/**
 * A patient's identity documents, and the sexes the record can hold. Kept with
 * the country layer because a visitor's passport or refugee ID belongs beside
 * the national ID, which only describes people of this country.
 */

export const IDENTITY_DOCUMENT_TYPES = ['passport', 'national_id', 'refugee_id', 'insurance', 'other'] as const;
export type IdentityDocumentType = (typeof IDENTITY_DOCUMENT_TYPES)[number];

export interface PatientIdentifier {
  type: IdentityDocumentType;
  /** As printed on the document. Encrypted at rest (phi-field-catalog). */
  value: string;
  /** ISO 3166-1 alpha-2 of the issuer. */
  country?: string;
}

/** Numbers differ by issuer, so this only refuses what no document holds. */
export function isValidDocumentNumber(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 3 && trimmed.length <= 40 && !/\p{Cc}/u.test(trimmed);
}

/** The one document the forms capture, as stored; empty when none was given. */
export function identifiersFrom(type: string, value: string, country: string): PatientIdentifier[] | undefined {
  const number = value.trim();
  if (!type || !number) return undefined;
  return [{ type: type as IdentityDocumentType, value: number, ...(country ? { country } : {}) }];
}

/** No model output is a chart fact or a clinical order. */
export const SCRIBE_SECTIONS = ['cc', 'subjective', 'hpi', 'ros', 'mental_functional', 'objective', 'physical_exam', 'assessment', 'plan'] as const;
export type ScribeSection = typeof SCRIBE_SECTIONS[number];
export const MAX_SOURCE = 24000;
export const MAX_AUDIO = 10 * 1024 * 1024;
export const MAX_RECORDING_MS = 5 * 60 * 1000;
export const SCRIBE_ROLES = ['doctor', 'clinical_officer', 'clinician', 'medical_superintendent', 'nurse', 'midwife', 'triage_nurse', 'rooming_nurse'];
export function isScribeSection(value: unknown): value is ScribeSection {
  return typeof value === 'string' && (SCRIBE_SECTIONS as readonly string[]).includes(value);
}
export interface ScribeSuggestion { text: string; evidence: string[]; requestId: string; model: string; promptVersion: string }
export function validateSuggestion(value: unknown, source: string): { text: string; evidence: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_output');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => k !== 'text' && k !== 'evidence') || typeof v.text !== 'string' || !v.text.trim() || v.text.length > 12000
    || !Array.isArray(v.evidence) || v.evidence.length < 1 || v.evidence.length > 20
    || v.evidence.some(e => typeof e !== 'string' || e.length < 3 || e.length > 2000 || !source.includes(e))) throw new Error('invalid_output');
  return { text: v.text.trim(), evidence: v.evidence as string[] };
}

export function canUseScribe(actor: { _id: string; role?: string; orgId?: string }, note: {
  orgId?: string; status: string; authorId?: string; assignedToId?: string;
}) {
  return Boolean(actor.orgId && actor.orgId === note.orgId && SCRIBE_ROLES.includes(actor.role || '')
    && note.status === 'draft' && (note.authorId === actor._id || note.assignedToId === actor._id));
}

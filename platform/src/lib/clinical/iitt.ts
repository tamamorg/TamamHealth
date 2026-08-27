import type { TriagePriority } from '../db-types';

/**
 * Structured findings from the WHO/ICRC/MSF Interagency Integrated Triage
 * Tool. The labels intentionally group closely related signs so the first-
 * contact screen stays usable in a busy, resource-limited facility while the
 * stored codes remain stable for reporting.
 *
 * Sources:
 * https://www.who.int/tools/triage
 * https://cdn.who.int/media/docs/default-source/integrated-health-services-(ihs)/csy/iitt/iitt_reference-card09165e1c-0df5-472d-ab53-45506191a7bd.pdf
 */
export const IITT_RED_CRITERIA = [
  ['unresponsive_convulsions', 'Unresponsive or active convulsions'],
  ['airway_breathing', 'Stridor, respiratory distress or central cyanosis'],
  ['shock_bleeding', 'Capillary refill >3 seconds, weak/fast pulse or heavy bleeding'],
  ['high_risk_trauma', 'High-risk trauma, major burn or threatened limb'],
  ['toxin_bite', 'Poisoning, dangerous exposure or snake bite'],
  ['pregnancy_emergency', 'Pregnancy: bleeding, severe pain, seizure, severe headache/vision change, severe BP, labour or trauma'],
  ['neurologic_infection', 'Altered mental status with stiff neck, fever/hypothermia or headache'],
  ['behavioural_danger', 'Immediate danger from severe agitation, aggression, suicide attempt or self-harm'],
  ['hypoglycaemia', 'Known hypoglycaemia'],
  ['young_infant_emergency', 'Infant under 8 days, or under 2 months with temperature <36°C or >39°C'],
] as const;

export const IITT_YELLOW_CRITERIA = [
  ['airway_warning', 'Mouth/throat/neck swelling or wheeze without red signs'],
  ['feeding_fluid_loss', 'Unable to feed/drink, vomiting everything, diarrhoea or dehydration'],
  ['pallor_bleeding_fainting', 'Severe pallor, ongoing bleeding or recent fainting'],
  ['trauma_burn', 'Trauma, burn, deformity, open fracture or suspected dislocation without red signs'],
  ['urgent_exposure_surgery', 'Urgent surgical condition or exposure needing time-sensitive prophylaxis'],
  ['urogenital_assault', 'Sexual assault, acute scrotal pain/priapism or unable to pass urine'],
  ['neurologic_pain', 'Altered mental state, weakness, focal neurology, visual disturbance or severe pain'],
  ['rash_malnutrition', 'Rapidly worsening/peeling rash or severe wasting/bilateral foot oedema'],
  ['vulnerable_high_risk', 'Very young/old, frail, immunocompromised or otherwise high-risk patient'],
  ['pregnancy_complication', 'Pregnancy referred for complication without red signs'],
] as const;

export const INFECTION_RISK_SIGNS = [
  ['fever_rash', 'Fever with rash'],
  ['acute_watery_diarrhoea', 'Acute watery diarrhoea or repeated vomiting'],
  ['respiratory_exposure', 'Respiratory symptoms with outbreak/contact risk'],
  ['haemorrhagic_signs', 'Unexplained bleeding or haemorrhagic signs'],
  ['known_outbreak_contact', 'Known outbreak exposure or travel from an affected area'],
] as const;

type CodedFinding = readonly (readonly [string, string])[];

export function filterKnownIittCodes(value: unknown, catalog: CodedFinding): string[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(catalog.map(([code]) => code));
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && allowed.has(item)))];
}

export function priorityFromIittCriteria(
  redCriteria: string[],
  yellowCriteria: string[],
  capillaryRefillSeconds?: number | null,
): TriagePriority | undefined {
  if (redCriteria.length > 0 || (capillaryRefillSeconds !== null && capillaryRefillSeconds !== undefined && capillaryRefillSeconds > 3)) return 'RED';
  if (yellowCriteria.length > 0) return 'YELLOW';
  return undefined;
}

export function highestTriagePriority(...values: Array<TriagePriority | undefined>): TriagePriority | undefined {
  if (values.includes('RED')) return 'RED';
  if (values.includes('YELLOW')) return 'YELLOW';
  if (values.includes('GREEN')) return 'GREEN';
  return undefined;
}

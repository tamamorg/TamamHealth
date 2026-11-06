/**
 * Authoritative list of South Sudan administrative states.
 *
 * MIRRORED into `/api/country/metadata` (CountryMetadata.states, which spreads
 * this constant) — when adding or renaming a state, update it here. This list
 * is the canonical source for server-side services that cannot make an HTTP
 * call to themselves.
 *
 * It must stay in step with the states patients are actually registered under:
 * the registration form reads `states` from `lib/data/south-sudan-reference`
 * (the generated gazetteer), which includes Abyei Region. This constant dropped
 * Abyei, so every mch-analytics / epidemic-intelligence roll-up — which loops
 * over SOUTH_SUDAN_STATES — silently omitted Abyei patients from state totals
 * (security/data audit 2026-11-05, §2.1 #16). 11 administrative areas.
 */
export const SOUTH_SUDAN_STATES: readonly string[] = [
  'Central Equatoria', 'Eastern Equatoria', 'Western Equatoria',
  'Jonglei', 'Unity', 'Upper Nile', 'Lakes', 'Warrap',
  'Northern Bahr el Ghazal', 'Western Bahr el Ghazal',
  'Abyei Region',
] as const;

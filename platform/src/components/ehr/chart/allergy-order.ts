export interface BannerAllergy {
  substance: string;
  /** mild | moderate | severe | unknown. Absent (legacy string list) = unknown. */
  criticality?: string;
}

/** Severe and unknown-criticality allergies are the ones that change what is
 *  safe to prescribe; an allergy nobody graded must not read as minor. */
export function isHighConcern(a: BannerAllergy): boolean {
  return !a.criticality || a.criticality === 'severe' || a.criticality === 'unknown';
}

export const ALLERGY_COLLAPSE_AFTER = 3;

/**
 * Order for the header banner: high-concern first (original order kept inside
 * each group), then the rest. `visibleCount` never hides a high-concern
 * allergy, even when there are more than the usual three.
 */
export function orderBannerAllergies(allergies: BannerAllergy[]): {
  ordered: Array<BannerAllergy & { highConcern: boolean }>;
  visibleCount: number;
} {
  const tagged = allergies.map(a => ({ ...a, highConcern: isHighConcern(a) }));
  const ordered = [...tagged.filter(a => a.highConcern), ...tagged.filter(a => !a.highConcern)];
  const high = tagged.filter(a => a.highConcern).length;
  return { ordered, visibleCount: Math.max(ALLERGY_COLLAPSE_AFTER, high) };
}

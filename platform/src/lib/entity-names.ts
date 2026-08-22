/**
 * "Is this the same thing under a slightly different spelling?"
 *
 * Registries here have no natural key: a facility's id is a generated
 * `hosp-<uuid>` and an organization's is derived from its slug, so nothing
 * stopped the same real-world entity being created twice. The network list
 * ended up showing two "Juba Teaching Hospital" rows in the same town, and the
 * tenant list two Ministries of Health whose names differed only by a hyphen
 * versus an em dash — which produced different slugs, so the slug check that
 * exists never saw them as the same.
 *
 * The key below is deliberately blunt, because it guards a create button
 * rather than a merge: it folds case, accents, punctuation and every dash
 * variant into one string, so anything a person would read as the same name
 * collides. Fuzzy matching is a different job with a different tolerance —
 * `lib/patients/duplicate-match.ts` does that for people, where a near-miss
 * must warn rather than refuse.
 */

/**
 * Canonical form of an entity name for equality checks.
 *
 * Lowercases, strips diacritics, deletes apostrophes (they sit inside a name:
 * N'gor is one word), then replaces every remaining non-alphanumeric run —
 * hyphen, en dash, em dash, comma, slash, parentheses — with a single space.
 */
export function entityNameKey(value?: string | null): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['‘’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** True when two names refer to the same thing for uniqueness purposes. */
export function isSameEntityName(a?: string | null, b?: string | null): boolean {
  const keyA = entityNameKey(a);
  return keyA.length > 0 && keyA === entityNameKey(b);
}

/**
 * The first record whose name — and, where it matters, whose place — matches.
 *
 * A facility name is only unique within its town: "St Mary Clinic" in Yei and
 * one in Rumbek are two clinics, and refusing the second would be wrong. Two
 * with the same name in the same town are one clinic entered twice.
 */
export function findByEntityName<T>(
  records: readonly T[],
  candidate: { name?: string | null; place?: string | null },
  read: (record: T) => { name?: string | null; place?: string | null },
): T | undefined {
  const nameKey = entityNameKey(candidate.name);
  if (!nameKey) return undefined;
  const placeKey = entityNameKey(candidate.place);
  return records.find(record => {
    const other = read(record);
    if (entityNameKey(other.name) !== nameKey) return false;
    return entityNameKey(other.place) === placeKey;
  });
}

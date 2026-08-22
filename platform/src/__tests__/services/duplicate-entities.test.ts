/**
 * You cannot register the same thing twice.
 *
 * Facility ids are generated (`hosp-<uuid>`) and an organization's id comes
 * from its slug, so neither registry had a key that stops a second copy of the
 * same real-world entity. The network list ended up with two "Juba Teaching
 * Hospital" rows in one town — each accumulating its own staff, wards and
 * stock — and the tenant list with two Ministries of Health whose names
 * differed only by a hyphen versus an em dash, which produce different slugs
 * and so slipped past the slug check that does exist.
 *
 * The name key is deliberately blunt: it guards a create button, where the
 * right answer to "we already have that one" is to open it, not to merge two
 * histories later.
 */

import { entityNameKey, isSameEntityName, findByEntityName } from '@/lib/entity-names';

describe('the name key folds what a reader would call the same name', () => {
  test('case, accents and punctuation do not make a new entity', () => {
    expect(entityNameKey('Juba Teaching Hospital')).toBe(entityNameKey('  juba   teaching hospital '));
    expect(entityNameKey('Hôpital Général')).toBe(entityNameKey('Hopital General'));
    expect(entityNameKey("St. Mary's Clinic")).toBe(entityNameKey('St Marys Clinic'));
  });

  test('every dash variant collapses — the case that let two ministries exist', () => {
    const hyphen = 'Ministry of Health - Republic of South Sudan';
    const emDash = 'Ministry of Health — Republic of South Sudan';
    const enDash = 'Ministry of Health – Republic of South Sudan';
    expect(isSameEntityName(hyphen, emDash)).toBe(true);
    expect(isSameEntityName(hyphen, enDash)).toBe(true);
  });

  test('genuinely different names stay different', () => {
    expect(isSameEntityName('Juba Teaching Hospital', 'Juba Military Hospital')).toBe(false);
    // An empty name matches nothing, including another empty one: "unnamed"
    // is not an identity.
    expect(isSameEntityName('', '')).toBe(false);
    expect(isSameEntityName(undefined, 'Juba')).toBe(false);
  });
});

describe('a facility is unique within its town, not globally', () => {
  const facilities = [
    { _id: 'hosp-1', name: 'Juba Teaching Hospital', town: 'Juba' },
    { _id: 'hosp-2', name: 'St Mary Clinic', town: 'Yei' },
  ];
  const read = (f: (typeof facilities)[number]) => ({ name: f.name, place: f.town });

  test('the same name in the same town is the same facility', () => {
    const hit = findByEntityName(facilities, { name: 'juba teaching hospital', place: 'JUBA' }, read);
    expect(hit?._id).toBe('hosp-1');
  });

  test('the same name in another town is a different facility', () => {
    // Two St Mary clinics in two counties are two clinics; refusing the second
    // would be wrong.
    expect(findByEntityName(facilities, { name: 'St Mary Clinic', place: 'Rumbek' }, read)).toBeUndefined();
  });

  test('a name nobody has registered is free', () => {
    expect(findByEntityName(facilities, { name: 'Wau General Hospital', place: 'Wau' }, read)).toBeUndefined();
  });
});

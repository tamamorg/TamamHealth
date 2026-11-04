/**
 * Drafts are only ever stored sealed, expire, and are cleared at sign-out.
 */
jest.mock('@/lib/org-data-cipher', () => ({
  encryptForOrg: jest.fn(async (plain: string, orgId: string) => {
    if (orgId === 'no-key') throw new Error('no key on this device');
    return `SEALED:${Buffer.from(plain).toString('base64')}`;
  }),
  decryptForOrg: jest.fn(async (value: string) => Buffer.from(value.slice(7), 'base64').toString()),
  isOrgEncrypted: (value: string) => value.startsWith('SEALED:'),
}));

import {
  DRAFT_MAX_AGE_MS, clearAllDrafts, draftStorageKey, loadDraft, purgeExpiredDrafts, saveDraft,
} from '@/lib/unsaved/draft-store';

beforeEach(() => localStorage.clear());

it('round-trips a draft without the text ever sitting in storage in clear', async () => {
  const key = await draftStorageKey('u1', '/patients/p1|popup|Record vitals|Achol Deng');
  expect(key).toMatch(/^tamam\.draft\.v1\.u1\.[0-9a-f]{32}$/);
  expect(key).not.toContain('Achol');
  expect(await saveDraft(key, 'org-a', { 'textarea:Notes': 'Fever for two days' })).toBe(true);
  expect(localStorage.getItem(key)).not.toContain('Fever');
  expect((await loadDraft(key))?.values).toEqual({ 'textarea:Notes': 'Fever for two days' });
});

it('keeps nothing when the device has no key to seal it', async () => {
  const key = await draftStorageKey('u1', 'scope');
  expect(await saveDraft(key, 'no-key', { a: 'secret' })).toBe(false);
  expect(localStorage.length).toBe(0);
});

it('drops a draft older than a day, on read and on the start-up sweep', async () => {
  const key = await draftStorageKey('u1', 'scope');
  await saveDraft(key, 'org-a', { a: 'x' });
  const later = Date.now() + DRAFT_MAX_AGE_MS + 1000;
  expect(await loadDraft(key, later)).toBeNull();
  expect(localStorage.getItem(key)).toBeNull();

  await saveDraft(key, 'org-a', { a: 'x' });
  purgeExpiredDrafts(later);
  expect(localStorage.getItem(key)).toBeNull();
});

it('sign-out clears every user\'s drafts and nothing else', async () => {
  localStorage.setItem('tamamhealth-locale', 'en');
  await saveDraft(await draftStorageKey('u1', 'a'), 'org-a', { a: 'x' });
  await saveDraft(await draftStorageKey('u2', 'b'), 'org-a', { b: 'y' });
  clearAllDrafts();
  expect(Object.keys(localStorage)).toEqual(['tamamhealth-locale']);
});

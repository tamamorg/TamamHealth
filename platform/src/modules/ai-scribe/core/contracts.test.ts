import { canUseScribe, isScribeSection, validateSuggestion } from './contracts';
const actor = { _id: 'doctor-test', orgId: 'org-test', role: 'doctor' };
const note = { orgId: 'org-test', status: 'draft', authorId: actor._id };
describe('scribe policy and output contract', () => {
  it('permits an assigned clinician’s unsigned draft', () => {
    expect(canUseScribe(actor, note)).toBe(true);
    expect(canUseScribe(actor, { ...note, authorId: 'other', assignedToId: actor._id })).toBe(true);
  });
  it.each(['signed', 'amended', 'awaiting_cosign'])('rejects %s notes', status => expect(canUseScribe(actor, { ...note, status })).toBe(false));
  it.each(['super_admin', 'government', 'receptionist'])('does not give %s an inference bypass', role => expect(canUseScribe({ ...actor, role }, note)).toBe(false));
  it('rejects other organizations and unassigned notes', () => {
    expect(canUseScribe({ ...actor, orgId: 'other' }, note)).toBe(false);
    expect(canUseScribe(actor, { ...note, authorId: 'other' })).toBe(false);
  });
  it.each(['vitals', 'medications', 'allergies', 'orders', null])('rejects derived section %s', section => expect(isScribeSection(section)).toBe(false));
  it('accepts plain narrative with exact source quotes', () => expect(validateSuggestion({ text: ' Reports cough. ', evidence: ['cough'] }, 'Reports cough')).toEqual({ text: 'Reports cough.', evidence: ['cough'] }));
  it.each([
    { text: 'Normal', evidence: ['invented'] }, { text: '', evidence: ['cough'] },
    { text: 'Cough', evidence: [] }, { text: 'Cough', evidence: ['cough'], orders: [] },
    { text: 'x'.repeat(12001), evidence: ['cough'] }, null,
  ])('rejects unsupported or malformed output %#', value => expect(() => validateSuggestion(value, 'cough')).toThrow('invalid_output'));
});

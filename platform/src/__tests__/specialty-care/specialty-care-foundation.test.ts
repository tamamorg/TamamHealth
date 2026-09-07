import { SPECIALTY_PATHWAYS, getSpecialtyPathway, validateSpecialtyEpisode } from '@/modules/specialty-care';
import type { SpecialtyCareEpisodeDoc } from '@/modules/specialty-care';

function episode(pathway: SpecialtyCareEpisodeDoc['pathway'], values: SpecialtyCareEpisodeDoc['values'] = {}): SpecialtyCareEpisodeDoc {
  return {
    _id: 'specialty-1', type: 'specialty_care_episode', pathway, status: 'in_progress',
    patientId: 'patient-1', patientName: 'Patient One', hospitalId: 'hospital-1', orgId: 'org-1',
    values, events: [], createdAt: '2026-09-07T00:00:00Z', updatedAt: '2026-09-07T00:00:00Z',
  };
}

describe('Tamam specialty-care foundation', () => {
  it('defines a distinct structured pathway for every unfinished clinical domain', () => {
    expect(SPECIALTY_PATHWAYS.map((item) => item.code)).toEqual([
      'haemodialysis', 'dental', 'theatre', 'cardiac_diagnostics', 'ophthalmology_optical',
      'mental_health', 'dermatology', 'physiotherapy', 'paediatrics', 'obstetrics_gynaecology',
    ]);
    for (const pathway of SPECIALTY_PATHWAYS) {
      expect(pathway.fields.length).toBeGreaterThanOrEqual(8);
      expect(pathway.fields.some((field) => field.requiredToComplete)).toBe(true);
      expect(new Set(pathway.fields.map((field) => field.key)).size).toBe(pathway.fields.length);
      expect(pathway.evidenceUrl).toMatch(/^https:\/\//);
    }
  });

  it('allows incomplete work to be saved but blocks it from completion', () => {
    const draft = episode('haemodialysis');
    expect(validateSpecialtyEpisode(draft)).toEqual(expect.objectContaining({ valid: true }));
    expect(validateSpecialtyEpisode({ ...draft, status: 'completed' })).toEqual(expect.objectContaining({ valid: false }));
  });

  it('requires all theatre team pauses before completion', () => {
    const required = Object.fromEntries(getSpecialtyPathway('theatre').fields
      .filter((field) => field.requiredToComplete)
      .map((field) => [field.key, field.kind === 'boolean' ? true : field.options?.[0]?.value ?? 'recorded']));
    const record = episode('theatre', required);
    expect(validateSpecialtyEpisode({ ...record, status: 'completed' }).valid).toBe(true);
    expect(validateSpecialtyEpisode({ ...record, status: 'completed', values: { ...required, teamIntroduced: false } }).errors)
      .toContain('Team introduced by name and role must be confirmed');
  });

  it('prevents image linkage without recorded photography consent', () => {
    const record = episode('dermatology', { photoConsent: 'declined', photoDocumentIds: 'pdoc-1' });
    expect(validateSpecialtyEpisode({ ...record, status: 'completed' }).errors)
      .toContain('A dermatology image reference requires recorded photography consent');
  });

  it('rejects sensitive mental-health narrative in the replicated record', () => {
    const record = episode('mental_health', { restrictedNarrative: 'must not sync' });
    expect(validateSpecialtyEpisode(record).errors)
      .toContain('Sensitive mental-health narrative cannot be stored in the replicated specialty-care record');
  });

  it('blocks finalizing a cardiac study that needs repeat acquisition', () => {
    const record = episode('cardiac_diagnostics', { acquisitionQuality: 'repeat_required' });
    expect(validateSpecialtyEpisode({ ...record, status: 'completed' }).errors)
      .toContain('A study marked repeat required cannot be completed');
  });
});

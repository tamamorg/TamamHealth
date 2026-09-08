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
  it('provides populated unique options and numeric precision across every pathway', () => {
    for (const pathway of SPECIALTY_PATHWAYS) for (const field of pathway.fields) {
      if (field.kind === 'select' || field.kind === 'multi_select') {
        expect(field.options?.length).toBeGreaterThan(0);
        expect(new Set(field.options?.map(option => option.value)).size).toBe(field.options?.length);
      }
      if (field.kind === 'number') expect(field.step).toBeDefined();
    }
  });
  it('rejects contradictory ETAT choices even in an unfinished record', () => {
    expect(validateSpecialtyEpisode(episode('paediatrics', { etatDangerSigns: ['none', 'shock'] })).errors).toContain('ETAT emergency / priority signs contains mutually exclusive choices');
  });
  it('accepts explicit not-applicable only on eligible fields', () => {
    expect(validateSpecialtyEpisode(episode('obstetrics_gynaecology', { gestationalAge: 'not_applicable' })).valid).toBe(true);
    expect(validateSpecialtyEpisode(episode('paediatrics', { weightKg: 'not_applicable' })).valid).toBe(false);
  });
  it('rejects invalid calendar dates', () => {
    expect(validateSpecialtyEpisode(episode('mental_health', { followUpDate: '2026-02-30' })).valid).toBe(false);
  });
  it('rejects incorrectly typed numbers in drafts and completed episodes', () => {
    for (const status of ['in_progress', 'completed'] as const) {
      const record = { ...episode('haemodialysis', { preWeightKg: 'heavy' }), status };
      expect(validateSpecialtyEpisode(record).errors).toContain('Pre-treatment weight has an invalid type');
    }
  });
  it('treats whitespace as missing required text', () => {
    expect(validateSpecialtyEpisode({ ...episode('dental', { chiefConcern: '   ' }), status: 'completed' }).errors).toContain('Chief concern is required');
  });
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

import {
  bomasFor,
  countiesFor,
  payamsFor,
  southSudanLocationCounts,
  states,
  tribes,
} from '@/lib/data/south-sudan-reference';

describe('South Sudan reference data', () => {
  it('carries the current OCHA hierarchy with the Abyei address supplement', () => {
    expect(states).toHaveLength(11);
    expect(states).toContain('Abyei Region');
    expect(southSudanLocationCounts).toMatchObject({
      states: 11,
      counties: 83,
      payams: 516,
    });
  });

  it('resolves each dependent location tier without leaking across parents', () => {
    expect(countiesFor('Central Equatoria')).toContain('Juba');
    expect(countiesFor('Eastern Equatoria')).not.toContain('Juba');
    expect(payamsFor('Central Equatoria', 'Juba')).toContain('Bungu');
    expect(payamsFor('Central Equatoria', 'Yei')).not.toContain('Bungu');
    expect(bomasFor('Central Equatoria', 'Juba', 'Bungu')).toContain('Kworojik');
    expect(bomasFor('Central Equatoria', 'Juba', 'Dolo')).not.toContain('Kworojik');
  });

  it('includes the nationwide gazetteer and source-backed Abyei bomas', () => {
    expect(southSudanLocationCounts.bomas).toBe(2287);
    expect(countiesFor('Abyei Region')).toEqual(expect.arrayContaining([
      'Alal (Allal)', 'Ameth-Aguok', 'Mijak', 'Rum Amer (Rumamer)', 'Abyei Municipality',
    ]));
    expect(bomasFor('Abyei Region', 'Alal (Allal)', 'Alal (Allal)')).toEqual(
      expect.arrayContaining(['Akec-nhial', 'Maker', 'Noong', 'Noong II']),
    );
    expect(bomasFor('Abyei Region', 'Abyei Municipality', 'Abyei Municipality')).toEqual(
      expect.arrayContaining(['Abyei Thony', 'Gongbial', 'Mulmul', 'Wunruok']),
    );
  });

  it('includes every coded survey community and searchable alternate names', () => {
    expect(tribes.length).toBeGreaterThanOrEqual(95);
    expect(new Set(tribes.map(option => option.value)).size).toBe(tribes.length);
    expect(tribes).toContainEqual({ value: 'Dinka', label: 'Dinka (Jieeng, Muonyjang)' });
    expect(tribes).toContainEqual({ value: 'Nuer', label: 'Nuer (Naath)' });
    expect(tribes).toContainEqual({ value: 'Shilluk', label: 'Shilluk (Chollo, Collo)' });
    expect(tribes.map(option => option.value)).toEqual(expect.arrayContaining([
      'Aja', 'Bviri', 'Dukpu', 'Kachipo', 'Mangayat', 'Nyepu', 'Vidiri', 'Yulu',
      'Other', 'Unknown', 'Prefer not to say',
    ]));
  });
});

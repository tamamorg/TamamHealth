import {
  bomasFor,
  countiesFor,
  locationLabel,
  payamsFor,
  southSudanLocations,
  southSudanLocationCounts,
  states,
  tribes,
} from '@/lib/data/south-sudan-reference';
import type { SouthSudanState } from '@/lib/data/south-sudan-locations.generated';

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

  it('keeps hierarchy names unique and generated counts honest', () => {
    const hierarchy: readonly SouthSudanState[] = southSudanLocations;
    const counties = hierarchy.flatMap(state => state.counties);
    const payams = counties.flatMap(county => county.payams);
    const bomas = payams.flatMap(payam => payam.bomas);

    expect(counties).toHaveLength(southSudanLocationCounts.counties);
    expect(payams).toHaveLength(southSudanLocationCounts.payams);
    expect(bomas).toHaveLength(southSudanLocationCounts.bomas);
    expect(payams.every(payam => payam.bomas.length > 0)).toBe(true);
    for (const state of hierarchy) {
      expect(new Set(state.counties.map(county => county.name)).size).toBe(state.counties.length);
      for (const county of state.counties) {
        expect(new Set(county.payams.map(payam => payam.name)).size).toBe(county.payams.length);
        for (const payam of county.payams) {
          expect(new Set(payam.bomas).size).toBe(payam.bomas.length);
        }
      }
    }
  });

  it('includes the nationwide gazetteer and source-backed supplements', () => {
    expect(southSudanLocationCounts.bomas).toBe(2777);
    expect(bomasFor('Jonglei', 'Akobo', 'Alali')).toEqual([
      'Abuk', 'Alali', 'Aparawanga', 'Ojoky',
    ]);
    expect(bomasFor('Unity', 'Abiemnhom', 'Manjonga')).toEqual(['Lorpiny']);
    expect(bomasFor('Unity', 'Abiemnhom', 'Panyang 2')).toEqual(['Awila']);
    expect(bomasFor('Unity', 'Mayom', 'Wangbuor I')).toEqual(['Madul']);
    expect(countiesFor('Abyei Region')).toEqual(expect.arrayContaining([
      'Alal', 'Ameth-Aguok', 'Mijak', 'Rum Amer', 'Abyei Municipality',
    ]));
    expect(payamsFor('Abyei Region', 'Alal')).toContain('Allal');
    expect(bomasFor('Abyei Region', 'Alal', 'Allal')).toEqual(
      expect.arrayContaining(['Akec-nhial', 'Maker', 'Noong', 'Noong II']),
    );
    expect(bomasFor('Abyei Region', 'Abyei Municipality', 'Abyei Town')).toEqual(
      expect.arrayContaining(['Abyei Thony', 'Gongbial', 'Mulmul', 'Wunruok']),
    );
    expect(locationLabel('Alal')).toBe('Alal (Allal)');
    expect(locationLabel('Todac')).toBe('Todac (Tordaj)');
  });

  it('includes every coded survey community and searchable alternate names', () => {
    expect(tribes).toHaveLength(97);
    expect(new Set(tribes.map(option => option.value)).size).toBe(tribes.length);
    expect(new Set(tribes.map(option => option.label)).size).toBe(tribes.length);
    expect(tribes).toContainEqual({ value: 'Dinka', label: 'Dinka (Jieeng, Muonyjang)' });
    expect(tribes).toContainEqual({ value: 'Nuer', label: 'Nuer (Naath)' });
    expect(tribes).toContainEqual({ value: 'Shilluk', label: 'Shilluk (Chollo, Collo)' });
    expect(tribes.map(option => option.value)).toEqual(expect.arrayContaining([
      'Aja', 'Bviri', 'Dukpu', 'Kachipo', 'Mangayat', 'Nyepu', 'Vidiri', 'Yulu',
      'Other', 'Unknown', 'Prefer not to say',
    ]));
  });
});

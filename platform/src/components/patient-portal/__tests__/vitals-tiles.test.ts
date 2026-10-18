import { buildVitalTiles, ageInYears } from '../vitals-tiles';

const defs = [
  { key: 'temperature', label: 'Temp', unit: '°C' },
  { key: 'weight', label: 'Weight', unit: 'kg' },
  { key: 'bloodPressure', label: 'BP', unit: 'mmHg' },
  { key: 'oxygenSaturation', label: 'SpO2', unit: '%' },
];

describe('vitals-tiles', () => {
  it('flags a fever and an ordinary weight differently, with deltas', () => {
    const tiles = buildVitalTiles({ temperature: 40, weight: 70, oxygenSaturation: 100 }, { temperature: 37, weight: 70 }, defs, 35);
    const t = Object.fromEntries(tiles.map(x => [x.key, x]));
    expect(t.temperature.tone).not.toBe('ok');
    expect(t.temperature.delta).toEqual({ dir: 'up', amount: '3' });
    // Weight is never assessed: no "In normal range" claim for it.
    expect(t.weight.tone).toBe('neutral');
    expect(t.weight.delta?.dir).toBe('same');
    expect(t.oxygenSaturation.tone).toBe('ok');
    expect(t.bloodPressure).toBeUndefined();
  });

  it('skips missing vitals and never gives BP a numeric delta', () => {
    const tiles = buildVitalTiles({ bloodPressure: '120/80' }, { bloodPressure: '110/70' }, defs, 35);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].delta).toBeUndefined();
    expect(tiles[0].tone).toBe('ok');
  });

  it('drops a stored null instead of rendering the word "null"', () => {
    const tiles = buildVitalTiles({ temperature: null as unknown as undefined, weight: 70 }, {}, defs, 35);
    expect(tiles.map(t => t.key)).toEqual(['weight']);
  });

  it('makes no range claim for an assessed vital it could not read', () => {
    const tiles = buildVitalTiles({ temperature: 'n/a' }, {}, defs, 35);
    expect(tiles[0].tone).toBe('neutral');
  });

  it('computes age on the local calendar', () => {
    expect(ageInYears('2000-10-18', new Date(2026, 9, 17))).toBe(25);
    expect(ageInYears('2000-10-17', new Date(2026, 9, 17))).toBe(26);
    expect(ageInYears(undefined)).toBeUndefined();
  });
});

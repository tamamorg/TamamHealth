// ============================================
// South Sudan reference data — real administrative and demographic lists,
// NOT demo data.
//
// Kept in a leaf module that imports nothing: these lists used to live in
// data/mock.ts, whose top level generates the seeded demo roster, so pulling
// one constant executed the whole generator and defeated tree-shaking. Nothing
// may be added here that imports from mock.ts or draws from its PRNG.
// ============================================

import { southSudanLocations, southSudanLocationCounts } from './south-sudan-locations.generated';

export { southSudanLocations, southSudanLocationCounts };

export const statesAndCounties: Record<string, string[]> = Object.fromEntries(
  southSudanLocations.map(state => [state.name, state.counties.map(county => county.name)]),
);

export const states = Object.keys(statesAndCounties);

/** Canonical values stay clean; source spelling variants remain searchable. */
const locationAliases: Readonly<Record<string, string>> = {
  Alal: 'Allal',
  Allal: 'Alal',
  'Rum Amer': 'Rumamer',
  Rumamer: 'Rum Amer',
  'Abyei Town': 'Abyei',
  Todac: 'Tordaj',
  'Todac II': 'Tordaj II',
  'Taj-allei': 'Tajalei',
};

export function locationLabel(name: string): string {
  const alias = locationAliases[name];
  return alias ? `${name} (${alias})` : name;
}

export function countiesFor(stateName: string): string[] {
  return statesAndCounties[stateName] || [];
}

export function payamsFor(stateName: string, countyName: string): string[] {
  return southSudanLocations
    .find(state => state.name === stateName)?.counties
    .find(county => county.name === countyName)?.payams
    .map(payam => payam.name) || [];
}

export function bomasFor(stateName: string, countyName: string, payamName: string): string[] {
  return southSudanLocations
    .find(state => state.name === stateName)?.counties
    .find(county => county.name === countyName)?.payams
    .find(payam => payam.name === payamName)?.bomas.slice() || [];
}

export interface EthnicCommunityOption {
  /** Stable stored value; labels include alternate names to make them searchable. */
  value: string;
  label: string;
}

/**
 * South Sudan NBS / World Bank High Frequency Survey coded ethnic-community
 * list. Duplicate survey spellings are combined as aliases rather than shown
 * as two identities. The field stays optional and includes non-coercive
 * response choices.
 */
export const tribes: readonly EthnicCommunityOption[] = [
  { value: 'Acholi', label: 'Acholi' },
  { value: 'Aja', label: 'Aja' },
  { value: 'Anuak', label: 'Anuak (Anyuak)' },
  { value: 'Atuot', label: 'Atuot (Atwot)' },
  { value: 'Avukaya', label: 'Avukaya' },
  { value: 'Zande', label: 'Zande (Azande)' },
  { value: 'Bai', label: 'Bai' },
  { value: 'Baka', label: 'Baka' },
  { value: 'Balanda Bor', label: 'Balanda Bor' },
  { value: 'Balanda Viri', label: 'Balanda Viri' },
  { value: 'Bari', label: 'Bari' },
  { value: 'Binga', label: 'Binga' },
  { value: 'Bongo', label: 'Bongo' },
  { value: 'Boya', label: 'Boya' },
  { value: 'Burun', label: 'Burun' },
  { value: 'Bviri', label: 'Bviri' },
  { value: 'Didinga', label: 'Didinga' },
  { value: 'Dinka', label: 'Dinka (Jieeng, Muonyjang)' },
  { value: 'Dongotono', label: 'Dongotono (Dongotona)' },
  { value: 'Donyiro', label: 'Donyiro' },
  { value: 'Dukpu', label: 'Dukpu' },
  { value: 'Feroghe', label: 'Feroghe' },
  { value: 'Fertit', label: 'Fertit' },
  { value: 'Gollo', label: 'Gollo' },
  { value: 'Ifoto', label: 'Ifoto' },
  { value: 'Imatong', label: 'Imatong' },
  { value: 'Indri', label: 'Indri' },
  { value: 'Jiye', label: 'Jiye' },
  { value: 'Jur Beli', label: 'Jur Beli (Jurbiel, Bel)' },
  { value: 'Jur Manager', label: 'Jur Manager' },
  { value: 'Jur Modo', label: 'Jur Modo' },
  { value: 'Jurchol', label: 'Jurchol (Jo-Luo, Jur Chol)' },
  { value: 'Kachipo', label: 'Kachipo (Kichepo)' },
  { value: 'Kakowa', label: 'Kakowa' },
  { value: 'Kakwa', label: 'Kakwa' },
  { value: 'Kaliko', label: 'Kaliko' },
  { value: 'Kara', label: 'Kara' },
  { value: 'Ketebo', label: 'Ketebo' },
  { value: 'Kresh', label: 'Kresh' },
  { value: 'Kuku', label: 'Kuku' },
  { value: 'Lango', label: 'Lango' },
  { value: 'Larim', label: 'Larim' },
  { value: 'Laro', label: 'Laro' },
  { value: 'Logir', label: 'Logir' },
  { value: 'Logo', label: 'Logo' },
  { value: 'Lokoja', label: 'Lokoja' },
  { value: 'Lokoya', label: 'Lokoya' },
  { value: 'Lopid', label: 'Lopid' },
  { value: 'Lopit', label: 'Lopit' },
  { value: 'Lotuko', label: 'Lotuko (Lotuka)' },
  { value: 'Lugbwara', label: 'Lugbwara' },
  { value: 'Lulubo', label: 'Lulubo' },
  { value: 'Luo', label: 'Luo' },
  { value: 'Maban', label: 'Maban' },
  { value: 'Madi', label: 'Madi' },
  { value: 'Makaraka', label: 'Makaraka' },
  { value: 'Mangaya', label: 'Mangaya' },
  { value: 'Mangayat', label: 'Mangayat' },
  { value: 'Moro Nuba', label: 'Moro Nuba' },
  { value: 'Moru', label: 'Moru (Moro)' },
  { value: 'Mundari', label: 'Mundari (Mandari)' },
  { value: 'Mundu', label: 'Mundu' },
  { value: 'Murle', label: 'Murle' },
  { value: 'Narim', label: 'Narim (Longarim)' },
  { value: 'Ndogo', label: 'Ndogo' },
  { value: 'Ngulgule', label: 'Ngulgule' },
  { value: 'Nuer', label: 'Nuer (Naath)' },
  { value: 'Nyamusa', label: 'Nyamusa' },
  { value: 'Nyangatom', label: 'Nyangatom' },
  { value: 'Nyangwara', label: 'Nyangwara' },
  { value: 'Nyepu', label: 'Nyepu' },
  { value: 'Olubo', label: 'Olubo' },
  { value: 'Pari', label: 'Pari (Paeri)' },
  { value: 'Pojulu', label: 'Pojulu' },
  { value: 'Rek', label: 'Rek' },
  { value: 'Sebei', label: 'Sebei' },
  { value: 'Sere', label: 'Sere' },
  { value: 'Shatt', label: 'Shatt' },
  { value: 'Shilluk', label: 'Shilluk (Chollo, Collo)' },
  { value: 'Shita', label: 'Shita' },
  { value: 'Shwai', label: 'Shwai' },
  { value: 'Tacho', label: 'Tacho' },
  { value: 'Tenet', label: 'Tenet' },
  { value: 'Thuri', label: 'Thuri' },
  { value: 'Tid', label: 'Tid (Teuth)' },
  { value: 'Toposa', label: 'Toposa' },
  { value: 'Uduk', label: 'Uduk' },
  { value: 'Vidiri', label: 'Vidiri' },
  { value: 'Welega', label: 'Welega (Wallega)' },
  { value: 'Woro', label: 'Woro' },
  { value: 'Yulu', label: 'Yulu' },
  { value: 'Arabic', label: 'Arabic' },
  { value: 'Falata', label: 'Falata' },
  { value: 'Nuba', label: 'Nuba' },
  { value: 'Other', label: 'Other' },
  { value: 'Unknown', label: "Don't know" },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
];

export const languages = [
  'English', 'Arabic (Juba)', 'Dinka', 'Nuer', 'Bari', 'Zande', 'Shilluk',
  'Mundari', 'Toposa', 'Acholi', 'Madi', 'Lotuko', 'Murle', 'Didinga', 'Other'
];

export const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'];

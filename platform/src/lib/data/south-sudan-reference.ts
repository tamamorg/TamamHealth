// ============================================
// South Sudan reference data — real administrative and demographic lists
// (states and counties, tribes, languages, blood types), NOT demo data.
//
// Kept in a leaf module that imports nothing: these lists used to live in
// data/mock.ts, whose top level generates the seeded demo roster, so pulling
// one constant executed the whole generator and defeated tree-shaking. Nothing
// may be added here that imports from mock.ts or draws from its PRNG.
// ============================================

export const statesAndCounties: Record<string, string[]> = {
  'Central Equatoria': ['Juba', 'Kajo-keji', 'Lainya', 'Morobo', 'Terekeka', 'Yei'],
  'Eastern Equatoria': ['Torit', 'Budi', 'Ikotos', 'Kapoeta East', 'Kapoeta North', 'Kapoeta South', 'Lafon', 'Magwi'],
  'Jonglei': ['Bor South', 'Akobo', 'Ayod', 'Duk', 'Fangak', 'Nyirol', 'Pibor', 'Pochalla', 'Twic East', 'Uror'],
  'Lakes': ['Rumbek Centre', 'Rumbek East', 'Rumbek North', 'Awerial', 'Cueibet', 'Wulu', 'Yirol East', 'Yirol West'],
  'Northern Bahr el Ghazal': ['Aweil Centre', 'Aweil East', 'Aweil North', 'Aweil South', 'Aweil West'],
  'Unity': ['Rubkona', 'Abiemnhom', 'Guit', 'Koch', 'Leer', 'Mayendit', 'Mayom', 'Panyijiar', 'Pariang'],
  'Upper Nile': ['Malakal', 'Baliet', 'Fashoda', 'Longochuk', 'Maban', 'Manyo', 'Melut', 'Panyikang', 'Renk', 'Ulang'],
  'Warrap': ['Kuajok', 'Gogrial East', 'Gogrial West', 'Tonj East', 'Tonj North', 'Tonj South', 'Twic'],
  'Western Bahr el Ghazal': ['Wau', 'Jur River', 'Raja'],
  'Western Equatoria': ['Yambio', 'Ezo', 'Ibba', 'Maridi', 'Mundri East', 'Mundri West', 'Mvolo', 'Nagero', 'Nzara', 'Tambura'],
};

// Key order is load-bearing: the demo-roster generator draws a state by index
// from this array, and SEED_VERSION (lib/db.ts) locks that draw.
export const states = Object.keys(statesAndCounties);

export const tribes = [
  'Dinka', 'Nuer', 'Shilluk', 'Bari', 'Zande', 'Mundari', 'Madi', 'Acholi',
  'Toposa', 'Didinga', 'Murle', 'Anuak', 'Lotuko', 'Kakwa', 'Pojulu', 'Kuku',
  'Mandari', 'Balanda', 'Fertit', 'Luo', 'Moru', 'Avukaya', 'Logo', 'Other'
];

export const languages = [
  'English', 'Arabic (Juba)', 'Dinka', 'Nuer', 'Bari', 'Zande', 'Shilluk',
  'Mundari', 'Toposa', 'Acholi', 'Madi', 'Lotuko', 'Murle', 'Didinga', 'Other'
];

export const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'];

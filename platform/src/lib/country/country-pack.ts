/**
 * What differs from one country's deployment to the next. One deployment
 * serves one country, chosen with NEXT_PUBLIC_ORG_COUNTRY_CODE; South Sudan is
 * the default and the only pack with its own location lists so far.
 *
 * Add a country by adding a pack here. Until then, setting the code alone gives
 * a working generic deployment: free-text addresses, phone numbers entered with
 * their country code, and the time zone and currency from the env vars below.
 *
 * Edge-safe and free of browser APIs: the server, the proxy and the browser all
 * read it. Each env var is named in full because Next inlines NEXT_PUBLIC_*
 * at build time only for a literal `process.env.NAME`.
 */

export interface CountryPack {
  /** ISO 3166-1 alpha-2. */
  code: string;
  /** Dialling code without the plus; empty means a number must carry its own. */
  dialCode: string;
  /** A local number with the trunk zero and the country code removed. */
  nationalNumber: RegExp;
  timeZone: string;
  /** ISO 4217. */
  currency: string;
  /** Registration picks locations from lists rather than typing them. */
  addressLists: boolean;
  /** The ethnic-group question. Sensitive or unlawful to ask in some countries. */
  asksTribe: boolean;
  /** Household geocode built from a community code (the boma code). */
  usesGeocode: boolean;
  /** Offered first in the language picker, in the country's own order. */
  languages: readonly string[];
}

const GENERIC: Omit<CountryPack, 'code'> = {
  dialCode: '',
  nationalNumber: /^\d{6,13}$/,
  timeZone: 'UTC',
  currency: 'USD',
  addressLists: false,
  asksTribe: false,
  usesGeocode: false,
  languages: [],
};

const PACKS: Readonly<Record<string, CountryPack>> = {
  SS: {
    code: 'SS',
    dialCode: '211',
    // Mobile numbers: 9 digits beginning with 9.
    nationalNumber: /^9\d{8}$/,
    timeZone: 'Africa/Juba',
    currency: 'SSP',
    addressLists: true,
    asksTribe: true,
    usesGeocode: true,
    languages: [
      'English', 'Arabic (Juba)', 'Dinka', 'Nuer', 'Bari', 'Zande', 'Shilluk',
      'Mundari', 'Toposa', 'Acholi', 'Madi', 'Lotuko', 'Murle', 'Didinga',
    ],
  },
};

/** The country this deployment serves. */
export function activeCountry(): CountryPack {
  const code = (process.env.NEXT_PUBLIC_ORG_COUNTRY_CODE || 'SS').trim().toUpperCase();
  const pack = PACKS[code] ?? { ...GENERIC, code };
  return {
    ...pack,
    dialCode: process.env.NEXT_PUBLIC_ORG_DIAL_CODE || pack.dialCode,
    timeZone: process.env.NEXT_PUBLIC_ORG_TIMEZONE || pack.timeZone,
    currency: process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || pack.currency,
  };
}

/** The currency for an amount that does not carry its own. */
export function defaultCurrency(): string {
  return activeCountry().currency;
}

/** The currencies offered wherever one is picked: this country's first. */
export function offeredCurrencies(): string[] {
  return [...new Set([defaultCurrency(), 'USD', 'KES', 'UGX', 'SSP'])];
}

/** A patient's address is on this country's lists, not a foreign one. */
export function usesAddressLists(patientCountry?: string): boolean {
  const pack = activeCountry();
  return pack.addressLists && (!patientCountry || patientCountry === pack.code);
}

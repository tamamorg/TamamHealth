/**
 * Every country and language a patient may come from. The codes are the ISO
 * lists; the names come from the runtime's Intl data, so they follow the
 * reader's language with no translation table to maintain.
 */

const COUNTRY_CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ '
  + 'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR '
  + 'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP '
  + 'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ '
  + 'NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW '
  + 'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ '
  + 'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

const LANGUAGE_CODES = (
  'aa ab af ak am ar as ay az ba be bg bm bn bo br bs ca ce ch cs cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy '
  + 'ga gd gl gn gu ha he hi hr ht hu hy id ig is it iu ja jv ka kg ki kk kl km kn ko kr ks ku kv kw ky la lb lg ln lo lt lu lv '
  + 'mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn nr nv ny oc om or os pa pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw '
  + 'ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu'
).split(' ');

function displayName(type: 'region' | 'language', code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type, fallback: 'code' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export const countryName = (code: string | undefined, locale = 'en'): string =>
  (code ? displayName('region', code, locale) : '');

/** Sorted by name in the reader's language. */
export function worldCountries(locale = 'en'): Array<{ code: string; name: string }> {
  return COUNTRY_CODES
    .map(code => ({ code, name: displayName('region', code, locale) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

/** English names: `primaryLanguage` is stored as the name, not a code. */
export function worldLanguages(): string[] {
  return LANGUAGE_CODES.map(code => displayName('language', code, 'en'))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

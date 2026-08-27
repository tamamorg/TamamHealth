#!/usr/bin/env node

/**
 * Build the compact patient-form hierarchy from the two OCHA/HDX workbooks.
 *
 * Usage:
 *   node scripts/generate-south-sudan-locations.mjs \
 *     /path/to/ssd_admin_boundaries.xlsx \
 *     /path/to/ssd_populatedplaces_tabulardata.xlsx \
 *     /path/to/ssd_admin_boundaries.geojson.zip
 *
 * The current COD-AB workbook is authoritative for states, counties and
 * payams. The older OCHA/NBS populated-place gazetteer is the only nationwide
 * public workbook we found that still carries the Admin-4 (boma) name. Bomas
 * are spatially joined to the current payam polygons. This avoids guessing
 * from older parent spellings. Abyei is supplemented from its government's
 * current administrative pages and IOM's 2023 Village Assessment Survey,
 * because COD-AB represents the whole area as one aggregate payam with no
 * Admin-4 names.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [adminWorkbook, settlementWorkbook, boundaryArchive] = process.argv.slice(2);
if (!adminWorkbook || !settlementWorkbook || !boundaryArchive) {
  console.error('Expected COD-AB, populated-place workbook, and COD-AB GeoJSON paths.');
  process.exit(1);
}

const OUTPUT = resolve('src/lib/data/south-sudan-locations.generated.ts');

function xmlFrom(workbook, entry) {
  return execFileSync('unzip', ['-p', workbook, entry], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function decodeXml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"');
}

function workbookRows(workbook, sheet) {
  const shared = [...xmlFrom(workbook, 'xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(match => decodeXml(
      [...match[1].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)]
        .map(text => text[1])
        .join(''),
    ));
  const rows = [...xmlFrom(workbook, sheet).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)]
    .map(row => Object.fromEntries(
      [...row[1].matchAll(/<c[^>]*r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)]
        .map(cell => {
          const raw = cell[3].match(/<v>(.*?)<\/v>/)?.[1] || '';
          return [cell[1], cell[2].includes('t="s"') ? shared[Number(raw)] : raw];
        }),
    ));
  return rows.slice(1);
}

const clean = value => (value || '').trim().replace(/\s+/g, ' ');
const key = value => clean(value).toLocaleLowerCase('en').replace(/[^a-z0-9]/g, '');
const stateAlias = value => clean(value) === 'Northern Bahr Ghazal'
  ? 'Northern Bahr el Ghazal'
  : clean(value);
const displayName = value => {
  const name = clean(value).replace(/^UP_/i, '').replaceAll('_', ' ');
  return /[A-Z]/.test(name) && name === name.toUpperCase()
    ? name.toLocaleLowerCase('en').replace(/\b\p{L}/gu, letter => letter.toLocaleUpperCase('en'))
    : name;
};
const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonContains(polygon, x, y) {
  return ringContains(polygon[0], x, y)
    && !polygon.slice(1).some(hole => ringContains(hole, x, y));
}

function geometryContains(geometry, x, y) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(polygon => polygonContains(polygon, x, y));
}

const adminRows = workbookRows(adminWorkbook, 'xl/worksheets/sheet4.xml');
const settlementRows = workbookRows(settlementWorkbook, 'xl/worksheets/sheet1.xml');
const payamBoundaries = JSON.parse(xmlFrom(boundaryArchive, 'ssd_admin3.geojson')).features.map(feature => {
  const points = feature.geometry.type === 'Polygon'
    ? feature.geometry.coordinates.flat(1)
    : feature.geometry.coordinates.flat(2);
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  return {
    pcode: feature.properties.adm3_pcode,
    geometry: feature.geometry,
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  };
});

const states = new Map();
for (const row of adminRows) {
  const stateName = displayName(row.K);
  const countyName = displayName(row.F);
  const payamName = displayName(row.A);
  if (!stateName || !countyName || !payamName) continue;
  const state = states.get(key(stateName)) || {
    name: stateName,
    code: clean(row.O),
    counties: new Map(),
  };
  states.set(key(stateName), state);
  const county = state.counties.get(key(countyName)) || {
    name: countyName,
    code: clean(row.J),
    payams: new Map(),
  };
  state.counties.set(key(countyName), county);
  if (!county.payams.has(key(payamName))) {
    county.payams.set(key(payamName), {
      name: payamName,
      code: clean(row.E),
      bomas: new Map(),
    });
  }
}

const payamsByCode = new Map();
for (const state of states.values()) {
  for (const county of state.counties.values()) {
    for (const payam of county.payams.values()) payamsByCode.set(payam.code, payam);
  }
}

// A boma has multiple settlement points. Assign the boma to the current payam
// containing the majority of those points, which is resilient to one bad GPS
// row near a boundary.
const bomaVotes = new Map();
const settlementNamesByPayam = new Map();
for (const row of settlementRows) {
  const bomaName = displayName(row.H);
  const settlementName = displayName(row.A);
  const x = Number(row.W);
  const y = Number(row.X);
  if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
  const boundary = payamBoundaries.find(candidate => {
    const [minX, minY, maxX, maxY] = candidate.bbox;
    return x >= minX && x <= maxX && y >= minY && y <= maxY
      && geometryContains(candidate.geometry, x, y);
  });
  if (!boundary) continue;
  if (settlementName) {
    const names = settlementNamesByPayam.get(boundary.pcode) || new Map();
    if (!names.has(key(settlementName))) names.set(key(settlementName), settlementName);
    settlementNamesByPayam.set(boundary.pcode, names);
  }
  if (!bomaName) continue;
  const oldPath = [stateAlias(row.N), row.L, row.J, bomaName].map(key).join('|');
  const boma = bomaVotes.get(oldPath) || { name: bomaName, votes: new Map() };
  boma.votes.set(boundary.pcode, (boma.votes.get(boundary.pcode) || 0) + 1);
  bomaVotes.set(oldPath, boma);
}

let rejectedBomaPaths = 0;
for (const boma of bomaVotes.values()) {
  const [payamCode] = [...boma.votes.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  const payam = payamsByCode.get(payamCode);
  if (!payam) {
    rejectedBomaPaths += 1;
    continue;
  }
  if (!payam.bomas.has(key(boma.name))) payam.bomas.set(key(boma.name), boma.name);
}

// Some current payams have no Admin-4 value in the older gazetteer. The
// product calls the lowest address tier "Boma / Village", so keep those
// dropdowns usable with spatially verified populated-place names, but only
// where no source boma exists; never mix settlements into a real boma list.
let settlementFallbackPayams = 0;
let settlementFallbackOptions = 0;
for (const [payamCode, payam] of payamsByCode) {
  if (payam.bomas.size > 0) continue;
  const settlements = settlementNamesByPayam.get(payamCode);
  if (!settlements?.size) continue;
  payam.bomas = settlements;
  settlementFallbackPayams += 1;
  settlementFallbackOptions += settlements.size;
}

// Four current COD payam polygons contain neither a usable Admin-4 row nor a
// populated-place point in the older gazetteer. Fill only those holes from the
// National Bureau of Statistics' 2008 boma population tables. The COD spelling
// "Manjonga" corresponds to NBS "Manjoga"; COD "Panyang 2" corresponds to
// the Panyang/Awila unit shown by both NBS and UNICEF's county social map.
// Sources:
//   https://nbs.gov.ss/wp-content/uploads/2021/05/Boma-populations-Southern-Sudan.pdf
//   https://www.unicef.org/southsudan/media/751/file/Abiemnhom-County-social-map.pdf
const verifiedBomaSupplements = [
  { state: 'Jonglei', county: 'Akobo', payam: 'Alali', bomas: ['Abuk', 'Alali', 'Aparawanga', 'Ojoky'] },
  { state: 'Unity', county: 'Abiemnhom', payam: 'Manjonga', bomas: ['Lorpiny'] },
  { state: 'Unity', county: 'Abiemnhom', payam: 'Panyang 2', bomas: ['Awila'] },
  { state: 'Unity', county: 'Mayom', payam: 'Wangbuor I', bomas: ['Madul'] },
];
for (const supplement of verifiedBomaSupplements) {
  const payam = states.get(key(supplement.state))
    ?.counties.get(key(supplement.county))
    ?.payams.get(key(supplement.payam));
  if (!payam || payam.bomas.size > 0) continue;
  payam.bomas = new Map(supplement.bomas.map(boma => [key(boma), boma]));
}

// COD-AB intentionally aggregates disputed Abyei into one county and one
// payam. That is useful for boundary exchange, but not for a patient address.
// The Abyei government currently identifies four counties plus Abyei
// Municipality, and its health directory supplies the bomas below. IOM's 2023
// VAS supplies the additional assessed/inaccessible bomas and spelling aliases.
// Sources:
//   https://abyei.gov.ss/about-abyei/
//   https://abyei.gov.ss/ministry-of-health/
//   https://dtm.iom.int/reports/south-sudan-abyei-administrative-area-village-assessment-survey-28-february-27-march-2023
const abyei = states.get(key('Abyei Region'));
if (abyei) {
  const abyeiUnits = [
    { county: 'Alal', payam: 'Allal', code: 'SS00-ALAL', bomas: ['Akec-nhial', 'Awolnhom', 'Maker', 'Noong', 'Noong II'] },
    { county: 'Ameth-Aguok', payam: 'Ameth-Aguok', code: 'SS00-AMETH', bomas: ['Dungop', 'Todac', 'Todac II'] },
    { county: 'Mijak', payam: 'Mijak', code: 'SS00-MIJAK', bomas: ['Leu', 'Taj-allei'] },
    { county: 'Rum Amer', payam: 'Rumamer', code: 'SS00-RUMAMER', bomas: ['Mabok', 'Marial'] },
    { county: 'Abyei Municipality', payam: 'Abyei Town', code: 'SS00-ABYEI', bomas: ['Abyei Thony', 'Gongbial', 'Mulmul', 'Wunruok'] },
  ];
  abyei.counties = new Map(abyeiUnits.map(unit => [key(unit.county), {
    name: unit.county,
    code: unit.code,
    payams: new Map([[key(unit.payam), {
      name: unit.payam,
      code: `${unit.code}-P`,
      bomas: new Map(unit.bomas.map(boma => [key(boma), boma])),
    }]]),
  }]));
}

// Preserve the COD workbook's established state order for stable UI ordering.
const hierarchy = [...states.values()].map(state => ({
  name: state.name,
  code: state.code,
  counties: [...state.counties.values()].sort(byName).map(county => ({
    name: county.name,
    code: county.code,
    payams: [...county.payams.values()].sort(byName).map(payam => ({
      name: payam.name,
      ...(payam.code ? { code: payam.code } : {}),
      bomas: [...payam.bomas.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
    })),
  })),
}));

const counts = {
  states: hierarchy.length,
  counties: hierarchy.reduce((total, state) => total + state.counties.length, 0),
  payams: hierarchy.reduce((total, state) => total + state.counties.reduce(
    (countyTotal, county) => countyTotal + county.payams.length, 0,
  ), 0),
  bomas: hierarchy.reduce((total, state) => total + state.counties.reduce(
    (countyTotal, county) => countyTotal + county.payams.reduce(
      (payamTotal, payam) => payamTotal + payam.bomas.length, 0,
    ), 0,
  ), 0),
};

const output = `// GENERATED by scripts/generate-south-sudan-locations.mjs. Do not edit by hand.\n` +
`// Parent hierarchy: OCHA COD-AB v03, reviewed 2024-10-09.\n` +
`// Boma names: OCHA/NBS gazetteer; Abyei government and IOM VAS supplement.\n\n` +
`export interface SouthSudanPayam {\n  readonly name: string;\n  readonly code?: string;\n  readonly bomas: readonly string[];\n}\n\n` +
`export interface SouthSudanCounty {\n  readonly name: string;\n  readonly code: string;\n  readonly payams: readonly SouthSudanPayam[];\n}\n\n` +
`export interface SouthSudanState {\n  readonly name: string;\n  readonly code: string;\n  readonly counties: readonly SouthSudanCounty[];\n}\n\n` +
`export const southSudanLocations = ${JSON.stringify(hierarchy, null, 2)} as const satisfies readonly SouthSudanState[];\n\n` +
`export const southSudanLocationCounts = ${JSON.stringify(counts)} as const;\n`;

writeFileSync(OUTPUT, output);
console.log(`Wrote ${OUTPUT}`);
console.log({
  ...counts,
  rejectedBomaRows: rejectedBomaPaths,
  settlementFallbackPayams,
  settlementFallbackOptions,
});

/**
 * scripts/remap-icd11-codes.mjs corrects codes saved from the old, wrong
 * diagnosis list. It must remap a code only when the name beside it is the
 * old list's title (BA00 was "Ischaemic heart disease" there but is, and was
 * already used as, essential hypertension elsewhere), and every code it writes
 * must be one the corrected list offers.
 */
import { execFileSync } from 'child_process';
import path from 'path';
import { COMMON_ICD11_CODES } from '@/lib/icd11-codes';

const script = path.resolve(__dirname, '../../../scripts/remap-icd11-codes.mjs');

function run(body: string): unknown {
  const program = `
    const m = await import(${JSON.stringify('file://' + script)});
    const identity = { open: async v => v, seal: async v => v };
    ${body}
  `;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', program]).toString());
}

test('every corrected code is offered by the current diagnosis list', () => {
  const pairs = run('process.stdout.write(JSON.stringify(m.OLD_ICD11_PAIRS));') as [string, string, string][];
  const offered = new Set(COMMON_ICD11_CODES.map(c => c.code));
  expect(pairs.length).toBeGreaterThan(50);
  expect(pairs.filter(([, , next]) => !offered.has(next))).toEqual([]);
});

test('remaps a code only when the saved name is the old title', () => {
  const out = run(`
    const problem = { type: 'problem', name: 'Malaria due to Plasmodium falciparum', icd11Code: '1A40' };
    const correct = { type: 'problem', name: 'Essential hypertension', icd11Code: 'BA00' };
    const oldIhd = { type: 'problem', name: 'Ischaemic heart disease', icd11Code: 'BA00' };
    const handCoded = { type: 'problem', name: 'Fever, query cause', icd11Code: '1A40' };
    const seedText = { type: 'admission', admittingDiagnosis: 'Severe malaria', icd11Code: '1A40' };
    const note = { type: 'clinical_note', sections: [{ diagnoses: [{ name: 'Epilepsy', icd11Code: '6A20' }] }] };
    const death = { type: 'death', immediateCause: 'Cerebrovascular diseases (Stroke)', immediateICD11: 'BA01',
      underlyingCause: 'Hypertensive heart disease', underlyingICD11: 'BA80' };
    const results = [];
    for (const d of [problem, correct, oldIhd, handCoded, note, death, seedText]) results.push(await m.remapDocument(d, identity));
    process.stdout.write(JSON.stringify({ problem, correct, oldIhd, handCoded, note, death, seedText, results }));
  `) as Record<string, any>;
  expect(out.problem.icd11Code).toBe('1F40');
  expect(out.correct.icd11Code).toBe('BA00');
  // Right as it stands: not changed, and not sent for review either.
  expect(out.results[1]).toEqual({ changed: 0, unmatched: 0 });
  expect(out.oldIhd.icd11Code).toBe('BA6Z');
  // Not the old title: left for a person, and counted.
  expect(out.handCoded.icd11Code).toBe('1A40');
  expect(out.results[3]).toEqual({ changed: 0, unmatched: 1 });
  expect(out.note.sections[0].diagnoses[0].icd11Code).toBe('8A6Z');
  expect(out.death.immediateICD11).toBe('8B20');
  expect(out.death.underlyingICD11).toBe('BA01');
  // Unambiguous free text from before the fix is corrected too.
  expect(out.seedText.icd11Code).toBe('1F40');
});

test('a corrected document is not corrected twice', () => {
  const out = run(`
    const doc = { type: 'problem', name: 'Hypertension, essential', icd11Code: 'BA02' };
    const first = await m.remapDocument(doc, identity);
    const second = await m.remapDocument(doc, identity);
    process.stdout.write(JSON.stringify({ doc, first, second }));
  `) as Record<string, any>;
  expect(out.doc.icd11Code).toBe('BA00');
  expect(out.first.changed).toBe(1);
  expect(out.second).toEqual({ changed: 0, unmatched: 0 });
});

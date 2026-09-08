/**
 * Issue #85 lab acceptance criteria: "Results entry & publishing:
 * manual/automated entry" and "edge cases (… invalid sample IDs) give clear
 * errors."
 *
 * `instrument-intake-service.ts` is the automated-entry path — it parses raw
 * LIS-2A (ASTM E1394) and HL7 ORU^R01 payloads off bench analyzers into
 * structured readings, then matches each reading to the lab order it belongs
 * to by accession number. It had NO test coverage at all before this file,
 * despite being exactly the "automated entry" half of the acceptance
 * criteria and the one place an invalid/unknown sample ID has to fail
 * loudly rather than silently attach a result to the wrong chart.
 */
import {
  parseInstrumentPayload,
  matchAnalyzerResult,
  type ParsedInstrumentResult,
} from '@/lib/services/instrument-intake-service';

describe('parseInstrumentPayload — protocol sniffing', () => {
  it('recognises an HL7 message by its MSH segment', () => {
    const out = parseInstrumentPayload('MSH|^~\\&|ANALYZER|LAB|||20260209083000||ORU^R01|1|P|2.3');
    expect(out.protocol).toBe('hl7');
  });

  it('recognises an LIS-2A message by its H record', () => {
    const out = parseInstrumentPayload('H|\\^&|||Sysmex^XN330|||||||||20260209083000');
    expect(out.protocol).toBe('lis2a');
  });

  it('reports "unknown" for anything else, with an explanatory warning', () => {
    const out = parseInstrumentPayload('garbage payload, not an instrument message');
    expect(out.protocol).toBe('unknown');
    expect(out.results).toHaveLength(0);
    expect(out.warnings[0]).toMatch(/unrecognized/i);
  });
});

describe('parseInstrumentPayload — LIS-2A (ASTM E1394)', () => {
  it('extracts accession, test and result from a full O/R message', () => {
    const payload = [
      'H|\\^&|||Sysmex^XN330|||||||||20260209083000',
      'O|1|ACC-260209-002^|||||20260209083000|20260209075800',
      'R|1|^^^HGB^Hemoglobin|7.2|g/dL|12.0-16.0|L||F||Tech||20260209083000|20260209083500',
      'L|1|N',
    ].join('\r');

    const out = parseInstrumentPayload(payload);
    expect(out.protocol).toBe('lis2a');
    expect(out.results).toHaveLength(1);
    const [r] = out.results;
    expect(r.accession).toBe('ACC-260209-002');
    expect(r.testCode).toBe('HGB');
    expect(r.testName).toBe('Hemoglobin');
    expect(r.numericValue).toBe(7.2);
    expect(r.unit).toBe('g/dL');
    expect(r.referenceRange).toBe('12.0-16.0');
    expect(r.abnormalFlag).toBe('L');
    expect(r.instrumentId).toBe('Sysmex');
  });

  it('carries a qualitative (non-numeric) result as text, not a dropped value', () => {
    const payload = [
      'H|\\^&|||Analyzer^1|||||||||20260209083000',
      'O|1|ACC-999|||||20260209083000',
      'R|1|^^^MAL^Malaria RDT|Positive||Negative|A',
    ].join('\r');

    const out = parseInstrumentPayload(payload);
    expect(out.results[0].numericValue).toBeUndefined();
    expect(out.results[0].textValue).toBe('Positive');
  });

  it('skips an R record with no preceding O record and warns rather than guessing an accession', () => {
    const payload = [
      'H|\\^&|||Analyzer^1|||||||||20260209083000',
      'R|1|^^^HGB^Hemoglobin|7.2|g/dL',
    ].join('\r');

    const out = parseInstrumentPayload(payload);
    expect(out.results).toHaveLength(0);
    expect(out.warnings.some(w => /R record without preceding O record/i.test(w))).toBe(true);
  });
});

describe('parseInstrumentPayload — HL7 v2.x ORU^R01', () => {
  it('extracts accession, test and result from an OBR/OBX pair', () => {
    const payload = [
      'MSH|^~\\&|COBAS|LAB|HIS|HOSP|20260209090000||ORU^R01|MSG001|P|2.3',
      'PID|1||JTH-000005',
      'OBR|1|PLC-1|ACC-260209-002|CBC^Complete Blood Count',
      'OBX|1|NM|WBC^White Blood Cells||14.3|10*3/uL|4.0-11.0|H',
    ].join('\r');

    const out = parseInstrumentPayload(payload);
    expect(out.protocol).toBe('hl7');
    expect(out.results).toHaveLength(1);
    const [r] = out.results;
    expect(r.accession).toBe('ACC-260209-002');
    expect(r.testCode).toBe('WBC');
    expect(r.numericValue).toBe(14.3);
    expect(r.abnormalFlag).toBe('H');
  });

  it('skips an OBX with no preceding OBR', () => {
    const payload = [
      'MSH|^~\\&|COBAS|LAB|HIS|HOSP|20260209090000||ORU^R01|MSG001|P|2.3',
      'OBX|1|NM|WBC^White Blood Cells||14.3|10*3/uL',
    ].join('\r');

    const out = parseInstrumentPayload(payload);
    expect(out.results).toHaveLength(0);
    expect(out.warnings.some(w => /OBX without preceding OBR/i.test(w))).toBe(true);
  });
});

type Order = { _id: string; status?: string; testName?: string; accessionNumber?: string; patientId?: string; patientName?: string };

function reading(overrides: Partial<ParsedInstrumentResult> = {}): Pick<ParsedInstrumentResult, 'accession' | 'testName'> {
  return { accession: 'ACC-260209-002', testName: 'Hemoglobin', ...overrides };
}

describe('matchAnalyzerResult — accession is the source of truth', () => {
  const openOrder: Order = { _id: 'lab-002', status: 'pending', testName: 'Full Blood Count', accessionNumber: 'ACC-260209-002', patientId: 'pat-005' };
  const otherOpenOrder: Order = { _id: 'lab-003', status: 'pending', testName: 'Hemoglobin', accessionNumber: 'ACC-260209-003', patientId: 'pat-012' };
  const closedOrder: Order = { _id: 'lab-001', status: 'completed', testName: 'Hemoglobin', accessionNumber: 'ACC-260209-001', patientId: 'pat-001' };

  it('matches the order carrying the exact accession, not any order with the same test name', () => {
    const match = matchAnalyzerResult(reading(), [openOrder, otherOpenOrder, closedOrder]);
    expect(match?._id).toBe('lab-002');
  });

  it('is case- and whitespace-insensitive on the accession', () => {
    const match = matchAnalyzerResult(reading({ accession: '  acc-260209-002  ' }), [openOrder]);
    expect(match?._id).toBe('lab-002');
  });

  it('still finds an already-completed order for the same accession (an amendment, not a new filing)', () => {
    const match = matchAnalyzerResult(reading({ accession: 'ACC-260209-001' }), [closedOrder]);
    expect(match?._id).toBe('lab-001');
  });

  it('refuses to guess when the accession does not match any held order — the "invalid sample ID" case', () => {
    const match = matchAnalyzerResult(reading({ accession: 'ACC-DOES-NOT-EXIST' }), [openOrder, otherOpenOrder, closedOrder]);
    expect(match).toBeUndefined();
  });

  it('does not fall back to a name match when an (unmatched) accession was provided', () => {
    // Same test name as otherOpenOrder, but the accession is wrong — this must
    // NOT silently match on the name, or the result lands on the wrong chart.
    const match = matchAnalyzerResult(reading({ accession: 'ACC-WRONG', testName: 'Hemoglobin' }), [otherOpenOrder]);
    expect(match).toBeUndefined();
  });
});

describe('matchAnalyzerResult — name fallback when the instrument sends no accession', () => {
  const openOrder: Order = { _id: 'lab-010', status: 'pending', testName: 'Hemoglobin' };
  const closedOrder: Order = { _id: 'lab-011', status: 'completed', testName: 'Hemoglobin' };

  it('matches an open order by test name when no accession is present', () => {
    const match = matchAnalyzerResult({ accession: '', testName: 'Hemoglobin' }, [closedOrder, openOrder]);
    expect(match?._id).toBe('lab-010');
  });

  it('matches in both directions — a panel name containing the analyte, or vice versa', () => {
    const panelOrder: Order = { _id: 'lab-020', status: 'pending', testName: 'Hemoglobin (POC)' };
    const match = matchAnalyzerResult({ accession: '', testName: 'Hemoglobin' }, [panelOrder]);
    expect(match?._id).toBe('lab-020');
  });

  it('returns undefined when there is no name and no accession to go on', () => {
    const match = matchAnalyzerResult({ accession: '', testName: '' }, [{ _id: 'lab-030', status: 'pending', testName: 'Hemoglobin' }]);
    expect(match).toBeUndefined();
  });

  it('never matches a completed order by name alone', () => {
    const match = matchAnalyzerResult({ accession: '', testName: 'Hemoglobin' }, [closedOrder]);
    expect(match).toBeUndefined();
  });
});

/**
 * Instrument intake service — parses results coming off bench analyzers
 * via the two protocols that show up in real labs:
 *
 *   • LIS-2A   (NCCLS LIS2-A2) — ASTM E1394 record framing,
 *               used by Mindray, Sysmex, and most legacy chemistry / hematology.
 *   • HL7 v2.x ORU^R01 — used by newer immunoassay + chemistry analyzers.
 *
 * The full real-world driver layer (RS-232 + serial framing for LIS-2A,
 * MLLP socket listener for HL7) lives in the gateway worker process.
 * This service is the *parser* — given a raw payload, it produces a
 * structured `ParsedInstrumentResult[]` ready to be matched against
 * an order and persisted as a `LabResultDoc`.
 */

export interface ParsedInstrumentResult {
  /** Patient/sample ID embedded in the message — usually the accession number. */
  accession: string;
  /** Timestamp of the measurement on the analyzer (ISO). */
  observedAt: string;
  /** LOINC or analyzer-native test code. */
  testCode: string;
  /** Friendly test name for display ("Hemoglobin", "WBC", etc.). */
  testName: string;
  /** Numeric value if the result is quantitative. */
  numericValue?: number;
  /** Free-text value for qualitative / coded results ("Negative", "POS", "<5"). */
  textValue?: string;
  /** Reporting unit ("g/dL", "%", "mmol/L"). */
  unit?: string;
  /** Reference range as reported by the instrument ("12-16"), if present. */
  referenceRange?: string;
  /** Result flag from the analyzer (H, L, A, etc.). */
  abnormalFlag?: string;
  /** Instrument identifier ("Sysmex XN-330 SN9012"). */
  instrumentId?: string;
}

export interface IntakeOutcome {
  protocol: 'lis2a' | 'hl7' | 'unknown';
  results: ParsedInstrumentResult[];
  warnings: string[];
}

/**
 * Top-level parser — sniffs the payload and dispatches.
 * LIS-2A messages start with a header record `H|...` framed with STX/ETX.
 * HL7 messages start with `MSH|`.
 */
export function parseInstrumentPayload(raw: string): IntakeOutcome {
  const trimmed = raw.replace(/^[\x02\x05]+|[\x03\x04]+$/g, '').trim();
  if (trimmed.startsWith('MSH|')) return parseHL7(trimmed);
  if (/^H\|/.test(trimmed)) return parseLIS2A(trimmed);
  return { protocol: 'unknown', results: [], warnings: ['Unrecognized instrument payload — neither LIS-2A nor HL7 framing detected.'] };
}

// ─── LIS-2A (ASTM E1394) ────────────────────────────────────────────────────
function parseLIS2A(payload: string): IntakeOutcome {
  const warnings: string[] = [];
  const results: ParsedInstrumentResult[] = [];
  // Records are separated by CR or LF; fields by `|`, components by `^`, repeats by `\\`
  const records = payload.split(/[\r\n]+/).map(r => r.trim()).filter(Boolean);

  let currentAccession = '';
  let currentObservedAt = new Date().toISOString();
  let currentInstrument = '';

  for (const rec of records) {
    const fields = rec.split('|');
    const recordType = fields[0];
    switch (recordType) {
      case 'H': {
        // H|\\^&|||SenderID^Version|||...|...|...|...|YYYYMMDDHHMMSS
        const sender = (fields[4] || '').split('^')[0];
        if (sender) currentInstrument = sender;
        const ts = fields[13];
        if (ts && /^\d{14}$/.test(ts)) currentObservedAt = astmTimestampToIso(ts);
        break;
      }
      case 'O': {
        // O|seq|sample-id|instrument-id|test-id|priority|requested|collected|...
        currentAccession = (fields[2] || '').split('^')[0] || currentAccession;
        const collected = fields[7];
        if (collected && /^\d{14}$/.test(collected)) currentObservedAt = astmTimestampToIso(collected);
        break;
      }
      case 'R': {
        // R|seq|test-id|measurement|units|ref-range|flag|...|status|date-modified|operator|date-started|date-completed
        // Universal Test ID is `<sub-id>^<sub-id>^<sub-id>^<local-code>^<local-name>` per ASTM E1394.
        // Real-world feeds vary on which component is populated — pick the first non-empty as code.
        const universalTestId = fields[2] || '';
        const components = universalTestId.split('^');
        const codeIdx = components.findIndex(c => c && c.trim());
        const testCode = codeIdx >= 0 ? components[codeIdx].trim() : '';
        const testName = codeIdx >= 0 ? (components[codeIdx + 1] || '').trim() : '';
        const measurement = fields[3] || '';
        const numeric = parseFloat(measurement);
        const unit = (fields[4] || '').trim() || undefined;
        const referenceRange = (fields[5] || '').trim() || undefined;
        const abnormalFlag = (fields[6] || '').trim() || undefined;

        if (!currentAccession) {
          warnings.push(`R record without preceding O record — skipping (test ${testCode}).`);
          continue;
        }

        results.push({
          accession: currentAccession,
          observedAt: currentObservedAt,
          testCode,
          testName: testName || testCode,
          numericValue: Number.isFinite(numeric) ? numeric : undefined,
          textValue: Number.isFinite(numeric) ? undefined : measurement,
          unit, referenceRange, abnormalFlag,
          instrumentId: currentInstrument || undefined,
        });
        break;
      }
      case 'L':
      case 'P':
      case 'C':
      case 'Q':
        // Patient / Comment / Query / Trailer — not needed for result extraction
        break;
      default:
        warnings.push(`Unknown LIS-2A record type "${recordType}" — ignored.`);
    }
  }

  return { protocol: 'lis2a', results, warnings };
}

function astmTimestampToIso(ts: string): string {
  // YYYYMMDDHHMMSS → YYYY-MM-DDTHH:MM:SS
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}`;
}

// ─── HL7 v2.x ORU^R01 ───────────────────────────────────────────────────────
function parseHL7(payload: string): IntakeOutcome {
  const warnings: string[] = [];
  const results: ParsedInstrumentResult[] = [];
  // Segments separated by \r in real HL7; tolerate \n as well.
  const segments = payload.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);

  let currentAccession = '';
  let currentObservedAt = new Date().toISOString();
  let currentInstrument = '';

  for (const seg of segments) {
    const fields = seg.split('|');
    const segType = fields[0];
    switch (segType) {
      case 'MSH': {
        const sendingApp = (fields[3] || '').split('^')[0];
        if (sendingApp) currentInstrument = sendingApp;
        const ts = fields[7];
        if (ts && /^\d{12,14}$/.test(ts)) currentObservedAt = astmTimestampToIso(ts.padEnd(14, '0'));
        break;
      }
      case 'OBR': {
        // OBR|setID|placerOrderNumber|fillerOrderNumber|universalServiceID|priority|requestedDateTime|observationDateTime|...
        currentAccession = (fields[3] || fields[2] || '').split('^')[0] || currentAccession;
        const observed = fields[7];
        if (observed && /^\d{12,14}$/.test(observed)) currentObservedAt = astmTimestampToIso(observed.padEnd(14, '0'));
        break;
      }
      case 'OBX': {
        // OBX|setID|valueType|observationIdentifier|subID|observationValue|units|referenceRange|abnormalFlags|...
        const valueType = fields[2];
        const observationIdentifier = fields[3] || '';
        const components = observationIdentifier.split('^');
        const codeIdx = components.findIndex(c => c && c.trim());
        const testCode = codeIdx >= 0 ? components[codeIdx].trim() : '';
        const testName = codeIdx >= 0 ? (components[codeIdx + 1] || '').trim() : '';
        const value = fields[5] || '';
        const unit = (fields[6] || '').trim() || undefined;
        const referenceRange = (fields[7] || '').trim() || undefined;
        const abnormalFlag = (fields[8] || '').trim() || undefined;

        if (!currentAccession) {
          warnings.push(`OBX without preceding OBR — skipping (${testCode}).`);
          continue;
        }

        const numeric = (valueType === 'NM' || valueType === 'SN') ? parseFloat(value) : NaN;
        results.push({
          accession: currentAccession,
          observedAt: currentObservedAt,
          testCode,
          testName: testName || testCode,
          numericValue: Number.isFinite(numeric) ? numeric : undefined,
          textValue: Number.isFinite(numeric) ? undefined : value,
          unit, referenceRange, abnormalFlag,
          instrumentId: currentInstrument || undefined,
        });
        break;
      }
      case 'PID':
      case 'NTE':
      case 'EVN':
        // Patient / Note / Event — not needed for result extraction
        break;
      default:
        // Allow unrecognized segments without warning — HL7 has many extensions.
        break;
    }
  }

  return { protocol: 'hl7', results, warnings };
}

/**
 * Match one parsed analyzer reading to the order it belongs to.
 *
 * Accession first. Analyzers echo the specimen/accession id they were given
 * (`O|1|ACC-7788|…` in LIS-2A, OBR-3 in HL7), and that id identifies exactly
 * one order. Matching on the test name instead — which is what this used to do
 * — picks the first open order whose name overlaps, so with two patients both
 * waiting on a Hemoglobin the reading lands on whichever happens to sort first.
 * That files a result against the wrong chart.
 *
 * Name matching is kept only as a fallback for instruments that report no
 * accession at all, and callers are expected to tell the operator when it is
 * what produced the match.
 */
export function matchAnalyzerResult<
  T extends { _id: string; status?: string; testName?: string; accessionNumber?: string },
>(parsed: Pick<ParsedInstrumentResult, 'accession' | 'testName'>, orders: T[]): T | undefined {
  const open = orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled');
  const accession = parsed.accession?.trim().toLowerCase();

  if (accession) {
    const exact = open.find(o => (o.accessionNumber || '').trim().toLowerCase() === accession);
    if (exact) return exact;
    // A closed order still matching the accession means the value belongs to an
    // already-reported test — an amendment, not a new filing. Return it so the
    // caller opens the right order rather than silently falling through to a
    // name match on somebody else's specimen.
    const closed = orders.find(o => (o.accessionNumber || '').trim().toLowerCase() === accession);
    if (closed) return closed;
    // The instrument named an accession we do not hold. Refuse rather than
    // guess — this is the case where guessing puts a result on a stranger.
    return undefined;
  }

  const name = (parsed.testName || '').toLowerCase().split(' (')[0].trim();
  if (!name) return undefined;
  return open.find(o => (o.testName || '').toLowerCase().includes(name))
    || open.find(o => name.includes((o.testName || '').toLowerCase()));
}

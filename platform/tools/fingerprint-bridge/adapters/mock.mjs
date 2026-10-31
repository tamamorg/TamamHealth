/**
 * Mock fingerprint adapter — no hardware required.
 *
 * Used for development, demos, and CI. A "capture" produces a fake template
 * that encodes a subject identifier; "match" compares subject identifiers.
 * This lets the full enroll → identify flow be exercised end-to-end:
 * pass the same `simulateId` to capture during enrollment and identification
 * and the bridge will report a 100-score match.
 *
 * Template wire format (MOCK): base64 of JSON
 *   { "v": 1, "driver": "mock", "subject": "<id>" }
 *
 * Real adapters (see README) return ISO/IEC 19794-2 or ANSI 378 minutiae
 * templates produced by the vendor SDK, and delegate match() to the SDK's
 * native matcher.
 */

import { randomUUID } from 'node:crypto';

function encodeTemplate(subject) {
  return Buffer.from(JSON.stringify({ v: 1, driver: 'mock', subject })).toString('base64');
}

function decodeTemplate(template) {
  try {
    const parsed = JSON.parse(Buffer.from(template, 'base64').toString('utf8'));
    if (parsed && parsed.driver === 'mock' && typeof parsed.subject === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

export function createAdapter() {
  return {
    name: 'mock',
    templateFormat: 'MOCK',

    async isScannerConnected() {
      return true;
    },

    /**
     * @param {{ simulateId?: string, finger?: string }} [options]
     * @returns {Promise<{ template: string, quality: number, finger?: string }>}
     */
    async capture(options = {}) {
      const subject = options.simulateId || randomUUID();
      return {
        template: encodeTemplate(subject),
        // Deterministic "good" quality so demo flows never hit the
        // low-quality retry path by surprise.
        quality: 92,
        finger: options.finger,
      };
    },

    /**
     * @param {string} probe base64 template from a fresh capture
     * @param {Array<{ id: string, template: string }>} candidates
     * @returns {Promise<Array<{ id: string, score: number }>>} all candidates with scores 0-100
     */
    async match(probe, candidates) {
      const probeDecoded = decodeTemplate(probe);
      return candidates.map(c => {
        const cand = decodeTemplate(c.template);
        const isMatch = !!probeDecoded && !!cand && probeDecoded.subject === cand.subject;
        return { id: c.id, score: isMatch ? 100 : 0 };
      });
    },
  };
}

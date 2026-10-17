// Polyfill TextEncoder/TextDecoder for jose in jsdom
import { TextEncoder, TextDecoder } from 'util';
import crypto from 'crypto';
import timers from 'timers';

Object.assign(globalThis, { TextEncoder, TextDecoder });

// Polyfill setImmediate/clearImmediate for pouchdb-adapter-memory (memdown) in jsdom
if (typeof globalThis.setImmediate === 'undefined') {
  (globalThis as any).setImmediate = timers.setImmediate;
  (globalThis as any).clearImmediate = timers.clearImmediate;
}

// Polyfill fetch for pouchdb-browser in jsdom (Node 18+ has native fetch)
if (typeof globalThis.fetch === 'undefined') {
  Object.assign(globalThis, {
    // @ts-ignore -- node-fetch may or may not have declarations depending on
    // the install (v2 has none); only used as a test polyfill either way.
    fetch: (...args: Parameters<typeof fetch>) => import('node-fetch').then(m => (m.default as any)(...args)),
    Headers: class Headers {},
    Request: class Request {},
    Response: class Response {},
  });
}

// Polyfill structuredClone for jose v6+ in jsdom
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val));
}

// Polyfill Web Crypto API for jose JWT signing/verification in jsdom
Object.defineProperty(globalThis, 'crypto', {
  value: {
    ...crypto,
    subtle: crypto.webcrypto?.subtle,
    getRandomValues: (arr: Uint8Array) => crypto.randomFillSync(arr),
  },
  writable: true,
  configurable: true,
});

// Organisation data keys (lib/org-data-cipher.ts) derive from this secret.
// Set here so services under test encrypt and decrypt patient data the way a
// signed-in device does, without a network fetch for the key. Every suite
// runs through the encrypting database layer (helpers/test-db.ts).
process.env.ORG_DATA_KEY_SECRET = process.env.ORG_DATA_KEY_SECRET || 'test-org-data-key-secret-0123456789abcdef';

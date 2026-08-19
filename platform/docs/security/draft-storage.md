# Encrypted draft storage

This document describes how the platform protects in-progress PHI form drafts
on shared workstations, and what residual risks remain.

**Current status: the encrypt/decrypt path is built but not wired to any
form today.** `saveDraft()`/`loadDraft()` have no call sites anywhere in
`src/app` or `src/components` — consultation autosave now writes straight
to the local PouchDB note document via `note-service.ts`
(`ClinicalNoteEditor.tsx`), not through this module. The only piece of
`draft-storage.ts` actually wired into the app is the defensive
`dropAllDrafts()` cleanup called from `logout()` in `context.tsx`, which
still matters — it clears any ciphertext left over from a form that *did*
use this module in the past, or from a future one that does. Treat the
rest of this document as describing a mechanism that is correct and ready
to use, not one currently protecting a live autosave flow; if you're
looking for where consultation drafts are protected today, that's
PouchDB's local storage, not this. This is a real gap worth confirming
with the team (was this intentionally disconnected, or did a refactor
silently drop the wiring?), not something fixed by editing this doc.

## Threat model

The web app is used on shared clinical workstations — a tablet in the consult
room, a desktop at the triage station. Real-world failure mode:

1. A clinician opens a new consultation, types in chief complaint, vitals,
   exam findings, diagnoses, prescriptions, lab orders.
2. They get pulled away mid-form (emergency, end of shift, lunch).
3. The next user — or anyone with USB / DevTools access — opens the same
   browser, navigates to **DevTools → Application → Local Storage**, and
   reads the entire draft in cleartext.

Before this defence, the consultation page autosaved drafts to
`window.localStorage` keyed `tamamhealth:consultation:draft:<patientId>`.
Anything left behind from before the 24h TTL cleanup was readable PHI.

The defence here narrows that window from "until 24h elapses or the user
explicitly logs out" to "until the **tab** closes" — orders of magnitude
shorter on a real shared device.

## Design

Implemented in [`lib/draft-storage.ts`](../../src/lib/draft-storage.ts).

### Per-tab AES-GCM key

On first use, `getOrCreateKey()`:

1. Calls `crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt','decrypt'])`.
2. Exports the key as raw bytes, base64url-encodes them, and stores under
   `tamamhealth.draft.k` in `sessionStorage`.

`sessionStorage` is **per-tab and dies when the tab closes**. The next user
opening the browser to the same origin gets a brand-new (empty)
`sessionStorage`, so even if encrypted draft ciphertext is still sitting in
`localStorage`, there is no key to decrypt it with. `loadDraft()` returns
`null`, and the form starts fresh.

This is a deliberate tradeoff: the previous "draft survives a browser
crash for 24h" UX becomes "draft survives a refresh, but not a tab close".
Browser crashes typically restore the same `sessionStorage` (modern Chromium
and Firefox restore tabs into the same session storage, since the tab is
considered the same), so the practical impact on the recovery use case is
small, while the security improvement is large.

### Encryption envelope

For each `saveDraft()`:

1. Generate a fresh 12-byte IV with `crypto.getRandomValues()`.
2. `crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)` — Web
   Crypto's AES-GCM appends the 16-byte auth tag to the ciphertext, so we
   don't carry it separately.
3. Concatenate `iv | ciphertext+tag`, base64-encode, store as a JSON
   envelope in `localStorage`:

   ```json
   {
     "savedAt":   1735689600000,
     "ttlMs":     86400000,
     "ciphertext": "<base64(iv || ct||tag)>"
   }
   ```

The localStorage key is `tamamhealth.draft.<sanitizedKey>` — sanitized to
`[A-Za-z0-9:_.-]` so weird input can't break out of the key namespace.

### Lazy TTL expiry

`loadDraft()` checks `Date.now() - savedAt > ttlMs` and removes the entry
before returning `null`. The default TTL is 24h, overridable via
`NEXT_PUBLIC_DRAFT_TTL_HOURS`. The TTL is policy, not security — even
before it fires, encrypted drafts are unreadable to anyone without the
per-tab key, which is gone the moment the tab closes.

### Logout cleanup contract

[`lib/context.tsx`](../../src/lib/context.tsx)'s `logout()` calls
`dropAllDrafts()` immediately after clearing the session cookie:

- Iterates `window.localStorage` and removes every key starting with
  `tamamhealth.draft.`.
- Clears the sessionStorage AES key as well, so any subsequent saves in the
  same tab mint a fresh key unrelated to whatever blobs were just orphaned.
- Wrapped in `try/catch` — a logout must not be blocked by a storage error.
  Worst case is orphan ciphertext in localStorage, which is unreadable.

This is **defence in depth**. Strictly speaking, the ciphertext is already
unreadable once the tab closes; this just removes the dead bytes.

### Fallback: insecure context (dev LAN, http)

`crypto.subtle` is only defined in
[secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)
— `https://`, `localhost`, or `file://`. Some dev setups ship the platform
over plain HTTP on a LAN address; `subtle` is `undefined` there.

In that case, `saveDraft()`:

1. Logs a one-time warning to the console explaining that PHI drafts will be
   readable in plaintext.
2. Stores the draft as `plain:<json>` in the same envelope.
3. `loadDraft()` recognizes the `plain:` prefix and returns the parsed JSON
   directly.

Production over HTTPS *always* has `crypto.subtle`; this fallback only
exists so the dev loop on weird LAN setups doesn't silently break form
autosave. Operators are explicitly told.

## sessionStorage key fragility (intended)

The `sessionStorage` AES key is the load-bearing piece. It's intentionally
fragile:

- Closing the tab destroys it.
- Opening the same URL in a new tab gets a fresh, unrelated key.
- Logging out destroys it.
- Calling `sessionStorage.clear()` from anywhere destroys it.

Each of these dropping the key turns every encrypted draft on the device
into noise. That fragility *is* the protection — `loadDraft()` returning
`null` because the key is gone is **success**, not failure.

The form layer (consultation page) treats `null` from `loadDraft()` as
"nothing to restore" — same UX as a fresh visit. It does **not** error
out, prompt the user, or expose the existence of orphan ciphertext.

## What this does *not* defend against

- **A logged-in attacker who steals the *whole* tab.** If the original tab
  is still open and the attacker can run JS in it (XSS, injected extension,
  malware-driven Selenium), they have access to the AES key in
  sessionStorage and the encrypted blobs in localStorage — same effective
  reach as before the change. CSP and same-origin XSS prevention are the
  defences for that, not this module.
- **Server-side compromise.** The drafts are also flushed to the server
  on save. Anyone who can read `tamamhealth_medical_records` directly has
  the data regardless. This is the device-side defence only.
- **A clinician making bad choices on purpose.** Authorisation, audit trail,
  and access reviews handle that.
- **Forensic recovery from disk.** A determined attacker with raw filesystem
  access *and* the ability to recover deleted memory or pagefile data could
  potentially reconstruct decrypted state. The threat model here is the
  next casual user opening DevTools, not a state-level forensic adversary.

## What the operator must do

- Serve the platform over HTTPS in any environment that touches real PHI.
  The fallback path explicitly weakens this defence and logs a warning, but
  it does not prevent storage — it can't, without breaking the form.
- Ensure shared-workstation policy includes browser tab close at end of
  shift. The encrypted-draft protection assumes the tab eventually closes;
  a tab left open forever is functionally the same as the old plaintext
  behaviour for that session.

## Tests

There is no test file for this module anywhere in the repo today — a real
coverage gap. A `draft-storage.test.ts` covering the roundtrip, lazy TTL
expiry, ciphertext tampering, lost per-tab key, namespace cleanup, and
key-isolation would run cleanly under jsdom: `jest.setup.ts` already
polyfills `globalThis.crypto` (`subtle` from Node's `crypto.webcrypto`,
`getRandomValues` from `crypto.randomFillSync`), so the infrastructure this
module needs is already in place — it's just unused.

## See also

- [csrf.md](./csrf.md) — Cross-Site Request Forgery model. Different threat
  surface (cross-origin) but related: both layer browser-side defences over
  a session cookie, and both fall in the same "what does an attacker who can
  run JS on our origin get?" worst-case bucket.
- [token-revocation.md](./token-revocation.md) — what `logout()` does to the
  server-side session. The draft-cleanup hook in `context.tsx#logout` runs
  alongside the cookie clear and CouchDB session drop.

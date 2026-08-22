# Online Booking & Patient Intake — Implementation Plan

**Date:** 2026-08-07
**Goal:** Replace the current "book from inside the app only" intake with a patient-facing booking system whose slots are derived from real provider availability, modelled on the Tebra Care Connect reference screenshots.
**Status:** Phase 0 built and verified. Phases 1–6 planned.

## Built so far (2026-08-07)

| Delivered | Where |
|---|---|
| Booking document types | `platform/src/lib/db-types-booking.ts`; additive fields on `AvailabilityDoc` + `AppointmentDoc` |
| Slot engine (pure, 41 tests) | `platform/src/lib/booking/slot-engine.ts`, `platform/src/__tests__/booking/slot-engine.test.ts` |
| Data layer + holds | `booking-service.ts`, `booking-policy-service.ts`, `visit-reason-service.ts` |
| Recurring availability | `AvailabilityDoc.recurrence`; `appliesOnDate` / `getAvailabilityOnDate` in `availability-service.ts` |
| **Parallel clinicians** | Conflict guard now provider+room scoped; calendar draws concurrency clusters side by side; seed, sweep and integrity test all re-scoped |
| Portal double-booking hole closed | `POST /api/patient-portal/appointments` runs the guard and returns 409 |
| Slot picker in staff booking | `components/booking/SlotPicker.tsx` + `useBookingSlots` / `useVisitReasons`, wired into `BookAppointmentModal` |
| Duplicate booking form removed | `/appointments` now opens the shared `BookAppointmentModal` instead of its own copy |
| Demo data | SEED_VERSION 70: recurring weekday clinics, a bookable practice, 6 visit reasons, 3 published provider profiles |

Verified in the running app: choosing "Established Patient Visit" on Mon 10 Aug returns 40 slots over 22 distinct times, with CO Deng, Dr. Achol and Dr. Wani all holding 9:00 AM.

---

## 0. The reference, read literally

Seven screens were supplied. Each is decomposed below into the exact UI contract we must reproduce. `S#` labels are referenced throughout the rest of the plan.

### S1 + S2 — Provider profile page (public directory)

| Region | Contract |
|---|---|
| Header | Square provider photo, `Dr. Sudha Challa, MD` (H1), specialty line (`Geriatric Medicine Physician`), address block (street / suite / city, state), `+1 more location` link |
| Tabs | `About · Services · Locations · Reviews` — underline on active, scroll-spy to page sections |
| Rating block | 5 stars, `4.8` at display size, `385 Reviews` link |
| Reviews | Card per review, body clamped with inline `Show more`, `Reviewer First L. • Month DD, YYYY`, `Read more reviews` pill button |
| Right rail | `Request Appointment` panel, coral header bar |
| — segmented control | `New patient` / `Returning patient`, two-up, selected = white on grey track |
| — reason select | Single select, `Annual Gynecology Visit` |
| — day navigator | `‹` `TUE / May 21` `›` — weekday above, date below, circular arrow buttons |
| — slot grid | 4 columns of pill chips, `8:00 AM … 4:15 PM`, 15-min cadence with a lunch gap (11:45 → 1:30) |
| Secondary card | `Got questions for Dr. X?` + `Call now` pill with phone icon |

**Key read:** the lunch gap is not styled as "unavailable" — those slots simply do not render. Availability is generated, not a fixed grid with holes.

### S3 — Profile booking, step 2 (details)

The right rail *replaces itself* — it does not open a dialog. Header bar gains a back `←`, keeps the `Request Appointment` title. Below it: provider avatar, `Tuesday, May 21, 10:30 AM`, location short name (`Chamblee`). Then a **disabled** `Location` select pre-filled with the address, then `First Name`, `Last Name`, `Email`… scrolling.

### S4 — Practice-wide booking page

| Region | Contract |
|---|---|
| Title | `Book an appointment` |
| New-patient control | Checkbox (not a segmented control here): `I'm a new patient at this practice` |
| Filters | `Location` select, `Provider` select — both empty = "any" |
| Modality | Segmented `In-person` / `Virtual visit` |
| Date strip | `‹` + 5 day columns (`WED May 22` … `SUN May 26`) + `›` |
| Rows | One row per provider: avatar, name, `Virtual visit` badge (purple, camera icon) |
| Cells | Up to 3 slot chips then a `more` chip; `—` when the provider has nothing that day |

**Key read:** two providers hold the same 9:00 AM. Parallel booking across providers at one location is mandatory. (This directly contradicts a rule in our current code — see §9.1.)

### S5 — Embedded modal on the practice's own website, step 1

Modal over the practice's marketing site (their own nav/branding visible behind). `Request Appointment` + `✕`. Same new-patient checkbox. `Reason for visit` **combobox** — open state shows 6 options with a check on the selected one (`Annual Gynecology Visit`, `Annual Visit`, `Established Patient Visit`, `New Patient Visit`, `Pre-Op Visit`, `Well Baby/Child Visit`). `Location` select with an `✕` clear affordance. 3-day strip, chips + `more`, `—` for empty days.

### S6 — Modal step 2 (patient details)

Header: avatar, `Tuesday, May 21, 8:30 AM`, `Chamblee`. Scrollable body: disabled `Location`; `First Name` / `Last Name` two-up; `Email` / `Phone` two-up; `Date of Birth` (`mm/dd/yyyy`); two consent checkboxes —
1. `I have read and agreed to the Privacy Policy and Terms of Use that I am at least 13 and have the authority to make this appointment`
2. `I agree to receive text messages from this practice and understand that message frequency and data rates may apply.`

then **practice-authored policy text**: *"Before booking your appointment please provide accurate insurance information… Failure to do so will result in a $50 fee charge."* Footer: `Back` (outline) / `Continue →` (coral).

### S7 — Modal step 3 (insurance)

Different practice (Artemis Health) — proves the widget is white-labelled per practice. Header now `Book Appointment`, avatar + `Friday, May 17 - 5:30 PM` + provider name. Body: `Insurance` select, `Insurance Member ID#`, `Insurance Group ID#`, `Additional notes for the practice` textarea. `Continue →`.

**Key read:** insurance is its own step, after identity, and is the last thing before submit. Page-dots at the bottom (`○ ● ○`) indicate a 3-step wizard.

### The beige bubbles

`2/11`, `3/11`, `5/11`, `9/11`, `10/11`, `11/11` with `←` / `Next` / `Finish` — an **11-step anchored product tour**, not part of the booking UI. We already have this machinery (`platform/src/lib/tour/`). Spec in §11.

---

## 1. What we already have (and will reuse)

| Need | Existing asset |
|---|---|
| Appointment record | `AppointmentDoc` — [db-types.ts:1974](../platform/src/lib/db-types.ts#L1974). Already has `requested` status, `statusHistory`, `appointmentMode`, telehealth |
| Provider availability | `AvailabilityDoc` — [db-types.ts:1881](../platform/src/lib/db-types.ts#L1881) with `slotMinutes`, `modality`, `facilityId` |
| Availability CRUD | [availability-service.ts](../platform/src/lib/services/availability-service.ts) — create/cancel + overlap rejection |
| Availability entry UI | [AvailabilityModal.tsx](../platform/src/components/AvailabilityModal.tsx), launched from Sidebar + Appointments |
| Booking + conflict guard | `assertNoBookingConflicts` — [appointment-service.ts:150](../platform/src/lib/services/appointment-service.ts#L150) |
| Patient-facing auth | `/patient-portal` — OTP + patient-scoped JWT, server APIs at `src/app/api/patient-portal/*` |
| Patient-initiated request | `POST /api/patient-portal/appointments` already writes `status: 'requested'` |
| Intake form lifecycle | `PatientIntakeFormDoc` + [intake-form-service.ts](../platform/src/lib/services/intake-form-service.ts) — request → submit → review → merge/reject |
| Intake review queue | [/patient-intake](../platform/src/app/(dashboard)/patient-intake/page.tsx) |
| Duplicate-patient matching | `matchPatient` — [mpi-service.ts:98](../platform/src/lib/services/mpi-service.ts#L98) |
| Service catalogue + price | `FeeScheduleDoc` — [db-types-billing.ts:106](../platform/src/lib/db-types-billing.ts#L106), managed at `/org-admin/pricing` |
| Insurance verification | `POST /api/eligibility` |
| Notifications | `sendSms` ([sms/index.ts:52](../platform/src/lib/sms/index.ts#L52)) and `src/lib/email/` |
| Public route precedent | `/privacy`, `/terms` via `PublicLegalShell`; public-path allowlist in [proxy.ts](../platform/src/proxy.ts) |
| Guided tour | `TourDefinition` / `TourStep` — [tour/types.ts](../platform/src/lib/tour/types.ts), rendered by [TourCard.tsx](../platform/src/components/tour/TourCard.tsx) |
| Tenant isolation | `filterByScope` — the only tenant barrier; see §9.3 |

## 2. What does not exist yet

1. **No slot engine.** `AvailabilityDoc` carries `slotMinutes` but nothing anywhere divides a window into slots or subtracts booked appointments. `grep slotMinutes` returns only the type, the seed, and the entry form.
2. **No recurrence.** Availability is one dated row per provider per day. A clinic with a Mon–Fri pattern needs 260 rows/year/provider.
3. **No visit-reason catalogue.** `AppointmentType` is a fixed 11-value union of clinical categories — not the patient-facing, per-practice, duration-carrying list in S5.
4. **No new-vs-returning concept** anywhere in the data model.
5. **No booking policy** (lead time, horizon, buffers, auto-confirm, cancellation window, policy text).
6. **No provider public profile** — `UserDoc` has `specialty`/`department`/`phone` and nothing else. No photo, bio, languages, accepting-new-patients, or public slug.
7. **No insurance capture** on the patient record. `insuranceProvider` exists only on a billing doc.
8. **No reviews/ratings model.**
9. **No public (unauthenticated) booking surface** and no embeddable widget.
10. **No slot hold** — two patients can fill the same form for the same 10:30.

---

## 3. Data model

New file `platform/src/lib/db-types-booking.ts` (keeps `db-types.ts` from growing another 400 lines; matches the existing `db-types-billing.ts` / `db-types-ward.ts` split).

### 3.1 `VisitReasonDoc` — the S5 dropdown

```ts
export interface VisitReasonDoc extends BaseDoc {
  type: 'visit_reason';
  orgId: string;
  facilityId?: string;          // unset = all locations in the org
  name: string;                 // "Annual Gynecology Visit"  ← the label patients read
  slug: string;                 // stable id for links: "annual-gynecology-visit"
  durationMinutes: number;      // drives slot length; overrides window slotMinutes
  /** Who may pick this reason online. Both false = staff-booking only. */
  availableToNewPatients: boolean;
  availableToReturningPatients: boolean;
  modality: 'in_person' | 'telehealth' | 'both';
  /** Restrict to a provider subset. Empty = every provider with availability. */
  providerIds: string[];
  department: string;                    // maps into AppointmentDoc.department
  appointmentType: AppointmentType;      // maps into the clinical union
  feeScheduleCode?: string;              // link to FeeScheduleDoc.serviceCode
  requiresInsurance: boolean;            // gates the S7 step per reason
  sortOrder: number;
  isActive: boolean;
}
```

### 3.2 `BookingPolicyDoc` — one per facility

```ts
export interface BookingPolicyDoc extends BaseDoc {
  type: 'booking_policy';
  orgId: string;
  facilityId: string;
  onlineBookingEnabled: boolean;
  /** 'request' → lands as `requested` for front-desk review (default, safe).
   *  'auto'    → lands as `scheduled`; the conflict guard is authoritative. */
  confirmationMode: 'request' | 'auto';
  minLeadTimeMinutes: number;     // e.g. 240 — no booking inside 4h
  maxAdvanceDays: number;         // e.g. 90 — how far the ‹ › strip may walk
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  /** Slots offered per window; > 1 models double-booked teaching clinics. */
  defaultCapacity: number;
  cancellationWindowHours: number;
  requireInsurance: boolean;      // org-wide default; VisitReasonDoc overrides
  /** S6 free text under the consents. Rendered as plain text, never HTML. */
  policyText?: string;
  consentTextPrivacy: string;
  consentTextSms: string;
  /** S1 "Call now" target. */
  publicPhone?: string;
  publicEmail?: string;
  /** Feeds /book/[orgSlug] and the embed snippet. */
  publicSlug: string;
  embedAllowedOrigins: string[];  // exact origins for frame-ancestors + CORS
}
```

### 3.3 `ProviderProfileDoc` — the S1/S2 header

Separate doc rather than more fields on `UserDoc`: `UserDoc` carries `passwordHash` and `pinHash`, and a public endpoint must never be one `select` away from those.

```ts
export interface ProviderProfileDoc extends BaseDoc {
  type: 'provider_profile';
  userId: string;                 // → UserDoc._id
  orgId: string;
  publicSlug: string;             // "dr-sudha-challa"
  displayName: string;            // "Dr. Sudha Challa, MD"
  credentials?: string;           // "MD"
  specialtyLabel: string;         // "Geriatric Medicine Physician"
  photoUrl?: string;
  bio?: string;
  languages: string[];
  acceptingNewPatients: boolean;
  facilityIds: string[];          // drives "+N more location"
  isPublished: boolean;           // nothing renders publicly until true
}
```

### 3.4 `AvailabilityDoc` — additive changes only

```ts
  /** Weekly recurrence. When set, `date` is the series start. */
  recurrence?: {
    daysOfWeek: number[];         // 0=Sun
    until: string;                // YYYY-MM-DD
    exceptions?: string[];        // dates skipped (leave, holiday)
  };
  /** Restrict this window to specific reasons. Empty = all. */
  visitReasonIds?: string[];
  /** Restrict to new or returning patients. Unset = both. */
  patientClass?: 'new' | 'returning';
  /** Concurrent bookings per slot. Defaults to policy.defaultCapacity. */
  capacity?: number;
  roomId?: string;
  /** Offered online at all — a window can be internal-only. */
  bookableOnline?: boolean;
```

Every field optional ⇒ existing rows and the seed keep working.

### 3.5 `AppointmentDoc` — additive changes only

```ts
  /** Where the booking came from. Absent = staff-booked (all existing rows). */
  source?: 'staff' | 'portal' | 'public_widget' | 'directory';
  isNewPatient?: boolean;
  visitReasonId?: string;
  visitReasonName?: string;       // denormalised: the label the patient saw
  /** Contact block for a requester with no PatientDoc yet. Cleared on merge. */
  requester?: {
    firstName: string; lastName: string;
    email?: string; phone?: string; dateOfBirth?: string;
  };
  insuranceSubmitted?: {
    provider: string; memberId: string; groupId?: string;
    verifiedAt?: string; verificationStatus?: 'verified' | 'denied' | 'pending';
  };
  patientNotes?: string;          // S7 "Additional notes for the practice"
  consent?: { privacyAcceptedAt: string; smsOptIn: boolean; policyVersion: string };
  /** Public reference shown on the confirmation screen, e.g. "TMH-8F3K2". */
  bookingReference?: string;
```

### 3.6 `SlotHoldDoc` — short-lived

```ts
export interface SlotHoldDoc extends BaseDoc {
  type: 'slot_hold';
  orgId: string; facilityId: string; providerId: string;
  date: string; startTime: string; durationMinutes: number;
  expiresAt: string;              // now + 10 min
  holdToken: string;              // opaque; the submit call must present it
}
```

Holds are consulted by the slot engine and by the conflict guard, then deleted on submit or swept on expiry. A stale hold costs one slot for ten minutes; skipping holds costs a double-booking, which the front desk has to phone someone about.

### 3.7 `ProviderReviewDoc` — Phase 5, gated

```ts
export interface ProviderReviewDoc extends BaseDoc {
  type: 'provider_review';
  providerId: string; orgId: string; facilityId: string;
  /** Only a completed appointment can be reviewed — no anonymous submission. */
  appointmentId: string;
  rating: 1|2|3|4|5;
  body: string;
  authorDisplayName: string;      // "Latrice B." — derived, never full name
  visitDate: string;
  status: 'pending_moderation' | 'published' | 'rejected';
  moderatedBy?: string; moderatedAt?: string;
}
```

The `4.8 / 385 Reviews` block must be computed from published rows. If Phase 5 is not built, the rating block does not render — no placeholder stars.

---

## 4. The slot engine

`platform/src/lib/booking/slot-engine.ts` — **pure, no I/O, fully unit-tested.** This is the piece the whole feature rests on and the piece most likely to be got wrong; keeping it free of DB calls is what makes it testable.

```ts
export interface SlotQuery {
  from: string; to: string;              // YYYY-MM-DD inclusive
  facilityIds?: string[];
  providerIds?: string[];
  visitReason: VisitReasonDoc;
  patientClass: 'new' | 'returning';
  modality: 'in_person' | 'telehealth';
  now: string;                           // injected — never Date.now() inside
  timeZone: string;                      // facility tz, not the browser's
}

export interface Slot {
  providerId: string; providerName: string;
  facilityId: string; facilityName: string;
  date: string; startTime: string; endTime: string;
  modality: 'in_person' | 'telehealth';
  capacityLeft: number;
}

export function computeSlots(
  windows: AvailabilityDoc[],
  appointments: AppointmentDoc[],
  holds: SlotHoldDoc[],
  policy: BookingPolicyDoc,
  query: SlotQuery,
): Slot[];
```

Pipeline, in order:

1. **Expand recurrence** — each window → concrete dates in `[from, to]`, minus `exceptions`.
2. **Filter windows** — `status !== 'cancelled'`, `bookableOnline !== false`, modality compatible, `patientClass` compatible, `visitReasonIds` empty or containing this reason, provider/facility filters.
3. **Slice** — step by `visitReason.durationMinutes` (not the window's `slotMinutes`) from `startTime`; drop any slot whose end exceeds `endTime`. A 20-min reason in an 08:00–09:00 window yields 08:00, 08:20, 08:40 — never a 08:50 that runs over.
4. **Subtract occupancy** — for each candidate, count overlapping appointments still holding their slot (`!APPOINTMENT_SLOT_RELEASED_STATUSES.includes(status)` — [appointment-status.ts:194](../platform/src/lib/appointment-status.ts#L194), i.e. cancelled / no-show / rescheduled release it), **plus** unexpired holds, **plus** `bufferBefore/After` around each. `capacityLeft = capacity − occupied`; drop `≤ 0`.
5. **Apply lead time** — drop slots starting before `now + minLeadTimeMinutes`.
6. **Apply horizon** — drop beyond `now + maxAdvanceDays`.
7. **Sort** by date, time, provider name.

**Timezone rule.** Every date/time in the engine is a facility-local wall-clock string; `now` and `timeZone` are injected. Do not mix `jubaDate()` ([time-juba.ts](../platform/src/lib/time-juba.ts)) with the client-side `toIsoDate()` ([EhrMiniCalendar.tsx:5](../platform/src/components/ehr/EhrMiniCalendar.tsx#L5)) inside the engine — the caller converts once at the edge.

Tests: `platform/src/__tests__/booking/slot-engine.test.ts` — recurrence expansion
(including exceptions and series bounds), wall-clock arithmetic across a month
boundary, buffer overlap before and after, capacity > 1, the lead-time boundary,
the booking horizon, reason-duration override, cancelled/no-show/rescheduled
releasing a slot, hold expiry and consumption, empty-day → no slots.

> The original suite (57 tests) was deleted in `e581d4b6` as part of a
> "remove obsolete test files" sweep and never replaced, leaving this engine —
> which serves the public `/api/booking/slots` endpoint — with no coverage at
> all while this table went on claiming 57 tests. Rewriting it from the case
> list above immediately surfaced a real defect: `addDays()` built a UTC date
> and formatted it with the LOCAL getters, so on any machine west of UTC it
> returned the day it was given. Recurring windows expanded to the wrong dates
> or none, and the public booking horizon was short. Africa/Juba is UTC+2,
> which is why a server in Juba never showed it and every CI runner did.
>
> One line here was also wrong rather than stale: the lead-time boundary is
> **inclusive**. `minLeadTimeMinutes` is defined as "no booking may start
> sooner than this many minutes from now", and a slot exactly that far away is
> not sooner than it — so it is offered. The engine has always behaved this
> way; the parenthetical claiming otherwise has been removed rather than the
> rule changed.

Thin data-loading wrapper alongside it: `platform/src/lib/services/booking-service.ts` (fetch → `computeSlots` → return), so both the API route and any staff-side "find me a slot" reuse one path.

---

## 5. API surface

All public routes live under `/api/booking/*`, are **server-only** (never PouchDB-in-browser), and return **zero PHI** — no patient names, no appointment reasons of other patients, nothing but free/busy.

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/booking/practice/[slug]` | GET | public | Practice name, branding, locations, published providers, visit reasons, policy text. Cached 60s. |
| `/api/booking/provider/[slug]` | GET | public | One `ProviderProfileDoc` + locations + (Phase 5) rating summary |
| `/api/booking/slots` | GET | public | `computeSlots` results. Query: `practice`, `provider?`, `location?`, `reason`, `patientClass`, `modality`, `from`, `to` |
| `/api/booking/hold` | POST | public + rate-limited | Creates `SlotHoldDoc`, returns `holdToken` + `expiresAt` |
| `/api/booking/request` | POST | public + rate-limited | The submit. Body = identity + consent + insurance + `holdToken` |
| `/api/booking/reference/[ref]` | GET | public, unguessable ref | Confirmation / status lookup |
| `/api/booking/cancel/[ref]` | POST | public, unguessable ref | Patient-initiated cancel inside the policy window |

`POST /api/booking/request`, step by step:

1. Validate the hold token; reject if expired or already consumed.
2. Re-run `computeSlots` for that one slot — **the hold is a courtesy, the recompute is the truth.**
3. `matchPatient()` against name + DOB + phone ([mpi-service.ts:98](../platform/src/lib/services/mpi-service.ts#L98)):
   - **High-confidence match** → attach `patientId`; `isNewPatient` recorded as claimed but not trusted.
   - **No/weak match** → no `PatientDoc` is created. The identity lives in `appointment.requester` and the intake form until a human merges it. *Public traffic must never be able to write rows into the patient registry.*
4. `createAppointment(...)` with `status = policy.confirmationMode === 'auto' ? 'scheduled' : 'requested'` — through the service, so `assertNoBookingConflicts` runs (see §9.1).
5. `createIntakeForm(...)` with the submitted fields, `status: 'pending_review'`, linked by `appointmentId`.
6. Delete the hold. Generate `bookingReference`.
7. `logAuditSafe('PUBLIC_BOOKING_REQUEST', …)` + `emitSyncEvent(...)`.
8. Fire SMS/email confirmation (best-effort; a failed send never fails the booking).
9. Return `{ reference, status, when, location }` — and nothing else.

**Abuse controls** (no session to lean on): per-IP + per-phone rate limits in the shape already used by [patient-portal/login](../platform/src/app/api/patient-portal/login/route.ts) (10 / 15 min); a hold required before submit; max 3 open requests per phone; honeypot field; optional Turnstile behind an env var. Add `/api/booking/*` to `CSRF_EXEMPT_API_PATHS` in [proxy.ts](../platform/src/proxy.ts) — there is no session cookie to protect, and the rate limiter is the real guard.

---

## 6. Pages & navigation

### 6.1 Public route group — `platform/src/app/(booking)/`

Its own `layout.tsx` (no `EhrTopRail`, no `SettingsProvider`, no PouchDB bootstrap — same spirit as `PublicLegalShell`).

| Route | Screenshot | Notes |
|---|---|---|
| `/book/[practice]` | **S4** | Practice-wide grid. Location + provider filters, in-person/virtual toggle, 5-day strip |
| `/book/[practice]/[provider]` | **S1, S2, S3** | Provider profile; booking rail on the right; on mobile the rail becomes a sticky bottom sheet |
| `/book/[practice]/embed` | **S5, S6, S7** | Chrome-less widget for iframing into a practice website |
| `/book/confirm/[reference]` | — | Confirmation, add-to-calendar (.ics), cancel/reschedule links |

Register these in [proxy.ts](../platform/src/proxy.ts) alongside `/privacy` and `/patient-portal` (public-path block, ~line 263) so they never redirect to `/login`.

**Embedding.** `/embed` is the only route allowed in an iframe. Set `Content-Security-Policy: frame-ancestors 'self' <policy.embedAllowedOrigins>` on that route only; every other route keeps the global deny. The snippet the practice pastes is generated on the settings page:

```html
<script src="https://app.tamamhealth.org/embed.js"
        data-practice="mercy-general" data-mode="modal"></script>
```

`public/embed.js` is a ~2 KB standalone script: injects a button, opens an iframe in an overlay, `postMessage` for height + close. It must not import from the app bundle.

### 6.2 Staff surfaces

| Route | Change |
|---|---|
| `/appointments` | New **Online requests** tab: `source !== 'staff' && status === 'requested'`, with Approve / Reschedule / Decline. Approve runs the conflict guard and moves to `scheduled` |
| `/patient-intake` | Already the review queue. Extend to show the linked appointment and to **create-or-link** a `PatientDoc` on merge |
| `/appointments` → Availability | Upgrade `AvailabilityModal` for recurrence, per-reason restriction, new/returning, capacity, `bookableOnline` |
| `/org-admin/booking` **(new)** | Visit reasons CRUD, policy, consent + policy text, public slug, embed snippet + copy button, provider publication toggles |
| `/org-admin/pricing` | Link each `VisitReasonDoc` to a `FeeScheduleDoc.serviceCode` |
| `/my-facility` | Public-facing location fields: display address, public phone, map coords |
| Provider self-service | "My availability" panel on the doctor dashboard — a doctor must be able to close tomorrow afternoon without asking an admin |

Nav additions in [permissions.ts](../platform/src/lib/permissions.ts) + [role-routes.ts](../platform/src/lib/role-routes.ts):
`/org-admin/booking` → `org_admin`, `super_admin`, `medical_superintendent`. The Online-requests tab needs no new route.

---

## 7. Component inventory

New directory `platform/src/components/booking/`. Everything is presentational + prop-driven so the same components serve the profile rail, the practice page, and the embed.

| Component | Screens | Props (essential) |
|---|---|---|
| `BookingFlow` | S1→S3, S5→S7 | State machine: `slot → details → insurance → confirm`. Owns draft + hold lifecycle |
| `SlotPicker` | S1 | `slots, date, onDateChange, onPick, columns=4` — day navigator + chip grid |
| `WeekSlotGrid` | S4 | `providers, days, slotsByProvider, maxPerCell=3, onPick` — renders `more` and `—` |
| `PatientClassToggle` | S1 (segmented) / S4, S5 (checkbox) | `variant: 'segmented' \| 'checkbox'` |
| `VisitReasonSelect` | S5 | Combobox with checkmark on selection; falls back to native `Select` on mobile |
| `LocationSelect` | S5, S6 | Clearable (`✕`); `disabled` variant for the locked step-2 display |
| `ModalityToggle` | S4 | `In-person` / `Virtual visit` |
| `BookingSummaryHeader` | S3, S6, S7 | Avatar + `Tuesday, May 21, 10:30 AM` + location/provider |
| `PatientDetailsStep` | S3, S6 | Name, email, phone, DOB + `ConsentBlock` |
| `ConsentBlock` | S6 | Two checkboxes + policy text from `BookingPolicyDoc`; renders text-only |
| `InsuranceStep` | S7 | Insurance select, member/group ID, notes |
| `BookingStepDots` | S6, S7 | `○ ● ○` |
| `ProviderProfileHeader` | S1, S2 | Photo, name, specialty, address, `+N more location` |
| `ProviderTabs` | S1 | About / Services / Locations / Reviews, scroll-spy |
| `RatingSummary` + `ReviewList` | S1 | Phase 5. Renders nothing when no published reviews |
| `CallNowCard` | S1 | `policy.publicPhone` → `tel:` |
| `RequestAppointmentModal` | S5 | Wraps `BookingFlow` in a dialog for the embed |

**Styling constraints** (learned the hard way, per project memory):

- These components render **outside** `.tamam-ehr-app`, so none of the `ehr-*` classes or their `!important` overrides apply. Build a `booking-*` namespace in its own stylesheet.
- `globals.css` force-uppercases every bare `<label>`. S3/S6 labels are sentence case — scope them (`.booking-field label { text-transform: none }`) rather than fighting it inline.
- `globals.css` does not style `datetime-local`/`date`; the DOB field needs explicit styling.
- Reuse the design tokens (`--accent-primary`, `--border-medium`, `--bg-card-solid`) so a practice's `OrganizationDoc.primaryColor` themes the widget — the coral header in S1/S5 is the practice's brand colour, not a fixed value.

---

## 8. How a booking becomes a patient

The part that "wires the intake correctly":

```
Patient submits (public)
   │
   ├─ AppointmentDoc  status=requested  source=public_widget  requester={…}
   ├─ PatientIntakeFormDoc  status=pending_review  ← the answers
   └─ SlotHoldDoc consumed
   │
   ▼
Front desk: /appointments → Online requests   (or /patient-intake)
   │
   ├─ MPI candidates shown inline (matchPatient on name+DOB+phone)
   │     ├─ Link to existing patient  → appointment.patientId set, requester cleared
   │     └─ Register as new           → createPatient() from the form, then link
   │
   ├─ Approve  → assertNoBookingConflicts → status=scheduled → SMS/email confirmation
   ├─ Reschedule → rescheduleAppointment() → new time confirmation
   └─ Decline  → status=cancelled + rejectIntakeForm() + notification
   │
   ▼
mergeIntakeFormToChart() writes the answers onto the chart (never blanks — the
existing non-empty guard at intake-form-service.ts:106 already handles this)
   │
   ▼
Insurance → POST /api/eligibility before the visit → verificationStatus stamped
   │
   ▼
Day of visit: existing check-in / rooming / consultation flow, unchanged
```

Nothing downstream of check-in changes. That is deliberate — the whole feature is a new front door onto the existing corridor.

---

## 9. Conflicts with current code — must be resolved before Phase 2

### 9.1 Facility-wide slot exclusivity blocks the S4 screen ⚠️ blocking

[appointment-service.ts:160-177](../platform/src/lib/services/appointment-service.ts#L160) enforces **one appointment per slot per facility**, on the reasoning that the calendar draws a day as a single stack. S4 shows two providers both holding 9:00 AM at one practice. With this rule, online booking would offer slots it then refuses to accept.

**Resolution:** make the rule scoped and policy-driven —
- always enforce **provider** exclusivity (a doctor can't be in two rooms), keep the patient rules exactly as they are;
- replace facility-wide exclusivity with **room** exclusivity when `roomId` is set;
- keep facility-wide as an opt-in `BookingPolicyDoc.singleSlotPerFacility` (default **true** for existing facilities so nothing changes underneath them, **false** for any facility that turns on online booking).

The calendar's single-stack rendering then needs a parallel-column day view — scoped into Phase 3, not Phase 2.

### 9.2 The patient-portal POST bypasses the conflict guard ⚠️

[patient-portal/appointments/route.ts:67](../platform/src/app/api/patient-portal/appointments/route.ts#L67) writes straight to `db.put`, explicitly bypassing `createAppointment`. Today that is survivable because requests are triaged by hand. Once slots are advertised as bookable it is a live double-booking path. Route it through `createAppointment` with the same `requested` status; keep the portal's looser provider/booker requirements by defaulting them in the route.

### 9.3 Tenant isolation on public endpoints ⚠️ security

Per project memory: `filterByScope` is the *only* tenant barrier, and the local database holds every org's data. A public endpoint that calls a service without a scope returns **every practice on the platform**. Every `/api/booking/*` handler must resolve `practice slug → orgId + facilityId` **first**, then pass an explicit scope into every read. Worth a dedicated `security-reviewer` pass before this ships.

### 9.4 Browser PouchDB must not be involved

Public pages have no authenticated user and must not bootstrap the client database. `(booking)` pages are server components calling `/api/booking/*`; the only client JS is the booking flow itself. Confirm no import path drags in `@/lib/db` (an accidental `useAppointments()` would).

### 9.5 Date handling

Client code uses local `toIsoDate()`; services use `jubaDate()`; `app/api` slices UTC. The engine takes `now` + `timeZone` explicitly for exactly this reason. Facility timezone belongs on `HospitalDoc` (new optional `timeZone`, defaulting to `Africa/Juba`).

### 9.6 Other

- **`AppointmentType` vs visit reason** — keep both. `VisitReasonDoc.appointmentType` maps the patient-facing label onto the clinical union so every existing report keeps working.
- **`status: 'requested'` is already counted** in [front-desk](../platform/src/app/(dashboard)/dashboard/front-desk/page.tsx#L985), [appointments](../platform/src/app/(dashboard)/appointments/page.tsx#L649) and [useNotifications](../platform/src/lib/hooks/useNotifications.ts#L342). Online requests will start appearing in those counts — intended, but check each reads sensibly at volume.
- **Seed** — bump `SEED_VERSION` and seed: 2 booking policies, ~8 visit reasons, provider profiles + photos for the demo doctors, and **recurring weekday availability** (today's seed is one 00:00–23:59 window for today only, which would render an absurd slot grid).
- **`AvailabilityModal` overlap rejection** ([availability-service.ts:44](../platform/src/lib/services/availability-service.ts#L44)) is per provider+day and will need to understand recurrence.

---

## 10. Phases

Each phase is independently shippable and leaves the app working.

### Phase 0 — Foundations (no UI)
`db-types-booking.ts`; `slot-engine.ts` + full test suite; `booking-service.ts`; seed data + `SEED_VERSION` bump; fix §9.1 and §9.2.
**Done when:** `computeSlots` tests pass and staff booking still behaves identically.

### Phase 1 — Availability that can express a real clinic
Recurrence + per-reason + new/returning + capacity in `AvailabilityDoc`; rebuild `AvailabilityModal` as `AvailabilityEditor` (weekly pattern, exceptions, copy-to-next-week); provider self-service panel; `/org-admin/booking` with visit reasons + policy.
**Done when:** an admin can express "Dr. Wani, Mon/Wed/Fri 08:00–12:00, new patients only, Annual Visit + New Patient Visit, 20-min slots, until December" in one dialog.

### Phase 2 — Booking inside the product
`/api/booking/slots`; `BookingFlow` + `SlotPicker` + steps; wire into the **existing** `BookAppointmentModal` (staff pick a real slot instead of typing a time) and into the patient portal.
**Done when:** front desk and portal both book off generated slots, and an offered slot is always acceptable.

### Phase 3 — Public practice page + embed (S4, S5, S6, S7)
`(booking)` route group; `/book/[practice]`; `/embed`; `public/embed.js`; hold + request endpoints; rate limiting; confirmation page + `.ics`; SMS/email confirmations; Online-requests tab; parallel-column day view (§9.1).
**Done when:** a patient books from a practice's own website and the request appears at the front desk within seconds with MPI candidates attached.

### Phase 4 — Provider directory (S1, S2, S3)
`ProviderProfileDoc` + publication workflow; `/book/[practice]/[provider]`; profile header, tabs, About/Services/Locations; `CallNowCard`; the right-rail flow; SEO metadata + JSON-LD `Physician`; sitemap.
**Done when:** a published provider has a shareable public profile that books.

### Phase 5 — Reviews (S1 rating block) — optional
`ProviderReviewDoc`; post-visit review invitation tied to a completed appointment; moderation queue; rating aggregate; `Read more reviews`.
**Gate:** only build with an explicit decision on moderation ownership. Until then the rating block does not render.

### Phase 6 — Polish
Eligibility pre-check on insurance submit; reschedule/cancel by link; waitlist for full days; no-show risk flag; analytics (funnel: view → slot → submit → confirmed → attended).

---

## 11. The 11-step tour

**Not built.** This section is a design, not a description: there is no
`booking-tour.ts` and `journey-tours.ts` has no booking entry. It is kept as the
plan for whoever picks it up.

The design: reuse [tour/types.ts](../platform/src/lib/tour/types.ts) verbatim, add
`platform/src/lib/tour/booking-tour.ts`, register it in `journey-tours.ts`, launch
it from `/org-admin/booking`. Note `TourCard` renders `Step 3 of 11` (deliberately, per its own comment) rather than the reference's `3/11` — keep our wording.

| # | Route | Anchor | Message |
|---|---|---|---|
| 1 | `/org-admin/booking` | `[data-tour="booking-toggle"]` | Turn online booking on per location. Nothing is public until you do. |
| 2 | `/book/[practice]/[provider]` | `[data-tour="booking-rail"]` | Patients see appointment times that reflect your schedule in real time. Tailor availability by new/returning patient, visit reason, and virtual or in-person. |
| 3 | `/book/[practice]/[provider]` | `[data-tour="details-step"]` | Collect required patient information up front, and keep nice-to-have details for later steps. |
| 4 | `/org-admin/booking` | `[data-tour="visit-reasons"]` | Each visit reason carries its own duration, so a 40-minute new-patient visit never lands in a 15-minute gap. |
| 5 | `/org-admin/booking` | `[data-tour="practice-link"]` | Create one booking link for the whole practice, instead of or alongside individual provider pages. |
| 6 | `/org-admin/booking` | `[data-tour="embed-snippet"]` | Paste one snippet to put the booking widget on your own website. |
| 7 | `/appointments` | `[data-tour="availability-editor"]` | Set a weekly pattern once; add exceptions for leave and holidays. |
| 8 | `/appointments` | `[data-tour="online-requests"]` | Online requests arrive here for review — approve, reschedule, or decline. |
| 9 | `/org-admin/booking` | `[data-tour="policy-rules"]` | Wherever the patient books from — your website, the directory, a custom link — availability comes from the same set of rules. |
| 10 | `/org-admin/booking` | `[data-tour="policy-text"]` | Customisable sections let you set the right expectations before a patient confirms. |
| 11 | `/org-admin/booking` | `[data-tour="insurance-step"]` | Collect insurance up front so eligibility can be checked before the visit. |

Each anchor needs a `data-tour` attribute added to the corresponding element as its phase is built.

---

## 12. Decisions taken (flag if any is wrong)

1. **Requests, not auto-confirms, by default.** `confirmationMode: 'request'` — a public submission does not silently occupy a clinician's calendar. `'auto'` is one setting away.
2. **No public writes to the patient registry.** An unmatched booking creates no `PatientDoc`. A human links or registers.
3. **The public surface is opt-in per facility** and off by default, so nothing about existing facilities changes on deploy.
4. **Reviews are last and gated.** Real reviews need a moderation owner; fabricated ratings on a clinician's public profile are not acceptable.
5. **Visit reasons are new; `AppointmentType` stays.** Reporting continuity beats a clean union.
6. **The directory (S1/S2) is Phase 4, behind the practice page.** Phases 0–3 deliver the actual goal — intake wired to real availability — without needing a public directory to exist.

## 13. Questions resolved

Answered by judgement rather than left open, so the build is not blocked. Each is a default, not a one-way door.

- **Public surface is link-only until Phase 4.** `/book/*` ships `noindex` and is reached by SMS, QR, or a link on the practice's own site. Indexable profile pages arrive with the directory, once there is a moderation owner and real profile content to index. Cold search traffic to a half-filled profile is worse than no profile.
- **Reviews are moderated by the org admin,** in a queue on the booking settings screen, and only a patient with a `completed` appointment can be invited to leave one. No public write path. Still Phase 5, still gated.
- **Insurance is a per-org curated list,** seeded empty. Free text produces "NHIF", "N.H.I.F", and "nhif" in one week, and none of them can be checked against `/api/eligibility`. Until an org configures its payers, the insurance step is skipped rather than shown blank.
- **Policy text is per-facility** (`BookingPolicyDoc.policyText`). A per-location variant is a field away if a multi-site practice ever needs one; nothing today does.
- **Facility-wide slot exclusivity defaults OFF.** Confirmed as the intended product behaviour: different clinicians may hold the same time. `singleSlotPerFacility` remains for any site that wants the older single-file day.

## 14. Next up

Phase 1, in order: the availability editor (weekly pattern, exceptions, copy-forward) so clinic hours can be entered without one row per day; `/org-admin/booking` for visit reasons + policy; then the provider self-service "my availability" panel. Phase 2 extends the slot picker to the patient portal, Phase 3 opens the public practice page and embeddable widget.

# Patient-portal ↔ facility messaging

How a message typed in the patient-portal Chat tab reaches the staff inbox,
and how a staff reply gets back to the patient. Half-page contract — read
end-to-end before changing fields.

## The directionality contract

Every persisted message carries an explicit `direction` (see
[`MessageDoc`](../../src/lib/db-types.ts) — the `direction` field):

| `direction`         | sender → recipient                 | written by                                    |
|---------------------|------------------------------------|-----------------------------------------------|
| `patient_to_staff`  | patient (via portal) → facility    | `POST /api/patient-portal/messages` (server-forced; client initiator is `patient-portal/page.tsx` `handleSendChat`) |
| `staff_to_patient`  | facility → patient                 | `PatientDetailPage.tsx` `sendPatientMessage` (chart reply); `ClinicalNoteEditor.tsx` `handleSendEducation` (patient education); `appointment-reminder-service.ts` (automated reminders) |
| `staff_to_staff`    | facility → another staff member    | `conversation-service.ts` `sendConversationMessage` (internal staff chat, `/messages` page) |

There is no `SendMessageModal` component in the codebase — that name
described an earlier design that never shipped under that name. The three
real call sites above set `direction` directly when they call
`createMessage`.

The field is **optional** for backward compatibility: legacy docs written
before the field existed are treated as `staff_to_patient`, with the
exception that any message whose `fromDoctorId === 'patient'` is
recognised as inbound (this is the marker the patient-portal used before
the directional field landed).

## Canonical fields

Patient-originated messages are written server-side by
[`POST /api/patient-portal/messages`](../../src/app/api/patient-portal/messages/route.ts),
which forces the identity/direction fields from the patient's own verified
JWT rather than trusting the client body — the patient-portal Chat tab
(`handleSendChat` in `patient-portal/page.tsx`) only supplies the
non-identity fields (phone, department, hospital, subject, body). This
matters: a patient client can't spoof another patient's `patientId` or set
`fromDoctorId` to impersonate a clinician, because the route ignores those
fields if present in the request body and derives them from `auth` instead:

```ts
{
  recipientType: 'staff',
  direction: 'patient_to_staff',
  patientId:           auth.sub,              // from the verified patient JWT, not the request body
  patientName:         auth.name,
  patientPhone:        <patient.phone || ''>,
  recipientHospitalId: <patient.registrationHospital>,
  recipientDepartment: <chatDepartment>, // e.g. "General / OPD"
  fromDoctorId:        'patient',                 // sentinel marker
  fromDoctorName:      auth.name,                 // patient's own name
  fromHospitalId:      <patient.registrationHospital>,
  fromHospitalName:    <the hospital's name>,      // required on MessageDoc — omitted by an earlier version of this doc
  // ...subject / body / channel / sentAt as usual
}
```

Staff-authored messages keep the same `patientId`/`patientName`/
`patientPhone` triplet (whether the recipient is a patient or another
staff member, by historical contract); `recipientType` discriminates.
The reply path sets `direction: 'staff_to_patient'` and re-uses the
inbound message's `patientId`, so `getMessagesByPatient(patientId)`
returns the full conversation.

## Sync topology

The two sides of this conversation reach CouchDB by genuinely different
paths — this used to be documented as symmetric bi-sync on both ends, which
is no longer (and may never have been) accurate. Read carefully before
changing either side.

**Patient side has no PouchDB and no live subscription.** The patient
portal is an external client authenticated by its own JWT scheme
(`verifyPatientToken`), not a staff PouchDB-sync session, so it never gets
a local replica. The Chat tab POSTs to
[`/api/patient-portal/messages`](../../src/app/api/patient-portal/messages/route.ts),
which runs server-side and writes straight to CouchDB via `messagesDB()` —
on the server, `messagesDB()` resolves to a `pouchdb-core` instance with
only the `http` + `mapreduce` + `find` plugins (see `src/lib/db.ts`), i.e. a
stateless HTTP write per request, not a replica. The Chat tab fetches
messages once on mount; there is no polling or `.changes()` listener, so a
patient sees a new staff reply only after reloading or reopening the page.

**Staff side has a real local PouchDB with bi-directional replication.**
`tamamhealth_messages` is configured for two-way sync in
[`src/lib/sync/sync-config.ts`](../../src/lib/sync/sync-config.ts)
(`{ localName: 'tamamhealth_messages', direction: 'both', orgScoped: true }`),
wired up by `src/lib/sync/sync-manager.ts`. The `/messages` page and the
patient-chart reply flow live-subscribe via
[`useMessages`](../../src/lib/hooks/useMessages.ts), which calls
`messagesDB().changes({ since: 'now', live: true })` — so an inbound
patient message lights up the staff inbox without a manual refresh.

```
[Patient browser]                                        [Staff browser]
   |  POST /api/patient-portal/messages                        ^
   v                                                            | db.changes({since:'now',live:true})
[API route — server-side PouchDB http adapter]  -----> PouchDB (messages) <--bi-sync--> CouchDB (messages)
   (direct write, no local persistence, no live read)
```

Net effect: an inbound patient message reaches staff instantly (live
`.changes()`); a staff reply reaches the patient only on their next page
load of the Chat tab. If the patient side ever needs near-real-time
delivery, it needs its own polling or push mechanism — it can't piggyback
on PouchDB replication the way the staff side does, because it was never
given a local database to replicate into.

## Helpers (in [`message-service.ts`](../../src/lib/services/message-service.ts))

- `getMessagesByPatient(patientId)` — full conversation for one patient,
  newest-first, excluding `staff_to_staff` messages that happen to carry
  the same `patientId` for context. Used by both the patient-portal side
  (via `/api/patient-portal/messages` GET) and the staff reply path.
- `getInboundPatientMessages(scope?)` — the staff Inbox "From Patients"
  filter. Matches `direction === 'patient_to_staff'` _or_ the legacy
  `fromDoctorId === 'patient'` marker.
- `getMessagesForFacility(hospitalId, scope?)` — every message routed to
  or from a given facility, by `recipientHospitalId` or `fromHospitalId`.
  Useful for facility-scoped dashboards that aren't already running with
  a `DataScope` filter.

## Why we don't repurpose `recipientType`

`recipientType` answers _"is the recipient a patient or a staff member?"_
which is orthogonal to direction. A `patient_to_staff` message has
`recipientType: 'staff'`, but so does a staff-to-staff message. The two
fields together unambiguously type each row, and existing UI that filters
on `recipientType` keeps working.

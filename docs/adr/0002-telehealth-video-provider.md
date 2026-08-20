# ADR 0002 — Telehealth video provider

- **Status:** **Withdrawn (2026-08-20)** — telehealth was removed from the
  product entirely. Every visit is now in person, and the appointment model no
  longer carries a mode. The decision below is kept as a record of what was
  built and why, and of the constraint that shaped it: PHI-bearing media had to
  stay on infrastructure we control, which is what ruled out every hosted SFU.
  Anyone reviving remote visits should start from that constraint rather than
  from this choice — the product reasons for dropping it are not recorded here.
- **Superseded by:** removal (no replacement)
- **Status when accepted:** Accepted (implementation landed 2026-07-28)
- **Ticket:** KAN-123 (TH-1)
- **Supersedes:** the simulated visit room that shipped in `TelehealthVisitRoom.tsx`
- **Interacts with:** KAN-138/KAN-139 (room authorization), KAN-131 (connection
  recovery), KAN-140 (data protection and retention)

## Context

The telehealth visit room had a real local camera and a **static tile** where the
remote participant should be. There was no SDK, no signalling, and no media
server anywhere in `platform/src`. A clinician opening the room saw something
that looked like a consultation and was not one.

Choosing a provider is not only an integration decision. Every frame and every
word of a consultation passes through the selective forwarding unit (SFU), which
makes the SFU a **PHI processor** — arguably the most sensitive one in the
system, since it carries the unredacted clinical conversation rather than a
stored abstraction of it. Where that server runs decides where South Sudanese
patient data goes.

Bandwidth is the second constraint. Facilities in the deployment target range
from a fibre-served hospital in Juba to a county facility on a VSAT link shared
by the whole compound. A provider that cannot degrade gracefully is unusable in
most of the country.

## Decision

**Self-hosted LiveKit**, with all join tokens minted server-side by the platform.

- `livekit-server-sdk` signs short-lived tokens in
  `platform/src/app/api/telehealth/token/route.ts`.
- `livekit-client` drives the browser through the shared `useLiveKitRoom` hook,
  used by both the clinician room and the patient join surface so the two cannot
  drift into different connection models.
- The SFU runs on infrastructure we control (the existing DigitalOcean droplets
  today; in-country hosting when that becomes available — see
  `docs/AFRICA-HOSTING-STRATEGY.md`).

## Alternatives considered

### Daily (rejected)

Fastest integration by a wide margin, and a genuinely good low-bandwidth stack.
Rejected on residency: Daily is hosted-only, so PHI-bearing media would transit
a third-party SFU in a jurisdiction we do not choose, under a processor
agreement we cannot offer the MoH. That is a policy commitment the project is
not in a position to make on a patient's behalf.

### Jitsi (rejected)

Self-hostable, which satisfies the residency requirement. Rejected on the
authorization model: JWT support exists but is coarse, and per-identity grants
(the patient must not be able to admit, mute, or remove anyone) are awkward to
express. Telehealth authorization is the part of this epic with the most tickets
against it (TH-16, TH-17, TH-18); building it on a weaker permission primitive
would make each of those harder rather than easier.

### Twilio Programmable Video (rejected outright)

Being sunset. Not a candidate.

### LiveKit (chosen)

Open source and self-hostable, so media stays on infrastructure we control.
Per-identity token grants map directly onto the roles this epic needs —
`roomAdmin` for the clinician, plain join for the patient. Simulcast and
adaptive bitrate are first-class, and `adaptiveStream` + `dynacast` mean the
server stops sending video the far side is not rendering, which is exactly the
behavior a VSAT link needs.

The cost is honest: we now operate an SFU. That is a real service to deploy,
monitor, and keep patched, and it is the reason KAN-140 (monitoring) is not
optional.

## Where PHI goes

| Data | Path | At rest? |
| --- | --- | --- |
| Audio/video media | Client → our SFU → client | **No** — forwarded, never recorded |
| In-visit chat | LiveKit data channel, same path | No (see KAN-129 for the persisted version) |
| Join tokens | Minted per request, TTL 15 min | No |
| Session metadata (who, when, chief complaint) | Platform CouchDB | Yes, as normal clinical data |

**Recording is off and stays off** until there is a consent flow that asks the
patient specifically about recording — a checkbox for "telehealth visit" is not
consent to be recorded. `sessionRecorded` is written `false` at session
creation. Turning recording on is a separate decision with its own retention
policy (KAN-140), not a configuration toggle.

## Authorization

The room name is derived from the session id (`th-<sessionId>`) rather than
stored, so it cannot drift from the record. **The room name is not a secret** —
guessing it grants nothing, because LiveKit rejects any connection without a
token signed by our API secret.

Everything therefore rests on the token route, which:

1. authenticates the caller as staff (platform JWT) or patient (portal JWT);
2. loads the session server-side and requires the caller to be **that session's**
   provider or patient — being a clinician in the facility is not sufficient;
3. refuses a session that is cancelled or completed;
4. grants `roomAdmin` only to the provider.

Join URLs carry a session id and never a token. A forwarded SMS or a
shoulder-surfed screen yields nothing on its own — which is the usual way
telehealth deployments leak access to consultations.

`LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` sign those tokens, so anyone holding
them can mint entry to any consultation. They are server-only, and
`validateProductionConfig` refuses to boot if a `NEXT_PUBLIC_` copy of either
exists.

## Degradation

A deployment with no LiveKit server is a supported configuration, not a broken
one. The token route returns **503** and the visit room says video is
unconfigured rather than showing a call that will never connect. A telehealth
screen that looks live and is not is worse than one that admits it is
unavailable — a clinician will wait on the former.

What is *not* supported is a **partial** configuration. Two of the three keys
set means an operator intended working video, and the omission would otherwise
surface as a 503 the first time someone opens a consultation. Production now
refuses to boot instead.

## Consequences

- We operate an SFU. Deployment, patching, and monitoring are ours (KAN-140).
- `LIVEKIT_URL` must be `wss://` in production; validation rejects plaintext
  `ws://` except against localhost.
- Media residency follows wherever we run the SFU. Moving the platform in-country
  moves consultations too — the residency story stays coherent.
- Recording remains unimplemented by choice, and enabling it requires a consent
  change, not a config change.

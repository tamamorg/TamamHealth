# Hospital-hosted AI note assistant

Status: opt-in implementation, disabled by default. Not a certified medical device, not a compliance certification, and not approved for unattended clinical use. No model or inference server is bundled. No production activation or deployment has been performed.

## Scope and workflow

Supports typed notes and live microphone capture in the clinical note editor. Capture is in short segments (maximum five minutes); transcription happens **after stopping**, not as streaming live captions. A hospital-hosted speech model returns an editable transcript; a hospital-hosted text model drafts one selected narrative section. Clinicians review and edit the suggestion, inspect source quotes, affirm review, and explicitly replace that section. Existing chart signing remains separate.

The assistant never signs notes, submits diagnoses, orders medicines/labs, populates structured vitals/allergies, merges patients, or sends an entire chart automatically. It requires the clinician to be the draft's author or assignee, in the exact organization and facility. Government and global administrator roles get no inference bypass. Derived fields remain unchanged.

## Architecture and integrations

Browser microphone/typed text → same-origin authenticated `/api/ai-scribe` → hospital private inference gateway → transient review → existing local PouchDB note + normal replication.

- `client.ts`: browser component and pure policy exports.
- `index.ts`: server policy vocabulary; services are imported individually.
- `services/gateway.server.ts`: fixed, OpenAI-compatible HTTP contracts. This describes the wire format, **not a connection to OpenAI**.
- `services/apply-suggestion.ts`: one local revision-checked write. API does not write chart content.
- Existing identity/session revocation, CSRF, note assignment, facility scope and signing workflows are reused, with stricter checks for inference.
- Notes must already be synchronized to server storage. Unsynced/offline notes cannot use inference; normal manual notes still work.

Gateway contract:

1. `POST /v1/audio/transcriptions`, multipart `file`, `model`, `response_format=json`; response `{ "text": "..." }`.
2. `POST /v1/chat/completions`, non-streamed JSON, explicit model, system/user messages, JSON-object response. Require a `stop` finish reason and JSON content with only `text` and `evidence`.
3. TLS with a trusted hospital CA, server-only bearer credential, no redirects. Only an explicitly configured RFC1918 IPv4 literal is accepted, preventing DNS rebinding/public endpoint configuration. Certificate must have the IP SAN. Hostname/IPv6 deployments need a separately reviewed allowlist implementation; do not disable TLS checks.

vLLM supports a compatible chat interface; choose and validate a licensed model suitable for the hospital's hardware and clinical languages. whisper.cpp's native `/inference` API is different: an approved adapter would be needed, not just changing the URL. An ASR gateway must validate duration and decode media in a resource-limited sandbox; MIME signatures alone do not make uploaded media safe.

## Security controls and limitations

| Threat | Application control | Hospital obligation / residual risk |
|---|---|---|
| Cross-patient/facility access | Live staff + exact note author/assignee/org/facility checks, before and after inference | Database and replication access remain security boundaries; maintain their policies |
| Session hijack / cross-site submission | Existing session validation, origin check, session-bound CSRF | Secure workstation, TLS, short sessions; lock is UI protection, not server logout |
| PHI sent to external AI | Private-IP TLS endpoint only, fixed paths, no cloud/browser speech fallback | Deny internet egress from gateway/model hosts; private IP alone cannot prove the gateway does not forward data |
| Prompt injection / hallucination | Tool-free inference, narrow context, strict output schema, source quotes, mandatory human review | Quotes do not prove semantic accuracy; evaluate negation, speaker attribution, drug doses, units and local language |
| Stale/signed record overwritten | Draft-only, revision checks at request/completion/application; atomic local compare-and-swap | Replication conflicts need normal resolution; model output never overrides signing |
| Leakage through telemetry | No source/audio/output in audit payloads or provider error logs; no-store responses | Disable request/response body capture in proxies, APM, Sentry replay and model logs; no prompt caching/training |
| Lost audit evidence | Await audit write before inference and before returning result; failure denies output | Existing audit DB is not an immutable external ledger; restrict deletion and export to protected append-only storage |
| Resource exhaustion | 10 MiB audio, 24k source chars, 128 KiB response, 15s upload, 90s model timeout, 2 concurrent requests / process, 8/user/minute | Enforce distributed gateway quotas and ingress time/body limits, model token/CPU/GPU limits; process limits reset on restart |
| Recording persists unexpectedly | Stop tracks and discard temporary state on close, hidden tab, session lock, unmount, changed revision | Browser/OS memory is not securely zeroized; encrypted swap/disks, no core dumps; verify actual device/browser behavior |

Audio, transcripts and unaccepted suggestions are not persisted by this module. Reviewed narrative and provenance (request/model/prompt/reviewer/time) become part of the normal clinical record and its existing retention policy. Audit metadata includes actor, note reference, section and approval—not raw clinical content. All remain sensitive. This is not an end-to-end guarantee about proxy/model/OS retention.

Consent is clinician-attested for each assistant session and each request carries the attestation. Confirm local legal/policy requirements, minors/guardians, interpreters and all participants before enabling recording. Consent withdrawal means stop/discard; it does not automatically delete already accepted chart entries. Do not record bystanders. Patients declining AI should receive normal manual documentation.

## Deployment configuration and release gate

Keep `TAMAM_SCRIBE_ENABLED=false` until all gates pass. Set server-only variables from `.env.example`: approval reference, private gateway origin, service token, approved text/speech model IDs, exact JSON facility pairs. Use a secrets manager and rotation; never commit credentials or use NEXT_PUBLIC variables. The approval ID is a traceable policy reference, not cryptographic proof of approval.

Before activation:

- [ ] Document data controller, consent, retention/deletion, incident response, access review and clinical owner approval.
- [ ] Choose licensed models/hardware; pin artifacts, verify checksums, scan dependencies and prohibit remote-code loading.
- [ ] Deploy sandboxed ASR and text workers behind authenticated TLS gateway; deny external egress; no prompt/audio retention or training.
- [ ] Protect disk/swap/backups; turn off request body logs and replay on notes; verify audit persistence and protected export.
- [ ] Configure distributed limits, upload/media duration/token budgets, readiness and safe failure monitoring without PHI.
- [ ] Validate synthetic English/Juba Arabic cases, accents, overlap, silence, background speech, negation and conflicting statements; measure omission/hallucination rate with clinicians. Translation labels also require native-speaker review.
- [ ] Browser-test microphone permission denied/revoked, network interruption, timeout, double click, close/lock/tab hide, changed patient/note, signed note, multiple tabs, RTL, keyboard focus and consent withdrawal.
- [ ] Run real hospital model acceptance on synthetic data, security assessment and clinical sign-off. Do not use real patients to debug.
- [ ] Pilot one allowlisted facility; monitor sanitized failure counts. Rollback by disabling flag; manual documentation remains available. Accepted notes stay in the chart; no automatic deletion.

## Requirements and acceptance criteria

- When a permitted clinician provides consent and source text, the system shall return an unsigned narrative suggestion only through the approved private gateway.
- If consent, authentication, scope, synchronized revision, audit persistence or configuration is missing, the system shall deny inference or withhold its result.
- While audio is captured, the interface shall show recording state and provide stop; when closed, hidden or locked, it shall stop capture and discard temporary content.
- When a clinician explicitly approves a suggestion, the system shall replace only the selected narrative section if the local revision still matches.
- The system shall never automatically sign, order treatment or infer normal findings from missing information.

Given a synthetic assigned draft and valid source, generating then reviewing and applying changes only that section and retains provenance. Given another facility or role, direct API submission is denied. Given a concurrent edit or signature, the old suggestion is rejected. Given unsupported source quotes or truncated output, generation fails without chart writes. Given a failed audit store, no inference starts. Given service unavailability, manual documentation remains usable.

## Research and design decisions

Research reviewed September 23, 2026. Doximity's capture → review/edit → chart workflow informed the interaction, not a proprietary implementation or claimed partnership. Tamam deliberately uses hospital-hosted processing and section-level review instead of copying vendor data policies. See [Doximity Scribe](https://www.doximity.com/clinicians/scribe) and [Doximity security](https://www.doximity.com/about/security). Their security claims do not certify Tamam.

Treat source and model output as untrusted, restrict capabilities and validate output: [OWASP prompt injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) and [improper output handling](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/). Human review is necessary; prompting alone is not an enforcement boundary.

Integration references: [vLLM compatible server](https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/), [vLLM structured outputs](https://docs.vllm.ai/en/latest/features/structured_outputs/), [whisper.cpp server contract](https://github.com/ggml-org/whisper.cpp/blob/master/examples/server/README.md). Hardware sizing and specific model selection remain deployment decisions, not verified capabilities of this implementation.

## Verification and remaining work

Automated synthetic tests cover policy, schema/evidence, private endpoint validation, bounded input, CAS application, API CSRF/consent/scope, audit failure and revocation during generation. They use mocked inference—not proof of model quality or hospital integration. See adjacent `*.test.ts` files and `src/app/api/ai-scribe/route.test.ts`.

Remaining release work: hospital infrastructure provisioning, real gateway contract tests, device/browser recording checks, deployment-wide limits, immutable audit export, retention verification and clinical/language acceptance. These are mandatory activation gates, not claims of completed work.

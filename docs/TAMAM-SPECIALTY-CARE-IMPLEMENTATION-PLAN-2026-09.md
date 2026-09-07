# Tamam specialty-care audit and implementation plan

**Audience:** Tamam product, clinical safety, engineering and implementation teams  
**Updated:** 2026-09-07  
**Decision:** Build one reusable specialty-care platform for every Tamam tenant; facilities activate locally approved pathways, terminology, staffing, devices and tariffs.

## Executive answer

Tamam already had strong shared primitives for registration, appointments, triage, consultations, orders/results, pharmacy, procedures, wards, documents, billing and audit. The major gap was not ten separate blank products: it was the absence of a stable department directory and a reusable specialty episode that could connect those primitives while enforcing domain-specific completion rules.

The first implementation tranche is complete. Tamam now has a generic 17-service department catalogue plus structured episode definitions for haemodialysis, dental, operation theatre, cardiac diagnostics, ophthalmology/optical, mental health, dermatology, physiotherapy, paediatrics and obstetrics/gynaecology. The episode engine is offline-first, tenant/facility scoped, RBAC protected, audited and exposed through a working Specialty Care UI. Each pathway has explicit locally-governed safety notes, blocks completion until required fields are present, and cannot accept a new episode until a privileged facility user records a clinical owner, approved SOP reference and pilot/active status.

No tenant, hospital, staffing level, device inventory, price or clinical readiness is assumed. A form existing in software is not evidence that a facility is ready to deliver the service.

## Current-code audit

| Capability | Existing reusable foundation | Added in tranche 1 | Remaining delivery work |
|---|---|---|---|
| Departments | Appointment department text, facility settings | Stable 17-service catalogue, aliases, specialty routing, queues, schedules, reports and versioned local activation | Per-facility content review and clinical owner assignment |
| Haemodialysis | Nephrology consultation, observations, assets, billing | Chair/machine, prescription summary, access safety, pre/post observations, adverse events, disposition | Recurrence/shift planner, machine maintenance link, infection surveillance dashboard |
| Dental | Appointment, consultation, procedure and imaging primitives | Tooth notation, findings, diagnosis, plan, consent, treatment and aftercare schema | Visual odontogram and approved local terminology import |
| Theatre | Procedure lifecycle and operative notes | Team, three staged safety pauses, anaesthesia link, counts/specimens/implants/recovery gates | Theatre calendar, anaesthesia sub-record, configurable locally adapted checklist |
| Cardiac diagnostics | Orders and general results | ECG/echo/Holter/stress order-acquisition-report schema and critical-result communication | Device ingestion and test-specific measurement panels |
| Ophthalmology/optical | Consultation, referrals, inventory/billing primitives | Bilateral acuity/IOP/exam, lens prescription, fulfilment and counselling | Structured lens line items and optical stock reservation |
| Mental health | PHQ-9/GAD-7 and general notes | mhGAP-aligned structured workflow plus encrypted server-only narrative, psychiatry authorization and audited break-glass reads | Local confidentiality/safeguarding policy and production key/configuration verification |
| Dermatology | General notes, procedures, chart images/annotations | Body-site/morphology, diagnosis, photo-consent and document-reference validation | Capture UI controlled by approved consent/retention policy |
| Physiotherapy | Referrals, encounters and procedures | Baseline function, measure/score, goals, session, home programme, repeated score and disposition | Multi-session plan calendar and licensed/local measure catalogue |
| Paediatrics | Age-aware vitals, ETAT triage, nutrition, immunization, order sets | Guardian, age/weight, ETAT signs/action, growth/nutrition, medication-weight check and disposition | Longitudinal growth display and protocol-specific dosing rules |
| Obstetrics/gynaecology | ANC, obstetric notes, maternal triage, births, wards | Care-phase record linking ANC, labour, delivery, newborn and postpartum continuity | Labour Care Guide chart, postpartum/newborn task bundle |
| Admission deposits | Room-class tariff/deposit snapshots and billing/refund primitives | Idempotent linked invoice, payment reconciliation, explicit refund/forfeit/waive decision and real refund posting | Cashier-facing disposition controls and facility policy configuration |

## Architecture

The shared workflow is:

`department/appointment → specialty_care_episode → structured observations and safety gates → review/completion → billing/result/document links`

One `specialty_care_episode` database participates in Tamam's normal offline clinical synchronization. Its document type is allow-listed and its write permission is limited to nursing and clinical roles. Tenant and facility ownership cannot be rewritten after creation. Every mutation appends an event and emits the existing audit/sync signals.

Sensitive mental-health narrative is explicitly rejected by the replicated schema. It will use a separate encrypted, server-only store with specialty authorization and audited break-glass access. This split prevents an apparently restricted UI from leaking narrative through ordinary organization-wide device replication.

## Research translated into requirements

- [CDC dialysis core interventions](https://www.cdc.gov/dialysis-safety/hcp/clinical-safety/index.html) require infection surveillance, hand-hygiene observation, vascular-access care observation, staff competency, education and catheter reduction. This is why an access/infection-safety gate is part of each dialysis session.
- The [WHO Surgical Safety Checklist](https://www.who.int/teams/integrated-health-services/patient-safety/research/safe-surgery/tool-and-resources) uses team pauses before anaesthesia, before incision and before leaving theatre, and calls for local multidisciplinary adaptation. Tamam models the three pauses separately and will version local checklist adaptations.
- [WHO mhGAP-IG 2.0](https://www.who.int/publications/i/item/9789241549790) supports structured assessment and follow-up for priority mental, neurological and substance-use conditions in non-specialist settings. Screening scores alone are not treated as a complete pathway.
- The [WHO Package of Interventions for Rehabilitation](https://www.who.int/publications/i/item/9789240067097) links interventions to conditions, workforce, equipment and consumables. Tamam therefore separates baseline, goals, delivered intervention and repeated outcome.
- [WHO ETAT](https://www.who.int/publications/i/item/9789241510219) emphasizes rapid identification of airway/breathing, shock, coma/convulsion and severe dehydration emergencies in children. Paediatric completion requires danger-sign review and action.
- [WHO intrapartum recommendations](https://www.who.int/publications/i/item/9789241550215) emphasize evidence-based, woman-centred care across labour and childbirth. Tamam records preferences/consent and continuity links rather than duplicating its existing ANC and birth registers.
- [HL7 FHIR ServiceRequest](https://hl7.org/fhir/servicerequest.html) and [DiagnosticReport](https://hl7.org/fhir/diagnosticreport.html) support an order-to-performed-result model, including observations, interpretations and media. Cardiac diagnostics follows that lineage.
- [HL7 FHIR VisionPrescription](https://hl7.org/fhir/visionprescription.html) defines patient, encounter, prescriber and bilateral lens specifications. Tamam's optical pathway preserves this authorization/fulfilment split.
- [ADA dental record guidance](https://www.ada.org/resources/practice/practice-management/writing-in-the-dental-record) treats history, findings, diagnostic material, treatment plan, consent, care and communications as the signed clinical source while keeping finances separate. Tamam follows that separation.

## Sequenced delivery plan

1. **Foundation — implemented:** generic department catalogue, episode types/catalogue/validation/service, offline sync, RBAC, audit trail, dynamic UI, versioned facility activation and tests.
2. **Privacy and finance — implemented foundation:** encrypted restricted mental-health notes; break-glass audit; admission-deposit invoice/reconcile/refund state machine.
3. **Operational depth — next:** dialysis recurrence/chairs, theatre calendar/checklist versions, rehabilitation treatment plans, cardiac acquisition queues.
4. **Specialized interfaces:** odontogram, bilateral lens prescription/optical stock, consent-governed dermatology capture, paediatric growth, WHO Labour Care Guide chart.
5. **Integration:** billing catalogue selection, device/asset references, chart timeline cards, department dashboards and reporting exports.
6. **Clinical release:** local clinical-owner sign-off, simulation/usability testing, configured roles/devices/prices, training, staged feature activation and post-release safety monitoring.

## Release gates and limitations

International guidance defines a safe product baseline but cannot supply a facility's SOP, professional scope, escalation pathway, consent wording, tariff, staffing pattern or equipment configuration. Each pathway therefore needs a versioned local approval before its feature flag is enabled for patient care. Tamam must not label a pathway production-ready merely because the software schema and UI exist.

Research stopped when each consequential workflow requirement had a primary standards source and further searching could not resolve facility-specific policy. Those decisions belong to local governance and configuration, not source-code invention.

# AmbuMed department coverage: canonical research record

Audience: TamamHealth product, clinical, engineering, implementation and AmbuMed validation teams  
Date: 7 September 2026  
Geography: AmbuMed Hospital, Gudele, Juba, South Sudan  
Decision: what TamamHealth can safely ship now, and which specialty workflows require clinical validation before implementation

## Scope and assumptions

This research checks the supplied 13-service assessment and a follow-up six-item screenshot against the current repository and public primary sources. The screenshot names Pharmacy, Paediatrics, Physiotherapy, Obstetrics & Gynaecology, Advanced Operation Theatre, and X-ray and fluoroscopy services. Pharmacy and radiography overlap the original list, leaving four additional distinct service domains. User-supplied and public material is treated as evidence of named services, not evidence of exact staffing, forms, prices, capacity, equipment inventory, or local policy. Published standards inform system design; they do not replace AmbuMed's approved standard operating procedures. The repository audit is at commit/worktree state on 7 September 2026.

Excluded from the first implementation tranche: clinical decision support, specialty-specific defaults, new professional roles, automatic charges, and any AmbuMed tariff. Those require named clinical/financial owners and acceptance criteria.

## Direct answer

AmbuMed's first-party services page verifies the same 13 public service headings in the attachment. It also verifies 80 beds with semi-private, private and VIP admission rooms, theatre radiography, an optician, and haemodialysis/peritoneal dialysis capability. It does **not** publish room prices, admission-deposit rules, dialysis data fields, detailed cardiac modalities, psychiatry instruments, operating-theatre documentation, or role definitions. Those details are design recommendations or unresolved assumptions, not AmbuMed facts.

The follow-up screenshot adds Paediatrics, Physiotherapy, Obstetrics & Gynaecology and Advanced Operation Theatre as distinct coverage areas, while repeating Pharmacy and X-ray/fluoroscopy. It is accepted as user-provided scope, but it does not independently establish that those services are operational or define their clinical workflow.

The repository audit confirms strong shared workflows for pharmacy, inpatient wards, imaging orders and reports, appointments, consultations, billing and audit. It corrects three claims in the supplied assessment:

- PHQ-9 and GAD-7 already exist as structured scored assessment instruments; mhGAP does not.
- Imaging supports six configurable modalities and a six-stage order-to-release workflow, but the default facility catalogue only seeds X-ray and ultrasound. Modality support must not be represented as proof that a specific facility operates every modality.
- Procedure lifecycle and operative-note content exist, but there is no theatre schedule, WHO checklist, anaesthesia chart or implant register.

The safe first tranche is therefore shared infrastructure: first-class facility Department documents linked to new appointments with legacy fallback; appointment-derived queue/report summaries; a controlled specialty vocabulary; configurable room classes/tariffs/deposits with no invented amounts; explicit specialty billing categories; and public website delivery-state copy.

## Evidence reconciliation matrix

| Material claim | Evidence | Finding | Confidence / gap |
| --- | --- | --- | --- |
| AmbuMed advertises 13 named services | [AmbuMed Services](https://www.ambumed.org/services-2) lists Radiology, In-patient Services, Orthopaedic Surgery, Pharmacy, Heamodialysis, Cardiology, Dermatology, CT Scan, Dental, Psychiatry, Specialist Internal Medicine, Ophthalmology and Nephrology | Verified public claim | High for advertised headings; operational readiness not independently inspected |
| AmbuMed has 80 beds in semi-private, private and VIP rooms | [AmbuMed Services](https://www.ambumed.org/services-2) | Verified public claim | High for website claim; room inventory/configuration needs on-site confirmation |
| AmbuMed requires admission deposits or particular tariffs | No amount or deposit policy appears on AmbuMed's public services page | Not verified | Must be supplied and approved by AmbuMed finance |
| Departments should be linkable services with schedules | [HL7 FHIR HealthcareService](https://hl7.org/fhir/healthcareservice.html) describes services at locations and their use with Schedule and Appointment | Supported design recommendation | High; local codes/names remain facility policy |
| Charges need stable codes, patient/encounter links and cost-centre attribution | [HL7 FHIR ChargeItem](https://hl7.org/fhir/R5/chargeitem-definitions.html) and [ChargeItemDefinition](https://fhir.hl7.org/fhir/chargeitemdefinition.html) | Supported design recommendation | High; prices and payer rules remain local |
| Dental charting should use stable tooth identifiers | [ISO 3950:2016](https://www.iso.org/standard/68292.html) defines a two-digit designation system | Supported recommendation | High; implementation needs dental sign-off and licensing review for detailed content |
| Theatre checklist should follow WHO's three pause points and be locally adapted | [WHO Surgical Safety Checklist implementation manual](https://www.who.int/publications/i/item/9789241598590) | Supported recommendation | High; checklist deployment requires local champions, training and adaptation |
| Dialysis module needs explicit infection-prevention controls and auditability | [CDC Dialysis Safety tools](https://www.cdc.gov/dialysis-safety/hcp/tools/index.html) includes haemodialysis IPC, hand-hygiene, medication and station-disinfection tools | Supported recommendation | High; clinical session dataset still needs renal-team approval |
| Cardiac diagnostics fit request → observation/report workflow | [FHIR DiagnosticReport](https://hl7.org/fhir/R4/diagnosticreport.html) explicitly includes cardiology and links requests, atomic observations, attachments and interpretations | Supported recommendation | High; exact ECG/echo/Holter device interfaces unresolved |
| Optical dispensing needs a prescription object distinct from the clinical exam | [FHIR VisionPrescription](https://hl7.org/fhir/R4B/visionprescription-definitions.html) covers authorization for glasses/contact lenses | Supported recommendation | Moderate (trial-use resource); local optical workflow unresolved |
| Mental-health content warrants security labels and audited emergency override | [FHIR Security Labels](https://fhir.hl7.org/fhir/security-labels.html) defines confidentiality labels and break-the-glass expectations; [AuditEvent](https://fhir.hl7.org/fhir/auditevent-definitions.html) supports security-relevant audit | Supported recommendation | High conceptually; exact South Sudan/AmbuMed policy needs legal/clinical approval |
| mhGAP is appropriate for non-specialist mental-health pathways | [WHO mhGAP-IG 2.0](https://www.who.int/publications/i/item/9789241549790) provides assessment/treatment algorithms and follow-up for non-specialized settings | Supported recommendation | High; not currently implemented in repository |
| Diagnoses should retain controlled ICD identifiers | [WHO ICD API v2](https://icd.who.int/docs/icd-api/APIDoc-Version2/) recommends ICD-11 MMS linearization endpoints for ICD-11 codes and stable entity URIs | Supported recommendation | High; offline terminology release/version governance remains required |
| Full facility-level database authorization is complete | `docs/FACILITY-ISOLATION.md` says it is partially implemented and client-supplied selectors are not a true read boundary | Disproved | High; do not market as complete |
| Paediatric emergency workflow should retain age-aware rapid triage | [WHO ETAT](https://www.who.int/publications/i/item/9789241510219) addresses rapid identification and treatment of critically ill children | Supported recommendation | High; local escalation, dosing and admission protocols still require approval |
| Physiotherapy needs plans, goals, repeated outcome measures and resource attribution | [WHO Package of interventions for rehabilitation](https://iris.who.int/bitstream/handle/10665/370502/9789240067097-eng.pdf?sequence=1) describes interventions, delivery time, materials and workforce resources across priority conditions | Supported recommendation | High for service-design structure; exact measures and protocols remain local |
| Obstetric intrapartum records require standardized monitoring and timely escalation | [WHO intrapartum recommendations](https://www.who.int/publications/i/item/9789241550215) and the [Labour Care Guide implementation package](https://www.who.int/publications/i/item/9789240109346) | Supported recommendation | High; local maternity protocol and emergency pathways must be approved |

## Research gap matrix and follow-up

| Gap | Why consequential | Next evidence required |
| --- | --- | --- |
| Actual AmbuMed department roster, locations, hours and clinic days | Determines Department configuration and schedule | Signed directory from hospital administrator |
| Room inventory by class, approved nightly tariffs, deposit/refund policy | Financial and patient-facing impact | Finance-approved tariff sheet and policy version |
| Dialysis chair/machine inventory, shifts, session form, escalation protocol | Safety-critical workflow | Renal lead SOP and sample de-identified form |
| Dental numbering system and procedure catalogue | Avoids incompatible odontogram | Dental lead decision: ISO 3950/FDI plus local catalogue |
| Theatre list, checklist adaptations, anaesthesia form and implant traceability | Perioperative safety and device recall | Theatre/anaesthesia SOP set and accountable signatories |
| Eye exam conventions and optical stock/order flow | Prevents ambiguous laterality/refraction data | Ophthalmology/optician form samples and dispensing policy |
| Cardiology modalities and device exports | Determines ECG waveform/PDF/DICOM strategy | Equipment makes/models, exports and reporting templates |
| Mental-health confidentiality, consent and emergency-access policy | High-sensitivity PHI | Approved access matrix, disclosure/consent and break-glass review policy |
| Dermatology consent, image retention and body-site metadata | Sensitive clinical photography | Photography/consent SOP and retention schedule |
| Paediatric clinic scope, age bands, emergency escalation and dose governance | Adult defaults can be unsafe for children | Paediatric lead protocols, formulary and de-identified forms |
| Physiotherapy assessment, goals, outcome measures, session plans and assistive-device catalogue | Longitudinal progress and resource use cannot be inferred from a generic encounter | Rehabilitation lead forms, approved measures, equipment and tariff catalogue |
| Obstetrics/gynaecology service boundaries and theatre relationship | ANC, labour, delivery, gynaecology and emergency surgery have different safety gates | Maternity/gynaecology forms, escalation policy and accountable clinical owners |

## Search record and stop test

Discovery covered AmbuMed first-party services, the user-supplied service screenshots, an independent UK government facility listing, WHO, HL7, ISO, CDC, DICOM and WHO ICD-11 sources. Follow-up targeted unsupported room/deposit claims, mental-health privacy, cardiac diagnostic exchange, coding, paediatric triage, rehabilitation and maternity care. Research stopped when every consequential first-tranche decision had primary support or an explicit AmbuMed validation gap; additional generic hospital sources would not raise confidence in AmbuMed-specific details.

## Claim-to-source ledger

| Source | Publisher | Date/version | URL | Access note |
| --- | --- | --- | --- | --- |
| Services | AmbuMed Hospital | accessed 2026-09-07 | https://www.ambumed.org/services-2 | First-party public service descriptions |
| South Sudan: medical facilities | UK Foreign, Commonwealth & Development Office | current page accessed 2026-09-07 | https://www.gov.uk/government/publications/south-sudan-doctors/south-sudan-medical-facilities--2 | Independent corroboration of hospital identity/general service listing |
| HealthcareService / Schedule | HL7 International | FHIR R5, 5.0.0 | https://hl7.org/fhir/healthcareservice.html | Official standard, trial-use maturity noted |
| ChargeItem / ChargeItemDefinition | HL7 International | FHIR R5, 5.0.0 | https://hl7.org/fhir/R5/chargeitem-definitions.html | Official standard |
| DiagnosticReport | HL7 International | FHIR R4, 4.0.1 | https://hl7.org/fhir/R4/diagnosticreport.html | Official standard; explicitly includes cardiology |
| VisionPrescription | HL7 International | FHIR R4B, 4.3.0 | https://hl7.org/fhir/R4B/visionprescription-definitions.html | Official standard, maturity level 2/trial use |
| Security labels / AuditEvent | HL7 International | FHIR R5, 5.0.0 | https://fhir.hl7.org/fhir/security-labels.html | Official standard; implementation policy remains local |
| Surgical Safety Checklist implementation manual | World Health Organization | 2009 | https://www.who.int/publications/i/item/9789241598590 | Official WHO manual |
| mhGAP Intervention Guide 2.0 | World Health Organization | 2016, page updated 2019 | https://www.who.int/publications/i/item/9789241549790 | Official WHO guidance |
| Dialysis Safety resources and tools | US Centers for Disease Control and Prevention | updated 2024, accessed 2026-09-07 | https://www.cdc.gov/dialysis-safety/hcp/tools/index.html | Official IPC/audit tools |
| ISO 3950:2016 | International Organization for Standardization | 2016 | https://www.iso.org/standard/68292.html | Official abstract; full standard not reviewed |
| ICD API documentation v2 | World Health Organization | v2, accessed 2026-09-07 | https://icd.who.int/docs/icd-api/APIDoc-Version2/ | Official API and coding guidance |
| DICOM waveform supplement | DICOM Standards Committee | Supplement 30 | https://www.dicomstandard.org/News-dir/ftsup/docs/sups/sup30.pdf | Official cardiology-waveform interchange background |
| Follow-up six-service image | User supplied | received 2026-09-07 | local conversation attachment | Scope input only; no operational claims inferred |
| Paediatric emergency triage, assessment and treatment | World Health Organization | 2016 updated guideline | https://www.who.int/publications/i/item/9789241510219 | Official low-resource paediatric emergency guidance |
| Package of interventions for rehabilitation | World Health Organization | 2023 | https://iris.who.int/bitstream/handle/10665/370502/9789240067097-eng.pdf?sequence=1 | Official rehabilitation service-planning resource |
| Intrapartum care recommendations / Labour Care Guide package | World Health Organization | 2018 / 2025 | https://www.who.int/publications/i/item/9789241550215 | Official maternal-care guidance; local protocol remains controlling |

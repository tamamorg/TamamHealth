# Visit financial clearance: research and implementation design

Date: 2026-09-10. Status: payment-evidence review implemented locally; mandatory service-clearance enforcement is not implemented.

## Implementation progress

- Existing patient Billing tab now has a scoped, visit-specific financial evidence review with invoice links and independent currency amounts. No invoice remains Not reviewed. Paid labels require finalized invoices and matching non-reversed receipt allocations. Conflicting records fail to reconciliation; insurance approval, zero-value bills and legacy waivers do not silently authorize care.
- This is an evidence view, **not** a complete clearance decision or a gate. Persisted service-specific insurance/sponsor/waiver/credit approvals, emergency exceptions, service-boundary enforcement and replication/API authorization remain to be implemented before activation.
- Payment-plan dialog preserves selections on error, prevents closure while saving, and requires explicit acknowledgement after success. Currency-specific ledger loading replaces the mixed-currency fallback. Currency is stored on newly created plans. Month-end scheduling and minor-unit installment rounding are corrected and tested.
- The broader legacy account totals and plan-payment allocation service still require currency/authorization auditing. No historical plans or patient records were migrated, no emergency/discharge restrictions were added, and nothing was deployed.
- Browser checks: no-invoice synthetic visit shows Not reviewed; zero-balance plan cannot advance and explains why; seeded account plan creation completed through term selection, review, save, explicit Close, and refreshed account showing a six-month plan. This is not the complete claims/service-clearance journey.
- Remaining high-priority defect: `BillingWorkspace.handleRecordPlanPayment` constructs a `PAY-${Date.now()}` reference without collecting a payment, and `recordPlanPayment` currently accepts it. This legacy installment path must be replaced with actual scoped receipt allocation before treating the billing workflow as end-to-end complete. Plan creation does not exercise or fix that path.
- Regression: new evidence/plan tests pass; initial full suite exposed dark-theme/reachability issues (fixed, targeted checks passed). Subsequent full run had two timeouts in demo-login/pharmacy tests; both passed in an isolated 16-test run. Do not report a clean full-suite run from this evidence.

## Evidence reviewed

- User-supplied Sanitas screenshots: patient registration, clinic queue/visit settings, and invoices. These are workflow references, not a complete specification or proof of South Sudan law. No patient identifiers from the screenshots are reproduced here.
- Local Tamam demo: the completed synthetic visit has no charges, payments or insurance, yet its chart shows SSP 0 due. Therefore a zero balance is not evidence of financial review.
- `billing-service.ts`: bill finalization, payment recording, adjustments and waivers exist. Core finalization/payment functions accept actor identifiers but not a mandatory DataScope; a new approval must not rely on caller-supplied names or UI role checks alone.
- `insurance-workflow-service.ts`: explicit billing-role/scope checks, manual evidence, claim receipts and settlement reconciliation already exist. Local eligibility estimates are not payer verification. Approval is not recorded as cash settlement.
- `checkout-gate-service.ts`: payment is advisory, intentionally not a reason to detain a patient. It is not a pre-service clearance gate.
- `ledger-service.ts:getPatientBalance`: sums amounts across the patient's ledger without currency grouping. Do not reuse this scalar to authorize care or claim currency-specific settlement.
- Focused source review did not find a unified financial-clearance check in check-in or rooming services.

## Primary research

1. [Smart South Sudan: Smart Access](https://southsudan.smartapplicationsgroup.com/smart-access/): describes online preauthorization and notifications to the scheme administrator, member and hospital. Public product descriptions are not integration credentials, insurer contracts or an API specification.
2. [HL7 FHIR R5 CoverageEligibilityResponse](https://hl7.org/fhir/coverageeligibilityresponse.html): distinguishes coverage validity, benefit details and whether requested services require preauthorization.
3. [HL7 FHIR R5 ClaimResponse](https://www.hl7.org/fhir/claimresponse.html): distinguishes adjudication/authorization from payment; preauthorization does not itself make a payment.
4. [WHO emergency care resolution WHA72.16](https://www.who.int/publications/i/item/WHA72.16) and [WHO GETI](https://www.who.int/initiatives/global-emergency-and-trauma-care-initiative): support timely emergency care and access without regard to ability to pay. This is clinical-policy guidance, not a claim about a specific local statute.

## Screenshot field mapping

| Reference field group | Required Tamam treatment |
| --- | --- |
| Patient number and visit number | Separate stable patient ID from encounter ID; every clearance names the encounter. |
| Names, DOB, gender, nationality, ID/document type, marital status, category | Identity/registration, not financial approval. Missing documents must not prevent emergency assessment. |
| Phone/country code, city, locality, postal details | Contact/routing data; phone sharing is valid and must not merge patients. |
| Emergency contact name, relationship, phone, email, ID | Keep separate from payer/guarantor and consent authority. |
| Medical cover | Insurer/sponsor, scheme, member/dependent, effective dates, service benefits, verification source/reference/time/expiry. |
| Debtor/staff account, department, legacy number, tax PIN | Optional account linkage; do not assume a linked employer or staff account guarantees payment. |
| Clinic + visit type | Facility-configured services, not hardcoded insurer tariffs. |
| Applicable clinic charges + cost | Itemized approved price catalogue, currency, effective date, quantity and visit linkage. |
| Clinician assignment + patients seen | Clinical routing remains separate from clearance; financial data visible only as necessary. |
| Scheme + authorization code | Validate against the selected patient, policy, visit, service and validity period; text alone is not approval. |
| Waiver | Authorized reason, approver, amount/currency, visit/services covered and expiry where applicable. |
| Pricing package | Versioned negotiated tariff; selecting a package does not settle the bill. |
| Token, referring facility/physician, arrival mode, brought by, facility reference, notes | Preserve visit logistics independently of payment. |
| Invoice number, visit number, currency, invoiced/paid/pending amount | Currency-separated ledger and invoice reconciliation; do not net SSP against USD. |
| Invoice status, creation/paid dates, billing stage, settlement mode/package | Separate financial lifecycle from clinical stage, with timestamped evidence. |
| Receipts, settlement summary, claims/debt, refunds, voids, deposits, audit | Reversals must revoke affected clearance and preserve audit history; use idempotent writes. |

## Proposed full flow

1. Reception identifies/registers the patient and opens an encounter. Select payer pathway: self-pay, insurer, sponsor/employer, waiver/free service or credit agreement.
2. Nursing performs triage and identifies urgent/emergency needs. Payment must not block this assessment or time-critical treatment.
3. For routine chargeable care, billing selects the actual service and approved tariff, finalizes the invoice/estimate and determines the patient's share.
4. An authorized finance user records evidence: allocated receipt, insurer service authorization, accepted sponsor guarantee, approved waiver/free-care decision or approved credit arrangement. A blank bill, zero balance, active policy or queued claim alone does not pass.
5. Clearance is issued for this visit and named services only. The placement of the mandatory checkpoint requires facility confirmation: recommended before routine consultation and again before additional separately charged services.
6. Clinician sees the clinical worklist and a concise financial indicator. New orders receive their own coverage/cost evaluation. Clinical need and financial approval remain distinct.
7. Labs/imaging/procedures/pharmacy check the relevant service clearance at the service boundary. Emergency/urgent exceptions record the clinical actor and reason without awaiting cashier approval.
8. Patient returns to nursing for ordered treatment coordination, education, instructions and follow-up. Financial checks never mark nursing tasks complete automatically.
9. Reception performs clinical checkout; billing reconciles charges, receipts and insurer/sponsor receivables. Outstanding money remains a financial obligation, not a mechanism to detain the patient.
10. Claims proceed through queued, acknowledged, adjudicated and paid states. Only actual settlement posts an insurer payment; retry must not duplicate receipts.

## Three-perspective implementation

### Frontend

- Extend the existing Billing history tab, bill detail and reception row; no parallel patient application.
- Show clinical status separately from financial status: Not reviewed, Awaiting payment, Awaiting authorization, Cleared (cash/cover/waiver/credit), Partially cleared, Expired/review required, Emergency exception.
- Status always includes next action and a link to the existing billing workspace. Clinical users do not need bank or policy details.
- Approval form: encounter, service IDs, payer route, invoice/reference, currency/amount, patient share, evidence source/reference, approver, verification and expiry times, reason.
- Pending/error/offline states must never look approved. Keep entered information when verification fails. English/Juba Arabic and accessible text/icon labels are required.

### Services and persistence

- Implement in existing offline service architecture with a scoped clearance decision and central evaluator; do not route all offline writes through HTTP.
- Require concrete reviewed services. No invoice is Not reviewed, not Cleared. Free care requires a configured entitlement or authorized decision.
- Validate current bill/receipt/authorization revisions immediately before permitted service transitions. Include invoice changes, payment reversal, expired evidence, new orders and sync conflicts in invalidation.
- Group balances by currency; allocations must match currency or use an explicitly recorded exchange transaction.
- Only provider-contracted authorization can replace patient payment for covered services. Record uncovered balances/copays separately.
- Offline mode preserves verifiable local cash evidence; never manufacture remote insurer approval. Facility policy must define acceptance of current cached/manual evidence and subsequent reconciliation.
- Do not bulk-approve historical records. Existing visits without evidence become Not reviewed for financial decisions, while emergency and clinical records remain accessible.

### Security

- Mandatory actor identity and DataScope at all approval/mutation boundaries. Revalidate patient, visit, bill and policy links within org/facility.
- Define approved finance roles; clinicians cannot silently approve payments, and reception cannot impersonate a finance approver.
- Mirror permitted transitions and actor checks in replication validators and API entrypoints; local UI checks alone are insufficient.
- Auditable approval/revocation with reference, reason and timestamp. Never store card secrets or infer biometric verification from a typed identifier.
- Fail closed for routine financial authorization on unreadable evidence or conflicting revisions; preserve emergency access.

## Acceptance tests before activation

- No invoice/zero ledger, draft bill, partial payment and unpaid routine visit do not gain clearance.
- Finalized paid bill clears only its covered visit/services/currency; duplicate receipt retries have no extra effect.
- Same patient, different visit or different facility cannot reuse clearance.
- Verified policy without required service authorization does not pass; denied/expired/queued/local estimate never passes as payer approval.
- Authorized sponsor/waiver/free-care/credit paths retain evidence without falsely marking cash paid.
- New service, edited bill, refund/reversal and changed authorization revoke or narrow clearance.
- Mixed SSP/USD accounts cannot net to zero or pay each other implicitly.
- Nurse/doctor cannot forge finance approval; out-of-scope IDs and sync conflicts fail safely.
- Emergency assessment/time-critical care proceeds with an audited exception; no financial detention at discharge.
- Browser demo covers reception → triage → clearance → consultation → newly ordered service → nursing → clinical checkout → financial reconciliation.

## Decisions still required

- Mandatory routine-care checkpoint and which service categories need separate approval.
- Facility-approved tariffs, payer contracts, copays, sponsor/credit/waiver authorities, emergency exception policy and offline evidence validity.
- Smart integration agreement, sandbox/API documentation, credentials, payer/facility identifiers and supported authorization/receipt flows. None are established by the public website or screenshots.

No new financial gate has been enabled by this audit. Blocking care globally without these decisions would be unsafe and could misrepresent insurance authorization.

# Guided billing pop-ups

Preserve the existing clinical blue tokens, typography and modal shell. Remove the activity filter dropdown; search and pagination remain. Move the existing superbill picker and draft into a service dialog. Only offer continuation after successful posting with no unposted lines; errors retain the draft. Payment collection remains the existing scoped service, not a new gateway.

Payment methods become visible, mutually exclusive buttons with method-specific instructions. Cash requires cash received; mobile/bank/card require external confirmation before manual recording. Insurance eligibility is not settlement; waiver approval is not cash. Do not collect PAN, CVV or PIN. Existing backend authorization and validation remain necessary; this UI does not establish gateway verification.

Research: PCI SSC prohibits retention of card verification values after authorization: https://www.pcisecuritystandards.org/faqs/are-merchants-allowed-to-request-card-verification-codes-values-from-cardholders/ . Smart Applications describes eligibility and claims as distinct integration functions: https://smartapplicationsgroup.com/medical-insurance-software/ .

Acceptance: no activity dropdown; services open in a modal, successful posting enables payment continuation, failure cannot continue; payment choices expose relevant fields and instructions; existing receipt flow stays intact.

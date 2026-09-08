# Local demo browser test — 7 September 2026

## Environment

Latest working-tree code served at http://127.0.0.1:3001 with a separate Next build directory. Demo mode enabled only for this process; CouchDB credentials/URLs and analytics database URLs disabled, browser sync disabled. A process-only random seed secret avoided an existing seed-credentials file configuration that produced EISDIR. No deployment configuration files or real clinic data changed.

## Browser-verified results

- Doctor demo account signs in to the clinical dashboard.
- Module menu → Departments navigation works. The fresh demo initially had no departments. Using the medical-superintendent demo account, the existing provision action populated the facility catalogue; department → specialty workflow navigation then worked.
- Unactivated paediatric pathway blocks episode creation. Synthetic pilot configuration with clearly marked demo-only owner/SOP saves.
- Registered patient selection fills the canonical patient name and offers linked appointments. A planned paediatric episode was created with a selected appointment.
- ETAT “None identified” and a danger sign deselect one another.
- Required-field errors block completion before data entry.
- Decimal weight 12.35, age, narrative fields, explicit Not applicable and Home disposition save successfully.
- Planned → In progress → Completed transitions work. Completed fields become read-only.
- After a browser reload, the completed episode and its values remain available.
- Switching to the mhGAP pathway clears the prior patient/form context. A second synthetic patient's episode was created.
- Expanded mhGAP conditions, including dementia, alcohol/drug use and self-harm, render. Dementia selection and a referral suggestion saved in a structured draft. The suggestion populates the free-text field and resets the suggestion picker as designed.
- Visual screenshot inspection confirmed the completed paediatric form renders with the platform styling and visible units/help.

## Failures / limitations

- Server-only restricted mental-health notes cannot load without CouchDB. The UI currently displays the raw server configuration error. This is not a successful encrypted-note integration test.
- Server logs show failed server-backed audit, hospital, preferences and usage-event requests without CouchDB. The superintendent dashboard displayed zero staff; staff/equipment lookup completeness is not verified by this run.
- Browser persistent-storage permission was denied. Records survived reload, but this does not prove resilience to browser eviction or device failure.
- No sync, backup restoration, payment/refund browser flow, full cross-role access matrix, or exhaustive whole-app browser test was completed in this run. Earlier automated-test results are separate evidence, not replacements for these checks.

Synthetic records remain in this demo origin: one completed paediatric episode and one planned mhGAP draft. Only these two pathways were configured as demo pilots; the references are explicitly not clinical approvals. The original app on port 3000 was left unchanged.

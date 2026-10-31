/**
 * Demo chart documents — the files that appear under a patient chart's
 * Documents section (Documents / Referrals / Patient education).
 *
 * `PatientDocumentDoc` stores a real file payload, so seeded rows need real
 * bytes: a hard-coded base64 blob would be unreadable in review and a 1×1 PNG
 * placeholder makes the preview useless. Instead each document is generated as
 * a genuine one-page PDF built here — small (≈1–2 KB), readable in the chart's
 * preview iframe, and defined by its title and body lines rather than by an
 * opaque string.
 *
 * Demo data only; the production seed never calls this.
 */
import type { PatientDocumentCategory, PatientDocumentDoc } from './db-types';

/** PDF text strings escape these three characters. */
function escapePdfText(text: string): string {
  return text
    // Non-ASCII would break the byte-offset arithmetic below, which assumes one
    // byte per character. Demo copy is ASCII; anything else degrades to '-'.
    .replace(/[^\x20-\x7E]/g, '-')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * A minimal but valid single-page PDF: catalogue, page tree, one page, a
 * content stream, two Helvetica fonts, and a cross-reference table with real
 * byte offsets (viewers reject a table whose offsets don't line up).
 */
export function buildSeedPdf(title: string, lines: string[]): { base64: string; sizeBytes: number } {
  const content = [
    `BT /F1 15 Tf 56 782 Td (${escapePdfText(title)}) Tj ET`,
    ...lines.map((line, i) => `BT /F2 11 Tf 56 ${750 - i * 18} Td (${escapePdfText(line)}) Tj ET`),
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
      + '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  // Assemble body, recording where each object starts — the xref table is a
  // byte index, so it has to be built alongside the bytes.
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return { base64: btoa(pdf), sizeBytes: pdf.length };
}

export interface SeedDocumentDef {
  id: string;
  patientId: string;
  title: string;
  category: PatientDocumentCategory;
  /** Body lines of the generated PDF. */
  lines: string[];
  note?: string;
  uploadedByName: string;
  hospitalId: string;
  /** Filed this many days before "today", so the list has a real ordering. */
  daysAgo: number;
}

/**
 * Three patients carry a full set — a general document, a referral letter and
 * an education handout — so one chart demonstrates all three views of the
 * section. These are the same patients that have seeded referrals and
 * patient-education messages (pat-00001, pat-00005, pat-00012).
 */
export const seedPatientDocumentDefs: SeedDocumentDef[] = [
  // ── Deng Mabior Garang (pat-00001) — cardiology referral from Wau ──
  {
    id: 'pdoc-seed-001', patientId: 'pat-00001', category: 'radiology',
    title: 'Chest X-ray report — PA view',
    lines: [
      'Juba Teaching Hospital — Department of Radiology',
      'Examination: Chest radiograph, postero-anterior.',
      '',
      'Findings: Cardiothoracic ratio increased at 0.56. Lung fields clear,',
      'no consolidation or effusion. No pneumothorax. Bony thorax intact.',
      '',
      'Impression: Cardiomegaly. Echocardiography advised.',
      '',
      'Reported by Dr. Achol Mayen Deng',
    ],
    note: 'Film reported the same day', uploadedByName: 'Dr. Achol Mayen Deng',
    hospitalId: 'hosp-001', daysAgo: 6,
  },
  {
    id: 'pdoc-seed-002', patientId: 'pat-00001', category: 'referral_letter',
    title: 'Referral letter — Wau State Hospital',
    lines: [
      'Wau State Hospital — Outpatient Department',
      'To: Cardiology, Juba Teaching Hospital',
      '',
      'Dear colleague,',
      '',
      'I am referring this patient for echocardiography. He reports exertional',
      'breathlessness over three months with ankle swelling in the evenings.',
      'Blood pressure 158/96 on two readings. No chest pain at rest.',
      '',
      'Started on hydrochlorothiazide 25mg daily. Grateful for your assessment.',
      '',
      'Dr. Achol Mayen Deng',
    ],
    note: 'Letter accompanying referral ref-001', uploadedByName: 'Front desk — Juba',
    hospitalId: 'hosp-001', daysAgo: 5,
  },
  {
    id: 'pdoc-seed-003', patientId: 'pat-00001', category: 'patient_education',
    title: 'Living with high blood pressure',
    lines: [
      'What high blood pressure means',
      '',
      'Blood pressure is the force of blood against the walls of your arteries.',
      'When it stays high it slowly damages the heart, kidneys and eyes, often',
      'without any symptoms at all.',
      '',
      'What helps:',
      '  - Take your tablets every day, even when you feel well.',
      '  - Use less salt. Do not add salt at the table.',
      '  - Walk for 30 minutes most days.',
      '  - Avoid tobacco; limit alcohol.',
      '',
      'Come back sooner if you have chest pain, severe headache, or breathless-',
      'ness when lying flat.',
    ],
    note: 'Given at discharge and explained in Dinka', uploadedByName: 'Nurse Stella Keji Lemi',
    hospitalId: 'hosp-001', daysAgo: 5,
  },
  {
    id: 'pdoc-seed-004', patientId: 'pat-00001', category: 'consent',
    title: 'Consent — echocardiography',
    lines: [
      'The procedure, its purpose and its risks were explained to the patient in',
      'a language he understands. The patient consents to the examination and to',
      'the storage of the images in his medical record.',
      '',
      'Signed by the patient and witnessed by the attending nurse.',
    ],
    uploadedByName: 'Nurse Stella Keji Lemi', hospitalId: 'hosp-001', daysAgo: 4,
  },

  // ── Nyamal Koang Gatdet (pat-00005) — ANC ──
  {
    id: 'pdoc-seed-005', patientId: 'pat-00005', category: 'radiology',
    title: 'Obstetric ultrasound — 28 weeks',
    lines: [
      'Juba Teaching Hospital — Department of Radiology',
      'Examination: Obstetric ultrasound, second trimester.',
      '',
      'Single live intrauterine fetus, cephalic presentation. Fetal heart rate',
      '148 bpm. Biometry consistent with 28 weeks and 2 days. Placenta anterior,',
      'clear of the os. Amniotic fluid volume normal.',
      '',
      'Impression: Normal single pregnancy at 28 weeks.',
    ],
    uploadedByName: 'Dr. Achol Mayen Deng', hospitalId: 'hosp-001', daysAgo: 3,
  },
  {
    id: 'pdoc-seed-006', patientId: 'pat-00005', category: 'referral_letter',
    title: 'Referral letter — Wau State Hospital',
    lines: [
      'Wau State Hospital — Maternity',
      'To: Obstetrics, Juba Teaching Hospital',
      '',
      'Referring a 28-week pregnancy with mild pre-eclampsia for specialist',
      'review. Blood pressure 146/94, trace proteinuria, no visual symptoms.',
      'Fetal movements reported as normal.',
      '',
      'Dr. Achol Mayen Deng',
    ],
    uploadedByName: 'Front desk — Juba', hospitalId: 'hosp-001', daysAgo: 3,
  },
  {
    id: 'pdoc-seed-007', patientId: 'pat-00005', category: 'patient_education',
    title: 'Danger signs in pregnancy',
    lines: [
      'Come to the hospital straight away if you have any of these:',
      '',
      '  - Bleeding from the vagina',
      '  - Severe headache, or blurred vision',
      '  - Swelling of the face or hands',
      '  - Fever, or pain when passing urine',
      '  - The baby moving less than usual',
      '  - Waters breaking before your due date',
      '',
      'Keep taking iron and folate tablets every day. Attend every antenatal',
      'appointment, and plan to deliver at a health facility.',
    ],
    note: 'Explained to the patient and her sister', uploadedByName: 'Nurse Stella Keji Lemi',
    hospitalId: 'hosp-001', daysAgo: 3,
  },

  // ── Gatluak Ruot Nyuon (pat-00012) — TB ──
  {
    id: 'pdoc-seed-008', patientId: 'pat-00012', category: 'discharge_summary',
    title: 'Discharge summary — TB ward',
    lines: [
      'Juba Teaching Hospital — Tuberculosis Unit',
      '',
      'Admitted with two months of cough, night sweats and weight loss. Sputum',
      'smear positive. Started on standard four-drug regimen; tolerated well.',
      'Weight on discharge 54 kg, up 1.5 kg from admission.',
      '',
      'Plan: continue treatment for six months, monthly review, sputum at two',
      'months. Household contacts to be screened.',
    ],
    uploadedByName: 'Dr. James Wani Igga', hospitalId: 'hosp-001', daysAgo: 2,
  },
  {
    id: 'pdoc-seed-009', patientId: 'pat-00012', category: 'referral_letter',
    title: 'Referral letter — Wau State Hospital',
    lines: [
      'Wau State Hospital — Outpatient Department',
      'To: Tuberculosis Unit, Juba Teaching Hospital',
      '',
      'Referring for initiation of TB treatment and follow-up closer to the',
      'family home. Sputum smear positive, HIV negative, no prior treatment.',
      '',
      'Dr. James Wani Igga',
    ],
    uploadedByName: 'Front desk — Juba', hospitalId: 'hosp-001', daysAgo: 2,
  },
  {
    id: 'pdoc-seed-010', patientId: 'pat-00012', category: 'patient_education',
    title: 'Taking your TB treatment',
    lines: [
      'Why every dose matters',
      '',
      'TB medicines only work if you take them every day for the full six',
      'months. Stopping early lets the illness return in a form that is much',
      'harder to treat.',
      '',
      '  - Take all tablets together, at the same time each day.',
      '  - Bring your treatment card to every visit.',
      '  - Tell the nurse if you feel sick, itch, or your eyes turn yellow.',
      '  - Cover your mouth when you cough for the first two weeks.',
      '',
      'Everyone living in your house should be checked for TB.',
    ],
    uploadedByName: 'Nurse Stella Keji Lemi', hospitalId: 'hosp-001', daysAgo: 1,
  },
];

/** Builds the document, PDF payload and all, for a seed definition. */
export function buildSeedPatientDocument(
  def: SeedDocumentDef,
  filedAt: string,
  orgId: string,
): PatientDocumentDoc {
  const { base64, sizeBytes } = buildSeedPdf(def.title, def.lines);
  return {
    _id: def.id,
    type: 'patient_document',
    patientId: def.patientId,
    title: def.title,
    category: def.category,
    fileName: `${def.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.pdf`,
    mimeType: 'application/pdf',
    base64Data: base64,
    sizeBytes,
    note: def.note,
    uploadedByName: def.uploadedByName,
    hospitalId: def.hospitalId,
    orgId,
    createdAt: filedAt,
    updatedAt: filedAt,
  };
}

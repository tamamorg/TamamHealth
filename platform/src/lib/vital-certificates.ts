/**
 * Printable vital-event papers a facility issues from its registers.
 *
 * - **Notification of Birth.** Under the Civil Registry Act 2018 (Act No. 1,
 *   ss. 8(6), 24) the birth CERTIFICATE is issued by the Civil Registry; a
 *   health institution sends a birth notification within 45 days, and the
 *   family exchanges it for the certificate. So the facility paper is titled
 *   a notification and says so at its foot. Content follows the UN core birth
 *   topics: when and where, attendant, type of birth, sex, weight, parents.
 * - **Medical Certificate of Cause of Death.** The WHO international form
 *   (ICD-11 Reference Guide, Annex 3.14.1): administrative data, Frame A
 *   (Part 1 lines a–d with the interval from onset, Part 2), Frame B (surgery,
 *   autopsy, manner of death, external cause, fetal or infant death,
 *   pregnancy), then a certifier block. It doubles as the facility's death
 *   notification under s. 28 of the Act.
 *
 * What the register holds prints filled in; what the form asks for and the
 * register does not keep (time of birth, informant, onset intervals, surgery,
 * autopsy) prints as a blank line or empty box for the certifier to complete
 * by hand, as on the paper form. Monochrome and photocopier-safe, in the same
 * Arial and page footer as every other TamamHealth printout.
 */
import type { BirthRegistrationDoc, DeathRegistrationDoc } from './db-types';
import { CLINICAL_PRINT_CSS } from './print-document';
import { getPrintIdentity, pageFooterCss, printDate } from './print-identity';
import { escapeHtml, openIsolatedHtmlWindow } from './safe-html';

const CERT_CSS = `
  body { font-size:8.8pt; line-height:1.35; }
  .cert { border:1.5pt solid var(--ink); outline:.5pt solid var(--ink); outline-offset:1mm; padding:5mm 6.5mm 4mm; }
  .cert-head { text-align:center; padding-bottom:2.5mm; border-bottom:.75pt solid var(--line); break-inside:avoid; }
  .cert-logo { width:9mm; height:9mm; object-fit:contain; display:block; margin:0 auto 1.2mm; }
  .cert-country { margin:0; font-size:11pt; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
  .cert-ministry { margin:.6mm 0 0; font-size:10pt; font-weight:700; }
  .cert-facility { margin:.6mm 0 0; font-size:9pt; color:var(--muted); }
  .cert-title { margin:2.5mm 0 0; font-size:15pt; font-weight:700; letter-spacing:.02em; }
  .cert-subtitle { font-size:8pt; color:var(--muted); text-align:center; }
  .cert-ids { display:flex; justify-content:space-between; align-items:baseline; gap:6mm; margin-top:2.5mm; font-size:9pt; text-align:left; }
  .cert-ids strong { font-variant-numeric:tabular-nums; }
  .cert-statement { margin:2.5mm 0 0; font-size:9pt; }
  .cert-section { margin-top:3mm; break-inside:avoid; }
  .cert-section h3 { margin:0 0 1.5mm; padding-bottom:.8mm; font-size:10pt; font-weight:700; border-bottom:.75pt solid var(--line); }
  .cert-section h3 small { font-weight:400; color:var(--muted); font-size:7.5pt; margin-left:2mm; }
  .cert-grid { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:1.6mm 6mm; }
  .cert-grid.two { grid-template-columns:repeat(2, minmax(0, 1fr)); }
  .cert-grid.four { grid-template-columns:repeat(4, minmax(0, 1fr)); }
  .cert-grid .span2 { grid-column:span 2; }
  .cert-grid .wide { grid-column:1 / -1; }
  .blank { display:block; min-height:4.2mm; border-bottom:.5pt solid var(--ink); }
  .cause { margin:0 0 2mm; font-size:8.8pt; }
  .cause th, .cause td { padding:1.2mm 2mm; }
  .cause th:first-child, .cause td:first-child { width:9mm; text-align:center; }
  .cause th.code, .cause td.code { width:20mm; font-variant-numeric:tabular-nums; }
  .cause th.interval, .cause td.interval { width:50mm; }
  .cause .due { color:var(--muted); font-size:7.5pt; margin-right:1.5mm; }
  .cause .blank { display:inline-block; width:70%; vertical-align:bottom; }
  .cause td.interval .blank { width:100%; }
  .opts { display:flex; flex-wrap:wrap; gap:1.6mm 5mm; margin:0; padding:0; list-style:none; font-size:8.5pt; }
  .opts li { margin:0; display:inline-flex; align-items:center; gap:1.4mm; }
  .box { display:inline-flex; align-items:center; justify-content:center; width:3.2mm; height:3.2mm; border:.75pt solid var(--ink); font-size:7pt; font-weight:700; line-height:1; }
  .q { display:grid; grid-template-columns:minmax(0, 1fr) auto; gap:1mm 6mm; align-items:center; margin:0 0 1mm; font-size:8.5pt; }
  .hint { color:var(--muted); font-size:7.5pt; margin:0 0 1.2mm; }
  .cert-sign { display:grid; grid-template-columns:minmax(0, 1fr) 38mm; gap:8mm; margin-top:3mm; break-inside:avoid; }
  .cert-sign .lines { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:3mm 8mm; }
  .cert-sign .line { padding-top:5mm; border-bottom:.75pt solid var(--ink); font-weight:700; }
  .cert-sign .line-label { margin-top:1mm; color:var(--muted); font-size:7.5pt; }
  .stamp { height:24mm; border:.75pt dashed var(--muted); display:flex; align-items:flex-end; justify-content:center; padding-bottom:2mm; color:var(--muted); font-size:7.5pt; }
  .cert-foot { margin-top:3mm; padding-top:1.8mm; border-top:.75pt solid var(--line); font-size:7.5pt; break-inside:avoid; }
  .cert-foot strong { display:block; margin-bottom:.8mm; }
`;

/* ── Small builders (every value goes through escapeHtml) ─────────────── */

function field(label: string, value?: string | number | null, wide = false): string {
  const shown = value === undefined || value === null || String(value).trim() === ''
    ? '<span class="blank"></span>'
    : `<span class="field-value">${escapeHtml(value)}</span>`;
  return `<div${wide ? ' class="wide"' : ''}><span class="field-label">${escapeHtml(label)}</span>${shown}</div>`;
}

function box(on: boolean): string {
  return `<span class="box">${on ? 'X' : ''}</span>`;
}

/** A row of tick boxes; `picked` (when known) is ticked, the rest left empty. */
function options(choices: string[], picked?: string | null): string {
  return `<ul class="opts">${choices.map(c => `<li>${box(c === picked)}${escapeHtml(c)}</li>`).join('')}</ul>`;
}

/** A Yes / No / Unknown question; `answer` undefined leaves every box empty. */
function yesNo(question: string, answer?: boolean): string {
  const picked = answer === undefined ? null : answer ? 'Yes' : 'No';
  return `<div class="q"><span>${escapeHtml(question)}</span>${options(['Yes', 'No', 'Unknown'], picked)}</div>`;
}

function capital(value?: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ') : '';
}

function place(...parts: (string | undefined)[]): string {
  return parts.map(p => p?.trim()).filter(Boolean).join(', ');
}

interface CertificateShell {
  /** Browser tab / file name. */
  tabTitle: string;
  title: string;
  subtitle: string;
  facilityName: string;
  facilityPlace: string;
  numberLabel: string;
  number: string;
  issued: Date;
  body: string;
}

function shell(c: CertificateShell): string {
  const who = getPrintIdentity();
  const footerCss = pageFooterCss({ facilityName: c.facilityName, printedBy: who?.name, systemId: who?.username, printedAt: c.issued });
  const logo = typeof window !== 'undefined' ? `${window.location.origin}/assets/tamam-icon.svg` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(c.tabTitle)}</title>
<style>@page { size:A4 portrait; }${footerCss}@page { margin:10mm 12mm 18mm; }${CLINICAL_PRINT_CSS}${CERT_CSS}</style></head>
<body>
<article class="cert">
  <header class="cert-head">
    ${logo ? `<img class="cert-logo" src="${escapeHtml(logo)}" alt="">` : ''}
    <p class="cert-country">Republic of South Sudan</p>
    <p class="cert-ministry">Ministry of Health</p>
    <p class="cert-facility">${escapeHtml(place(c.facilityName, c.facilityPlace))}</p>
    <h1 class="cert-title">${escapeHtml(c.title)}</h1>
    <div class="cert-ids">
      <span>${escapeHtml(c.numberLabel)}: <strong>${escapeHtml(c.number || '—')}</strong></span>
      <span class="cert-subtitle">${escapeHtml(c.subtitle)}</span>
      <span>Date of issue: <strong>${escapeHtml(printDate(c.issued))}</strong></span>
    </div>
  </header>
  ${c.body}
</article>
</body></html>`;
}

function signatureBlock(lines: { label: string; value?: string }[]): string {
  return `<section class="cert-sign">
    <div class="lines">${lines.map(l => `<div><div class="line">${escapeHtml(l.value || '')}</div><div class="line-label">${escapeHtml(l.label)}</div></div>`).join('')}</div>
    <div class="stamp">Official stamp</div>
  </section>`;
}

/* ── Notification of Birth ─────────────────────────────────────────────── */

export function buildBirthNotificationHtml(b: BirthRegistrationDoc, issued: Date = new Date()): string {
  const child = [b.childFirstName, b.childSurname].filter(Boolean).join(' ');
  const body = `
  <p class="cert-statement">This is to certify that the birth described below took place at, or was attended by, this health facility and is recorded in its birth register as entry <strong>${escapeHtml(b.certificateNumber || '—')}</strong>.</p>

  <section class="cert-section">
    <h3>The child</h3>
    <div class="cert-grid">
      ${field('Full name', child)}
      ${field('Sex', b.childGender)}
      ${field('Date of birth', printDate(b.dateOfBirth))}
      ${field('Time of birth')}
      ${field('Type of birth', capital(b.birthType))}
      ${field('Birth weight', b.birthWeight ? `${b.birthWeight} g` : '')}
      ${field('Delivery', capital(b.deliveryType))}
    </div>
  </section>

  <section class="cert-section">
    <h3>Place of birth</h3>
    <div class="cert-grid">
      ${field('Health facility or place', b.placeOfBirth || b.facilityName)}
      ${field('County', b.county)}
      ${field('State', b.state)}
    </div>
  </section>

  <section class="cert-section">
    <h3>Mother</h3>
    <div class="cert-grid">
      ${field('Full name', b.motherName)}
      ${field('Age (years)', b.motherAge || '')}
      ${field('Nationality', b.motherNationality)}
      ${field('Usual residence (boma, payam, county, state)', '', true)}
    </div>
  </section>

  <section class="cert-section">
    <h3>Father <small>if known</small></h3>
    <div class="cert-grid">
      ${field('Full name', b.fatherName)}
      ${field('Nationality', b.fatherName ? b.fatherNationality : '')}
      ${field('Usual residence')}
    </div>
  </section>

  <section class="cert-section">
    <h3>Attendance and informant</h3>
    <div class="cert-grid">
      ${field('Attendant at birth', b.attendedBy)}
      ${field('Recorded by', b.registeredBy)}
      ${field('Date recorded', printDate(b.createdAt))}
      ${field('Informant name')}
      ${field('Relationship to the child')}
    </div>
  </section>

  ${signatureBlock([
    { label: 'Name of attendant or authorised officer' },
    { label: 'Title / cadre' },
    { label: 'Signature' },
    { label: 'Date' },
  ])}

  <footer class="cert-foot">
    <strong>This notification is not a birth certificate.</strong>
    Present it to the Civil Registry office within 45 days of the birth to register the child and receive the birth certificate (Civil Registry Act 2018, section 24). Keep it with the child's health card.
  </footer>`;
  return shell({
    tabTitle: `Notification of Birth — ${b.certificateNumber || child}`,
    title: 'Notification of Birth',
    subtitle: 'Issued by the health facility for registration with the Civil Registry',
    facilityName: b.facilityName,
    facilityPlace: place(b.county, b.state),
    numberLabel: 'Notification No.',
    number: b.certificateNumber,
    issued,
    body,
  });
}

/* ── Medical Certificate of Cause of Death ─────────────────────────────── */

const MANNER_CHOICES = [
  'Disease', 'Assault', 'Could not be determined', 'Accident', 'Legal intervention',
  'Pending investigation', 'Intentional self harm', 'War', 'Unknown',
];

const MANNER_TO_WHO: Record<DeathRegistrationDoc['mannerOfDeath'], string> = {
  natural: 'Disease',
  accident: 'Accident',
  intentional_self_harm: 'Intentional self harm',
  assault: 'Assault',
  pending_investigation: 'Pending investigation',
  unknown: 'Unknown',
};

const EXTERNAL_PLACES = [
  'At home', 'Residential institution', 'School, other institution, public administrative area',
  'Sports and athletics area', 'Street and highway', 'Trade and service area',
  'Industrial and construction area', 'Farm', 'Other place', 'Unknown',
];

export function buildDeathCertificateHtml(d: DeathRegistrationDoc, issued: Date = new Date()): string {
  const name = [d.deceasedFirstName, d.deceasedSurname].filter(Boolean).join(' ');
  const manner = MANNER_TO_WHO[d.mannerOfDeath] || null;
  const external = d.mannerOfDeath === 'accident' || d.mannerOfDeath === 'assault' || d.mannerOfDeath === 'intentional_self_harm';
  const infant = d.ageAtDeath < 1;
  const female = d.deceasedGender === 'Female';
  const age = d.ageAtDeath < 1 ? 'Under 1 year' : `${d.ageAtDeath} years`;

  const causeRow = (line: string, cause: string, code: string, due: boolean) => `<tr>
      <td>${line}</td>
      <td>${due ? '<span class="due">Due to:</span>' : ''}${cause ? escapeHtml(cause) : '<span class="blank"></span>'}</td>
      <td class="code">${escapeHtml(code || '')}</td>
      <td class="interval"><span class="blank"></span></td>
    </tr>`;

  const body = `
  <section class="cert-section">
    <h3>Administrative data</h3>
    <div class="cert-grid four">
      ${field('Name of deceased', name)}
      ${field('Sex', d.deceasedGender)}
      ${field('Age at death', age)}
      ${field('Date of birth', printDate(d.dateOfBirth))}
      ${field('Date of death', printDate(d.dateOfDeath))}
      ${field('Time of death')}
      <div class="span2"><span class="field-label">Place of death (facility, county, state)</span><span class="field-value">${escapeHtml(place(d.placeOfDeath || d.facilityName, d.county, d.state) || '—')}</span></div>
    </div>
  </section>

  <section class="cert-section">
    <h3>Frame A: Medical data <small>Part 1 and 2</small></h3>
    <p class="hint">1. Report the disease or condition directly leading to death on line a. Report the chain of events in due-to order. State the underlying cause on the lowest used line.</p>
    <table class="cause">
      <thead><tr><th></th><th>Cause of death</th><th class="code">ICD-11 code</th><th class="interval">Time interval from onset to death</th></tr></thead>
      <tbody>
        ${causeRow('a', d.immediateCause, d.immediateICD11, false)}
        ${causeRow('b', d.antecedentCause1, d.antecedentICD11_1, true)}
        ${causeRow('c', d.antecedentCause2, d.antecedentICD11_2, true)}
        ${causeRow('d', d.underlyingCause, d.underlyingICD11, true)}
      </tbody>
    </table>
    <p class="hint">2. Other significant conditions contributing to death (time intervals can be included in brackets after the condition)</p>
    <table class="cause">
      <tbody><tr><td>2</td><td>${d.contributingConditions ? escapeHtml(d.contributingConditions) : '<span class="blank"></span>'}</td><td class="code">${escapeHtml(d.contributingICD11 || '')}</td><td class="interval"><span class="blank"></span></td></tr></tbody>
    </table>
  </section>

  <section class="cert-section">
    <h3>Frame B: Other medical data</h3>
    ${yesNo('Was surgery performed within the last 4 weeks?')}
    <div class="cert-grid two">${field('If yes, date of surgery')}${field('If yes, reason for surgery (disease or condition)')}</div>
    <div style="height:1mm"></div>
    ${yesNo('Was an autopsy requested?')}
    ${yesNo('If yes, were the findings used in the certification?')}
  </section>

  <section class="cert-section">
    <h3>Manner of death</h3>
    ${options(MANNER_CHOICES, manner)}
  </section>

  ${external ? `<section class="cert-section">
    <h3>External cause or poisoning</h3>
    <div class="cert-grid two">${field('Date of injury')}${field('How the external cause occurred (if poisoning, the agent)')}</div>
    <p class="hint" style="margin-top:2mm">Place of occurrence of the external cause</p>
    ${options(EXTERNAL_PLACES)}
  </section>` : ''}

  ${infant ? `<section class="cert-section">
    <h3>Fetal or infant death</h3>
    ${yesNo('Multiple pregnancy?')}
    ${yesNo('Stillborn?')}
    <div class="cert-grid">
      ${field('If death within 24 h, hours survived')}
      ${field('Birth weight (grams)')}
      ${field('Completed weeks of pregnancy')}
      ${field('Age of mother (years)')}
      ${field('If perinatal, conditions of the mother that affected the fetus and newborn', '', true)}
    </div>
  </section>` : ''}

  ${female ? `<section class="cert-section">
    <h3>For women: was the deceased pregnant?</h3>
    ${options(['At time of death', 'Within 42 days before the death', 'Between 43 days and 1 year before death', 'No', 'Unknown'])}
    <div style="height:1mm"></div>
    ${yesNo('Did the pregnancy contribute to the death?', d.maternalDeath || d.pregnancyRelated ? true : undefined)}
  </section>` : ''}

  <section class="cert-section">
    <h3>Certifier</h3>
    <p class="cert-statement" style="margin-top:0">To the best of my knowledge, death occurred at the time, date and place and due to the cause(s) and manner stated.</p>
  </section>
  ${signatureBlock([
    { label: 'Name of certifying clinician', value: d.certifiedBy },
    { label: 'Qualification / title', value: d.certifierRole },
    { label: 'Signature' },
    { label: 'Date' },
  ])}

  <footer class="cert-foot">
    <strong>Notification of death to the Civil Registry</strong>
    This certificate is the facility's notification of the death (Civil Registry Act 2018, section 28). Present it to the Civil Registry within 45 days of the death to register it.
    Register status at printing: ${d.deathRegistered ? 'registered' : d.deathNotified ? 'notified, not yet registered' : 'not yet notified'}.
  </footer>`;

  return shell({
    tabTitle: `Medical Certificate of Cause of Death — ${d.certificateNumber || name}`,
    title: 'Medical Certificate of Cause of Death',
    subtitle: 'WHO international form (ICD-11)',
    facilityName: d.facilityName,
    facilityPlace: place(d.county, d.state),
    numberLabel: 'Certificate No.',
    number: d.certificateNumber,
    issued,
    body,
  });
}

export function printBirthNotification(b: BirthRegistrationDoc): void {
  openIsolatedHtmlWindow(buildBirthNotificationHtml(b), '', true);
}

export function printDeathCertificate(d: DeathRegistrationDoc): void {
  openIsolatedHtmlWindow(buildDeathCertificateHtml(d), '', true);
}


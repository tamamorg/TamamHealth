/**
 * The facility's vital-event papers: the birth paper is a NOTIFICATION (the
 * Civil Registry issues the certificate, Civil Registry Act 2018 s.24), and
 * the death paper is the WHO international MCCD. Values are escaped, the
 * manner of death maps onto the WHO choices, and the optional WHO frames
 * appear only for the deaths they apply to.
 */
import { buildBirthNotificationHtml, buildDeathCertificateHtml } from '@/lib/vital-certificates';
import type { BirthRegistrationDoc, DeathRegistrationDoc } from '@/lib/db-types';

const issued = new Date('2026-11-04T10:00:00');

const birth = {
  _id: 'birth-1', type: 'birth', createdAt: '2026-11-03T08:00:00Z', updatedAt: '2026-11-03T08:00:00Z',
  childFirstName: 'Akon', childSurname: 'Deng', childGender: 'Female', dateOfBirth: '2026-11-03',
  placeOfBirth: 'Juba Teaching Hospital', facilityId: 'hosp-001', facilityName: 'Juba Teaching Hospital',
  motherName: 'Achol <b>Garang</b>', motherAge: 24, motherNationality: 'South Sudanese',
  fatherName: '', fatherNationality: 'South Sudanese', birthWeight: 3200, birthType: 'single',
  deliveryType: 'normal', attendedBy: 'Midwife', registeredBy: 'Dr. James Wani Igga',
  state: 'Central Equatoria', county: 'Juba', certificateNumber: 'CE-B-2026-0001',
} as unknown as BirthRegistrationDoc;

const death = {
  _id: 'death-1', type: 'death', createdAt: '2026-11-02T08:00:00Z', updatedAt: '2026-11-02T08:00:00Z',
  deceasedFirstName: 'Akol', deceasedSurname: 'Garang', deceasedGender: 'Male', dateOfBirth: '1958-05-10',
  dateOfDeath: '2026-11-02', ageAtDeath: 67, placeOfDeath: 'Juba Teaching Hospital', facilityId: 'hosp-001',
  facilityName: 'Juba Teaching Hospital', immediateCause: 'Cerebrovascular accident', immediateICD11: '8B20',
  antecedentCause1: 'Hypertensive heart disease', antecedentICD11_1: 'BA01', antecedentCause2: '', antecedentICD11_2: '',
  underlyingCause: 'Hypertensive heart disease', underlyingICD11: 'BA01', contributingConditions: 'Diabetes mellitus',
  contributingICD11: '5A14', mannerOfDeath: 'natural', maternalDeath: false, pregnancyRelated: false,
  certifiedBy: 'Dr. James Wani Igga', certifierRole: 'Physician', state: 'Central Equatoria', county: 'Juba',
  certificateNumber: 'CE-D-2026-0001', deathNotified: true, deathRegistered: false,
} as unknown as DeathRegistrationDoc;

/** The tick-box line for one choice: `X` inside the box when ticked. */
const ticked = (html: string, choice: string) => html.includes(`<li><span class="box">X</span>${choice}</li>`);

describe('Notification of Birth', () => {
  const html = buildBirthNotificationHtml(birth, issued);

  it('is titled a notification and says it is not the certificate', () => {
    expect(html).toContain('<h1 class="cert-title">Notification of Birth</h1>');
    expect(html).toContain('This notification is not a birth certificate.');
    expect(html).toContain('Civil Registry Act 2018, section 24');
  });

  it('carries the national header, number and issue date', () => {
    expect(html).toContain('Republic of South Sudan');
    expect(html).toContain('Ministry of Health');
    expect(html).toContain('CE-B-2026-0001');
    expect(html).toContain('Date of issue: <strong>2026-11-04</strong>');
  });

  it('escapes every value', () => {
    expect(html).toContain('Achol &lt;b&gt;Garang&lt;/b&gt;');
    expect(html).not.toContain('<b>Garang</b>');
  });

  it('leaves the father blank, nationality included, when he is not recorded', () => {
    const father = html.slice(html.indexOf('Father <small>'), html.indexOf('Attendance and informant'));
    expect(father).not.toContain('South Sudanese');
  });
});

describe('Medical Certificate of Cause of Death', () => {
  const html = buildDeathCertificateHtml(death, issued);

  it('follows the WHO form: Frame A lines a–d and Part 2, Frame B, certifier statement', () => {
    expect(html).toContain('Medical Certificate of Cause of Death');
    expect(html).toContain('Frame A: Medical data');
    expect(html).toContain('Time interval from onset to death');
    expect(html).toContain('Frame B: Other medical data');
    expect(html).toContain('Was surgery performed within the last 4 weeks?');
    expect(html).toContain('To the best of my knowledge, death occurred at the time, date and place and due to the cause(s) and manner stated.');
    for (const code of ['8B20', 'BA01', '5A14']) expect(html).toContain(code);
  });

  it('ticks the WHO manner the record maps to, and nothing else', () => {
    expect(ticked(html, 'Disease')).toBe(true);
    expect(ticked(html, 'Accident')).toBe(false);
    expect(ticked(buildDeathCertificateHtml({ ...death, mannerOfDeath: 'intentional_self_harm' }, issued), 'Intentional self harm')).toBe(true);
  });

  it('shows the external-cause, infant and pregnancy frames only where they apply', () => {
    expect(html).not.toContain('External cause or poisoning');
    expect(html).not.toContain('Fetal or infant death');
    expect(html).not.toContain('For women');
    expect(buildDeathCertificateHtml({ ...death, mannerOfDeath: 'accident' }, issued)).toContain('External cause or poisoning');
    expect(buildDeathCertificateHtml({ ...death, ageAtDeath: 0 }, issued)).toContain('Fetal or infant death');
    expect(buildDeathCertificateHtml({ ...death, deceasedGender: 'Female' }, issued)).toContain('For women: was the deceased pregnant?');
  });

  it('states the Civil Registry status at printing', () => {
    expect(html).toContain('notified, not yet registered');
  });
});

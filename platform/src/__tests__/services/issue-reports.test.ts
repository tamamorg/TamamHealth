/**
 * Staff issue reports, and the patient-inquiry queue they sit beside.
 *
 * What has to hold:
 *   - anyone can file a report; it is validated, carries no patient, keeps
 *     only a bare path from the page it was filed on, and its text is sealed;
 *   - a report never leaks into correspondence: not the org-wide message
 *     reads, not a patient thread, not the patient inquiry queue;
 *   - only a triage role, within scope, can move it — and the reporter's own
 *     words survive every update byte-for-byte (the gateway checks that);
 *   - the inquiry queue no longer shows a patient's reply to their clinician.
 */
import { createDBMock, rawTestDB, teardownTestDBs } from '../helpers/test-db';

jest.mock('@/lib/db', () => createDBMock());
jest.mock('@/lib/services/sync-event-service', () => ({ emitSyncEvent: jest.fn() }));

import type { DataScope } from '@/lib/services/data-scope';
import { isOrgEncrypted } from '@/lib/org-data-cipher';
import { messageIntegrityViolation } from '@/lib/sync/message-integrity';
import { createMessage, getAllMessages, getMessagesByPatient } from '@/modules/communication/services/message-service';
import { getPatientEnquiries, isFacilityEnquiry } from '@/lib/services/enquiry-service';
import {
  canTriageIssues, createIssueReport, getIssueReports, getMyIssueReports, sanitiseIssuePage,
  summariseIssues, updateIssueReport,
} from '@/modules/communication/services/issue-report-service';

const nurse = { id: 'user-nurse', name: 'Nurse Ben Lado', role: 'nurse', hospitalId: 'hosp-1', hospitalName: 'Juba Teaching', orgId: 'org-a' };
const admin = { id: 'user-admin', name: 'Ama Admin', role: 'org_admin' };
const orgA: DataScope = { role: 'org_admin', orgId: 'org-a' };
const orgB: DataScope = { role: 'org_admin', orgId: 'org-b' };

const report = (over: Partial<Parameters<typeof createIssueReport>[0]> = {}) => createIssueReport({
  summary: 'Lab results missing from chart',
  details: 'Ordered a CBC this morning; the result is in the lab queue but not on the chart.',
  category: 'bug',
  severity: 'high',
  page: '/patients/pat-00005?q=Achol+Deng#labs',
  ...over,
}, nurse);

afterEach(async () => { await teardownTestDBs(); });

describe('filing a report', () => {
  test('stores a sealed, patient-free report with only the bare page path', async () => {
    const created = await report();
    const stored = await rawTestDB('tamamhealth_messages').get(created._id) as unknown as Record<string, unknown>;
    expect(stored.messageKind).toBe('issue_report');
    expect(stored.issueStatus).toBe('new');
    expect(stored.patientId).toBe('');
    expect(stored.issuePage).toBe('/patients/pat-00005');
    expect(isOrgEncrypted(stored.subject)).toBe(true);
    expect(isOrgEncrypted(stored.body)).toBe(true);
    expect(JSON.stringify(stored)).not.toMatch(/Achol|CBC/);
    expect(created.subject).toBe('Lab results missing from chart');
  });

  test('refuses an empty or over-long report', async () => {
    await expect(report({ summary: '  ' })).rejects.toThrow(/summary/);
    await expect(report({ details: '' })).rejects.toThrow(/Describe/);
    await expect(report({ summary: 'x'.repeat(141) })).rejects.toThrow(/under/);
    await expect(report({ category: 'nonsense' as never })).rejects.toThrow(/kind/);
  });

  test('keeps only something that looks like an app path', () => {
    expect(sanitiseIssuePage('https://evil.example/patients/1?x=y')).toBe('/patients/1');
    expect(sanitiseIssuePage('//evil.example')).toBeUndefined();
    expect(sanitiseIssuePage('javascript:alert(1)')).toBeUndefined();
    expect(sanitiseIssuePage('/report-issue')).toBeUndefined();
    expect(sanitiseIssuePage(null)).toBeUndefined();
  });
});

describe('a report is not correspondence', () => {
  test('never appears in org-wide message reads, patient threads or the inquiry queue', async () => {
    await report();
    expect(await getAllMessages(orgA)).toEqual([]);
    expect(await getMessagesByPatient('', orgA)).toEqual([]);
    expect(await getPatientEnquiries(orgA)).toEqual([]);
    expect((await getIssueReports(orgA)).length).toBe(1);
  });

  test('the reporter sees their own reports; another organisation sees none', async () => {
    await report();
    expect((await getMyIssueReports(nurse.id)).length).toBe(1);
    expect(await getMyIssueReports('someone-else')).toEqual([]);
    expect(await getIssueReports(orgB)).toEqual([]);
  });
});

describe('triage', () => {
  test('a triage role moves it, assigns it and answers it — the reporter\'s words untouched', async () => {
    const created = await report();
    const before = await rawTestDB('tamamhealth_messages').get(created._id) as unknown as Record<string, unknown>;

    const updated = await updateIssueReport(created._id, {
      status: 'resolved', resolutionNote: 'Fixed in the lab sync; refresh the chart.',
      assignedTo: { id: admin.id, name: admin.name },
    }, admin, orgA);
    expect(updated?.issueStatus).toBe('resolved');
    expect(updated?.issueAssignedToName).toBe(admin.name);
    expect(updated?.issueResolutionNote).toBe('Fixed in the lab sync; refresh the chart.');

    const after = await rawTestDB('tamamhealth_messages').get(created._id) as unknown as Record<string, unknown>;
    expect(after.subject).toBe(before.subject);
    expect(after.body).toBe(before.body);
    expect(isOrgEncrypted(after.issueResolutionNote)).toBe(true);
    expect(messageIntegrityViolation(after, before, admin.id)).toBeNull();

    const [mine] = await getMyIssueReports(nurse.id);
    expect(mine.issueResolutionNote).toBe('Fixed in the lab sync; refresh the chart.');
    expect(summariseIssues(await getIssueReports(orgA)).byStatus.resolved).toBe(1);
  });

  test('a non-triage role, or a triage role outside the scope, cannot', async () => {
    const created = await report();
    expect(canTriageIssues('nurse')).toBe(false);
    expect(canTriageIssues('org_admin')).toBe(true);
    expect(await updateIssueReport(created._id, { status: 'closed' }, { id: nurse.id, name: nurse.name, role: 'nurse' }, orgA)).toBeNull();
    expect(await updateIssueReport(created._id, { status: 'closed' }, admin, orgB)).toBeNull();
    expect((await getIssueReports(orgA))[0].issueStatus).toBe('new');
  });
});

describe('the patient inquiry queue', () => {
  const inbound = (over: Record<string, unknown> = {}) => createMessage({
    recipientType: 'staff', direction: 'patient_to_staff', patientId: 'pat-1', patientName: 'Achol Deng',
    patientPhone: '', fromDoctorId: 'patient', fromDoctorName: 'Achol Deng', fromHospitalName: 'Juba',
    subject: 'Question', body: 'Hello', channel: 'app', sentAt: new Date().toISOString(), orgId: 'org-a',
    ...over,
  });

  test("leaves out a patient's reply to their clinician, keeps enquiries addressed to nobody", async () => {
    const reply = await inbound({ recipientStaffId: 'user-dr-wani', recipientStaffName: 'Dr. Wani', body: 'My results?' });
    const enquiry = await inbound({ body: 'Do you open on Sunday?' });
    const ids = (await getPatientEnquiries(orgA)).map(m => m._id);
    expect(ids).toEqual([enquiry._id]);
    expect(ids).not.toContain(reply._id);
    expect(isFacilityEnquiry({ recipientStaffId: undefined })).toBe(true);
    // The reply still belongs to the chart thread.
    expect((await getMessagesByPatient('pat-1', orgA)).map(m => m._id)).toContain(reply._id);
  });
});

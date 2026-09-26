/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/modules/identity', () => ({ getAuthPayload: jest.fn(), verifyCsrfToken: jest.fn(), CSRF_COOKIE_NAME: 'csrf', CSRF_HEADER_NAME: 'x-csrf' }));
jest.mock('@/modules/identity/services/user-service', () => ({ getUserById: jest.fn() }));
jest.mock('@/lib/clinical-notes/note-service', () => ({ getClinicalNoteById: jest.fn() }));
jest.mock('@/lib/db', () => ({ auditLogDB: jest.fn() }));
jest.mock('@/modules/ai-scribe/services/gateway.server', () => {
  const actual = jest.requireActual('@/modules/ai-scribe/services/gateway.server');
  return { ...actual, getScribeConfig: jest.fn(), generate: jest.fn(), transcribe: jest.fn() };
});
import { NextRequest } from 'next/server';
import { POST } from './route';
import { getAuthPayload, verifyCsrfToken } from '@/modules/identity';
import { getUserById } from '@/modules/identity/services/user-service';
import { getClinicalNoteById } from '@/lib/clinical-notes/note-service';
import { auditLogDB } from '@/lib/db';
import { getScribeConfig, generate } from '@/modules/ai-scribe/services/gateway.server';
let serial = 0;
const put = jest.fn();
const note = { _id: 'note-test', _rev: '1-test', orgId: 'org-test', hospitalId: 'facility-test', patientId: 'patient-test', status: 'draft', authorId: 'doctor-test', sections: [{ sectionId: 'subjective', text: '' }] };
beforeEach(() => {
  jest.clearAllMocks(); serial++;
  // Each synthetic user has an independent rate-limit window.
  const id = `doctor-${serial}`; note.authorId = id;
  (getAuthPayload as jest.Mock).mockResolvedValue({ sub: id, role: 'doctor', orgId: 'org-test', hospitalId: 'facility-test' });
  (getUserById as jest.Mock).mockResolvedValue({ _id: id, role: 'doctor', orgId: 'org-test', hospitalId: 'facility-test', isActive: true });
  (verifyCsrfToken as jest.Mock).mockResolvedValue(true);
  (getClinicalNoteById as jest.Mock).mockResolvedValue({ ...note });
  (getScribeConfig as jest.Mock).mockReturnValue({ facilities: ['org-test/facility-test'], approval: 'test-approval' });
  (auditLogDB as jest.Mock).mockReturnValue({ put }); put.mockResolvedValue({ ok: true });
  (generate as jest.Mock).mockResolvedValue({ text: 'Reports cough.', evidence: ['cough'], model: 'test-model', promptVersion: 'v1' });
});
function request(changes: Record<string, string> = {}, csrf = true) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ noteId: note._id, revision: note._rev, section: 'subjective', action: 'generate', consent: 'confirmed', source: 'Reports cough', ...changes })) form.set(k, v);
  return new NextRequest('https://tamam.test/api/ai-scribe', { method: 'POST', headers: { origin: 'https://tamam.test', ...(csrf ? { cookie: 'csrf=test', 'x-csrf': 'test' } : {}) }, body: form });
}
it('returns a transient draft with no-cache headers and content-free audit events', async () => {
  const response = await POST(request()); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ text: 'Reports cough.' });
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(put.mock.calls.map(c => c[0].action)).toEqual(['SCRIBE_REQUESTED', 'SCRIBE_GENERATED']);
  expect(JSON.stringify(put.mock.calls)).not.toContain('cough');
});
it('blocks missing CSRF before inference', async () => { (verifyCsrfToken as jest.Mock).mockResolvedValue(false); expect((await POST(request({}, false))).status).toBe(403); expect(generate).not.toHaveBeenCalled(); });
it('blocks missing consent', async () => { expect((await POST(request({ consent: '' }))).status).toBe(400); expect(generate).not.toHaveBeenCalled(); });
it('blocks unsigned-note access across facilities', async () => { (getClinicalNoteById as jest.Mock).mockResolvedValue({ ...note, hospitalId: 'other' }); expect((await POST(request())).status).toBe(403); expect(generate).not.toHaveBeenCalled(); });
it('blocks stale revisions before inference', async () => { expect((await POST(request({ revision: 'old' }))).status).toBe(409); expect(generate).not.toHaveBeenCalled(); });
it('fails closed when initial audit cannot persist', async () => { put.mockRejectedValue(new Error('storage failed')); expect((await POST(request())).status).toBe(503); expect(generate).not.toHaveBeenCalled(); });
it('withholds results if the note was signed during inference', async () => { (getClinicalNoteById as jest.Mock).mockResolvedValueOnce({ ...note }).mockResolvedValueOnce({ ...note, status: 'signed' }); expect((await POST(request())).status).toBe(409); });
it('withholds results if the user was revoked during inference', async () => { (getAuthPayload as jest.Mock).mockResolvedValueOnce({ sub: note.authorId, role: 'doctor', orgId: 'org-test', hospitalId: 'facility-test' }).mockResolvedValueOnce(null); expect((await POST(request())).status).toBe(403); });
it('withholds results if completion audit fails', async () => { put.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error('storage failed')).mockResolvedValueOnce({ ok: true }); const response = await POST(request()); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'unavailable' }); });
it('does not accept audio disguised as a string', async () => { expect((await POST(request({ action: 'transcribe', audio: 'not audio' }))).status).toBe(400); });

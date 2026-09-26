jest.mock('@/lib/clinical-notes/note-service', () => ({ clinicalNotesDB: jest.fn() }));
jest.mock('@/lib/services/sync-event-service', () => ({ emitSyncEvent: jest.fn() }));
import { clinicalNotesDB } from '@/lib/clinical-notes/note-service';
import { applyScribeSuggestion } from './apply-suggestion';
const actor = { _id: 'doctor-test', role: 'doctor', orgId: 'org-test', hospitalId: 'facility-test' };
const suggestion = { text: 'Reports cough.', evidence: ['cough'], requestId: 'test-request', model: 'test-model', promptVersion: 'test-v1' };
const makeNote = () => ({ _id: 'note-test', _rev: '1-original', orgId: actor.orgId, hospitalId: actor.hospitalId, authorId: actor._id, status: 'draft', sections: [{ sectionId: 'subjective', text: 'Old text' }, { sectionId: 'vitals', text: 'Unchanged' }], diagnoses: ['unchanged'] });
const put = jest.fn(); const get = jest.fn();
beforeEach(() => { jest.clearAllMocks(); get.mockResolvedValue(makeNote()); put.mockResolvedValue({ rev: '2-updated' }); (clinicalNotesDB as jest.Mock).mockReturnValue({ get, put }); });
it('replaces only reviewed narrative and retains provenance without signing', async () => {
  const result = await applyScribeSuggestion('note-test', '1-original', 'subjective', suggestion, actor);
  expect(result.status).toBe('draft'); expect(result.sections[1].text).toBe('Unchanged');
  expect(result.sections[0].aiAssistance).toMatchObject({ requestId: 'test-request', reviewedBy: actor._id });
  expect(put.mock.calls[0][0].diagnoses).toEqual(['unchanged']);
});
it('does not write stale suggestions', async () => { await expect(applyScribeSuggestion('note-test', '0-stale', 'subjective', suggestion, actor)).rejects.toThrow('stale_note'); expect(put).not.toHaveBeenCalled(); });
it.each(['signed', 'awaiting_cosign'])('does not modify %s notes', async status => { get.mockResolvedValue({ ...makeNote(), status }); await expect(applyScribeSuggestion('note-test', '1-original', 'subjective', suggestion, actor)).rejects.toThrow('forbidden'); expect(put).not.toHaveBeenCalled(); });
it('rejects another facility even with matching organization', async () => { await expect(applyScribeSuggestion('note-test', '1-original', 'subjective', suggestion, { ...actor, hospitalId: 'other' })).rejects.toThrow('forbidden'); expect(put).not.toHaveBeenCalled(); });
it('does not retry a concurrent write conflict', async () => { put.mockRejectedValueOnce(new Error('conflict')); await expect(applyScribeSuggestion('note-test', '1-original', 'subjective', suggestion, actor)).rejects.toThrow('conflict'); expect(put).toHaveBeenCalledTimes(1); });

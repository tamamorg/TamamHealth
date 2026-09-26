/** @jest-environment node */
jest.mock('server-only', () => ({}));
import { getScribeConfig, generate, readBounded } from './gateway.server';
const originalEnv = process.env;
beforeEach(() => {
  process.env = { ...originalEnv, TAMAM_SCRIBE_ENABLED: 'true', TAMAM_SCRIBE_APPROVAL_ID: 'test-approval', TAMAM_SCRIBE_ORIGIN: 'https://10.1.2.3', TAMAM_SCRIBE_TOKEN: 'synthetic-token', TAMAM_SCRIBE_TEXT_MODEL: 'test-model', TAMAM_SCRIBE_SPEECH_MODEL: 'test-asr', TAMAM_SCRIBE_FACILITIES: '["org/facility"]' };
});
afterEach(() => { process.env = originalEnv; jest.restoreAllMocks(); });
it('allows an explicitly configured private TLS gateway', () => expect(getScribeConfig().origin).toBe('https://10.1.2.3'));
it.each(['http://10.1.2.3', 'https://127.0.0.1', 'https://169.254.169.254', 'https://8.8.8.8', 'https://model.example.com', 'https://user:pass@10.1.2.3', 'https://10.1.2.3/custom', 'https://10.1.2.3?url=x'])('blocks unsafe gateway %s', origin => { process.env.TAMAM_SCRIBE_ORIGIN = origin; expect(getScribeConfig).toThrow('not_configured'); });
it('is disabled without explicit approval', () => { delete process.env.TAMAM_SCRIBE_APPROVAL_ID; expect(getScribeConfig).toThrow('not_configured'); });
it('bounds streamed input before parsing', async () => {
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(5)); c.close(); } });
  await expect(readBounded(body, 4)).rejects.toThrow('too_large');
});
it('cancels a stalled upload on deadline', async () => {
  const ac = new AbortController(); const cancel = jest.fn();
  const pending = readBounded(new ReadableStream({ cancel }), 10, ac.signal);
  ac.abort(); await expect(pending).rejects.toThrow('request_timeout'); expect(cancel).toHaveBeenCalledTimes(1);
});
it('uses only the private fixed endpoint with no redirect or cache', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'Reports cough.', evidence: ['cough'] }) } }] }));
  await expect(generate('Reports cough', 'subjective', new AbortController().signal)).resolves.toMatchObject({ text: 'Reports cough.', model: 'test-model' });
  expect(fetchMock).toHaveBeenCalledWith('https://10.1.2.3/v1/chat/completions', expect.objectContaining({ redirect: 'error', cache: 'no-store' }));
});
it('rejects model hallucinated citations', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'Normal.', evidence: ['normal'] }) } }] }));
  await expect(generate('Reports cough', 'subjective', new AbortController().signal)).rejects.toThrow('invalid_output');
});
it('never exposes provider errors', async () => {
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('sensitive upstream content'));
  await expect(generate('Reports cough', 'subjective', new AbortController().signal)).rejects.toThrow('model_unavailable');
});

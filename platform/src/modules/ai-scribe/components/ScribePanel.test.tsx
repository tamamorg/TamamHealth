import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
// Through the browser surface the app will import once the module is wired,
// so the surface itself stays exercised (and reachable) while unwired.
import { ScribePanel } from '../client';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';
import { apiFetch } from '@/lib/api-fetch';
jest.mock('@/components/Modal', () => ({ __esModule: true, default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
jest.mock('@/lib/i18n/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/lib/api-fetch', () => ({ apiFetch: jest.fn() }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let element: HTMLDivElement;
const stop = jest.fn(); const getUserMedia = jest.fn();
const note = { _id: 'synthetic-note', _rev: '1-test', sections: [{ sectionId: 'subjective', text: '' }], patientName: 'Synthetic patient' } as ClinicalNoteDoc;
class FakeRecorder {
  static isTypeSupported() { return true; }
  state = 'inactive'; onstop: (() => void) | null = null; onerror = null; ondataavailable = null;
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.onstop?.(); }
}
beforeEach(async () => {
  jest.clearAllMocks(); element = document.createElement('div'); document.body.appendChild(element); root = createRoot(element);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: FakeRecorder });
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] });
  (apiFetch as jest.Mock).mockResolvedValue({ json: async () => ({ available: true }) });
  await act(async () => { root.render(<ScribePanel note={note} onClose={jest.fn()} onApply={jest.fn()} />); });
});
afterEach(() => { act(() => root.unmount()); element.remove(); jest.restoreAllMocks(); });
const recordButton = () => Array.from(element.querySelectorAll('button')).find(b => b.textContent?.includes('scribe.record') || b.textContent?.includes('scribe.stop'))!;
const consent = () => act(() => { (element.querySelector('input[type=checkbox]') as HTMLInputElement).click(); });
it('does not request microphone permission without consent', () => { expect(recordButton().disabled).toBe(true); act(() => recordButton().click()); expect(getUserMedia).not.toHaveBeenCalled(); });
it('stops capture and withdraws consent on session lock', async () => {
  consent(); await act(async () => recordButton().click()); expect(recordButton().textContent).toContain('scribe.stop');
  act(() => window.dispatchEvent(new Event('tamam:session-locked')));
  expect(stop).toHaveBeenCalledTimes(1); expect(recordButton().disabled).toBe(true);
  expect((apiFetch as jest.Mock).mock.calls).toHaveLength(1); // availability only; discarded audio is never uploaded
});
it('stops a microphone permission result arriving after the panel closes', async () => {
  let resolve!: (value: unknown) => void; getUserMedia.mockReturnValue(new Promise(r => { resolve = r; }));
  consent(); await act(async () => recordButton().click());
  act(() => root.unmount()); root = createRoot(element);
  await act(async () => resolve({ getTracks: () => [{ stop }] }));
  expect(stop).toHaveBeenCalledTimes(1);
});
it('stops capture when the tab becomes hidden', async () => {
  consent(); await act(async () => recordButton().click());
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(stop).toHaveBeenCalledTimes(1); expect(recordButton().disabled).toBe(true);
});

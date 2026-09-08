import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import SpecialtyCarePage from '@/app/(dashboard)/departments/specialty-care/page';
Object.assign(globalThis, { Headers: require('node-fetch').Headers });

const mockScope = { orgId: 'org', hospitalId: 'facility', role: 'doctor' };
const mockEpisodes = ['A', 'B'].map(name => ({ _id: name, patientId: name, patientName: `Patient ${name}`, pathway: 'mental_health', status: 'planned', hospitalId: 'facility', orgId: 'org', values: {} }));
jest.mock('@/lib/context', () => ({ useAuth: () => ({ currentUser: { _id: 'doctor', name: 'Doctor', role: 'doctor', specialtyCode: 'psychiatry' } }) }));
jest.mock('@/lib/hooks/useDataScope', () => ({ useDataScope: () => mockScope }));
jest.mock('@/lib/hooks/usePatients', () => ({ usePatients: () => ({ patients: [] }) }));
jest.mock('@/lib/hooks/useUsers', () => ({ useUsers: () => ({ users: [] }) }));
jest.mock('@/lib/hooks/useAssets', () => ({ useAssets: () => ({ assets: [] }) }));
jest.mock('@/lib/hooks/useDepartments', () => ({ useDepartments: () => ({ departments: [] }) }));
jest.mock('@/lib/hooks/useAppointments', () => ({ useAppointments: () => ({ appointments: [] }) }));
jest.mock('@/lib/hooks/useSpecialtyEpisodes', () => ({ useSpecialtyEpisodes: () => ({ episodes: mockEpisodes, loading: false, reload: jest.fn() }) }));
jest.mock('@/lib/hooks/useSpecialtyPathwayConfigs', () => ({ useSpecialtyPathwayConfigs: () => ({ configs: [], reload: jest.fn() }) }));
jest.mock('@/lib/i18n/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/modules/identity/client', () => ({ CSRF_COOKIE_NAME: 'tamamhealth-csrf', CSRF_HEADER_NAME: 'x-csrf-token' }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); jest.restoreAllMocks(); });
const render = (element: React.ReactNode) => act(() => root.render(element));
const screen = {
  getByRole: (_role: string, { name }: { name: string | RegExp }) => {
    const element = [...container.querySelectorAll('button')].find(button => typeof name === 'string' ? button.textContent?.trim() === name : name.test(button.textContent || ''));
    if (!element) throw new Error(`Button not found: ${name}`);
    return element;
  },
  getByPlaceholderText: (placeholder: string) => container.querySelector(`textarea[placeholder="${placeholder}"]`) as HTMLTextAreaElement,
};
const fireEvent = {
  click: (element: Element) => act(() => (element as HTMLElement).click()),
  change: (element: HTMLTextAreaElement, event: { target: { value: string } }) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, event.target.value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }),
};
test('switching patients clears narrative and ignores a stale note response', async () => {
  let resolveA!: (response: unknown) => void;
  global.fetch = jest.fn().mockImplementation((url: string) => url.includes('patientId=A')
    ? new Promise(resolve => { resolveA = resolve; })
    : Promise.resolve({ ok: true, json: async () => ({ notes: [] }) }));
  render(<SpecialtyCarePage />);
  fireEvent.click(screen.getByRole('button', { name: /mhGAP assessment/i }));
  fireEvent.click(screen.getByRole('button', { name: /Patient A/ }));
  fireEvent.change(screen.getByPlaceholderText('specialtyCare.restrictedPlaceholder'), { target: { value: 'A private draft' } });
  fireEvent.click(screen.getByRole('button', { name: /Patient B/ }));
  expect(screen.getByPlaceholderText('specialtyCare.restrictedPlaceholder').value).toBe('');
  await act(async () => { resolveA({ ok: true, json: async () => ({ notes: [{ id: 'note-a', narrative: 'A private note', category: 'assessment' }] }) }); });
  expect(container.textContent).not.toContain('A private note');
});
test('saving a restricted note sends the CSRF header', async () => {
  document.cookie = 'tamamhealth-csrf=test-token';
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ notes: [], note: { id: 'note', category: 'assessment', narrative: 'Saved', authoredAt: '2026-09-07' } }) });
  render(<SpecialtyCarePage />);
  fireEvent.click(screen.getByRole('button', { name: /mhGAP assessment/i }));
  fireEvent.click(screen.getByRole('button', { name: /Patient A/ }));
  fireEvent.change(screen.getByPlaceholderText('specialtyCare.restrictedPlaceholder'), { target: { value: 'Private note' } });
  fireEvent.click(screen.getByRole('button', { name: 'specialtyCare.saveRestricted' }));
  await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toContain('Encrypted restricted note saved.');
  const call = (global.fetch as jest.Mock).mock.calls.find(([, init]) => init?.method === 'POST');
  expect(new Headers(call[1].headers).get('x-csrf-token')).toBe('test-token');
});

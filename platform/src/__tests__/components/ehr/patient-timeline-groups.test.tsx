import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PatientTimeline, { groupTimelineEvents, summarizeGroup, type TimelineEvent } from '@/components/PatientTimeline';
import { orderRowHref } from '@/components/ehr/chart/sections/OrdersSection';

jest.mock('@/lib/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, v?: Record<string, string | number>) => (v ? `${k}:${Object.values(v).join(',')}` : k),
  }),
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/patients/p1' }));

const ev = (id: string, category: TimelineEvent['category'], date: string, encounterId?: string, extra: Partial<TimelineEvent> = {}): TimelineEvent =>
  ({ id, category, date, encounterId, title: id, ...extra });

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const mount = (el: React.ReactElement) => { act(() => { root.render(el); }); };
const click = (el: Element | null) => { act(() => { (el as HTMLElement).click(); }); };
const text = () => host.textContent || '';
const q = (sel: string) => host.querySelector(sel);
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('groupTimelineEvents', () => {
  it('groups by encounter and falls back to calendar day', () => {
    const groups = groupTimelineEvents([
      ev('rx1', 'prescription', '2026-03-02T10:00:00', 'e1'),
      ev('rx2', 'prescription', '2026-03-02T10:05:00', 'e1'),
      ev('lab1', 'lab', '2026-03-02T11:00:00', 'e1'),
      ev('imm1', 'immunization', '2026-03-01'),
      ev('apt1', 'appointment', '2026-03-01'),
    ]);
    expect(groups.map(g => [g.id, g.events.length])).toEqual([['enc-e1', 3], ['day-2026-03-01', 2]]);
    expect(groups[0].events[0].id).toBe('lab1');
  });

  it('summarises counts and note state', () => {
    const [g] = groupTimelineEvents([
      ev('c', 'consultation', '2026-03-02T09:00:00', 'e1', { title: 'Cough', meta: 'Dr A', badge: { label: 'Signed', bg: '', color: '' } }),
      ev('rx1', 'prescription', '2026-03-02T10:00:00', 'e1'),
      ev('lab1', 'lab', '2026-03-02T11:00:00', 'e1'),
    ]);
    const s = summarizeGroup(g, (k, v) => (v ? `${k}:${v.count}` : k));
    expect(s.title).toBe('Cough');
    expect(s.detail).toBe('Dr A');
    expect(s.counts).toBe('timeline.groupMed:1 · timeline.groupLab:1 · timeline.groupNoteSigned');
  });
});

describe('PatientTimeline grouping UI', () => {
  const rx = (id: string, encounterId?: string) => ({ _id: id, encounterId, medication: `Drug ${id}`, createdAt: '2026-03-02T10:00:00', status: 'pending', dose: '1', frequency: 'od', duration: '1d' });
  const lab = { _id: 'l1', encounterId: 'e1', testName: 'Malaria RDT', createdAt: '2026-03-02T11:00:00', status: 'pending' };
  const props = {
    prescriptions: [rx('a', 'e1'), rx('b', 'e1'), rx('c')],
    labResults: [lab],
  } as unknown as React.ComponentProps<typeof PatientTimeline>;

  it('collapses items under the visit and expands on click', () => {
    mount(<PatientTimeline {...props} />);
    expect(text()).not.toContain('Malaria RDT');
    click(q('[aria-label^="Show items for"]'));
    expect(text()).toContain('Malaria RDT');
  });

  it('filters items inside groups and hides empty groups', () => {
    mount(<PatientTimeline {...props} />);
    const tab = [...host.querySelectorAll('[role="tab"]')].find(b => b.textContent === 'Appointments');
    click(tab || null);
    expect(q('[aria-label*="items for"]')).toBeNull();
  });

  it('expands the group of a focused item', () => {
    const withNote = { ...props, medicalRecords: [{ _id: 'm1', encounterId: 'e1', consultedAt: '2026-03-02T09:00:00', chiefComplaint: 'Fever' }] } as unknown as React.ComponentProps<typeof PatientTimeline>;
    mount(<PatientTimeline {...withNote} focusId="m1" />);
    expect(text()).toContain('Malaria RDT');
  });
});

describe('orderRowHref', () => {
  it('routes drug orders to prescriptions and lab orders to labs', () => {
    expect(orderRowHref('/patients/p1', { id: 'rx1', source: 'drug' })).toBe('/patients/p1?tab=prescriptions&focus=rx1');
    expect(orderRowHref('/patients/p1', { id: 'lab1', source: 'lab' })).toBe('/patients/p1?tab=labs&focus=lab1');
  });
});

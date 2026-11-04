/**
 * Reports "Choose a report" (2026-11-04 redesign): every choice is a field you
 * select from — area, topic, frequency, report, chart type — in that order.
 * Chart type applies at once; the report choice waits for Show report.
 */
import { useState } from 'react';
import { BarChart3, List } from '@/components/icons/lucide';
import { click, mount, setSelect } from '../clinical-notes/test-utils';
import ReportControlPanel, { type ReportView } from '@/app/(dashboard)/reports/_ReportControlPanel';
import { EMPTY_REPORT_FILTER } from '@/app/(dashboard)/reports/_ReportCatalogue';

jest.mock('@/lib/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/reports',
}));
let role = 'org_admin';
jest.mock('@/lib/context', () => ({
  useAuth: () => ({ currentUser: { role } }),
}));

const onApplied = jest.fn<void, [ReportView]>();

function Harness() {
  const [applied, setApplied] = useState<ReportView>({ report: 'Daily Patient Census', kind: 'column' });
  return (
    <ReportControlPanel
      filter={EMPTY_REPORT_FILTER}
      onFilterChange={() => undefined}
      applied={applied}
      onApply={view => { onApplied(view); setApplied(view); }}
      kinds={[
        { id: 'column', labelKey: 'reports.chartColumn', icon: BarChart3 },
        { id: 'bar', labelKey: 'reports.chartBar', icon: List },
      ]}
      partToWholeOkFor={() => true}
    />
  );
}

const select = (root: HTMLElement, action: string) =>
  root.querySelector<HTMLSelectElement>(`select[data-action="${action}"]`)!;

beforeEach(() => { onApplied.mockClear(); push.mockClear(); role = 'org_admin'; });

it('asks area, topic, frequency, report and chart type, in that order, as fields', () => {
  const mounted = mount(<Harness />);
  const order = [...mounted.container.querySelectorAll('select[data-action]')].map(s => s.getAttribute('data-action'));
  expect(order).toEqual([
    'report-control-area', 'report-filter-category', 'report-filter-period',
    'report-control-report', 'report-control-kind',
  ]);
  // No list of report buttons and no separate search box any more.
  expect(mounted.container.querySelector('.rpt-rail-item')).toBeNull();
  expect(mounted.container.querySelector('input[type="search"]')).toBeNull();
  mounted.unmount();
});

it('applies a chart type immediately', () => {
  const mounted = mount(<Harness />);
  setSelect(select(mounted.container, 'report-control-kind'), 'bar');
  expect(onApplied).toHaveBeenLastCalledWith({ report: 'Daily Patient Census', kind: 'bar' });
  mounted.unmount();
});

it('holds a new report until Show report', () => {
  const mounted = mount(<Harness />);
  const report = select(mounted.container, 'report-control-report');
  const other = [...report.options].find(o => o.value !== 'Daily Patient Census')!.value;
  setSelect(report, other);
  expect(onApplied).not.toHaveBeenCalled();
  click(mounted.container.querySelector('button[data-action="report-control-apply"]')!);
  expect(onApplied).toHaveBeenLastCalledWith({ report: other, kind: 'column' });
  mounted.unmount();
});

it('switches area by opening that page, and has no area field for a role with one page', () => {
  const mounted = mount(<Harness />);
  const area = select(mounted.container, 'report-control-area');
  setSelect(area, [...area.options].find(o => o.value !== '/reports')!.value);
  expect(push).toHaveBeenCalledTimes(1);
  mounted.unmount();
  role = 'doctor';
  const single = mount(<Harness />);
  expect(single.container.querySelector('select[data-action="report-control-area"]')).toBeNull();
  single.unmount();
});

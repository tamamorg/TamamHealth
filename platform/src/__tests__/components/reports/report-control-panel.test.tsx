import React, { useState } from 'react';
import { BarChart3, List } from '@/components/icons/lucide';
import { click, mount } from '../clinical-notes/test-utils';
import ReportControlPanel, { type ReportView } from '@/app/(dashboard)/reports/_ReportControlPanel';
import { EMPTY_REPORT_FILTER } from '@/app/(dashboard)/reports/_ReportCatalogue';

jest.mock('@/lib/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const onApplied = jest.fn<void, [ReportView]>();

function Harness() {
  const [applied, setApplied] = useState<ReportView>({
    report: 'Daily Patient Census',
    kind: 'column',
  });
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
      loading={false}
      total={16}
    />
  );
}

beforeEach(() => onApplied.mockClear());

it('places chart form directly below the filter selections', () => {
  const mounted = mount(<Harness />);
  const filter = mounted.container.querySelector('.rpt-rail-filter')!;
  const forms = mounted.container.querySelector('.rpt-ctl-chart-form')!;
  const firstReportGroup = mounted.container.querySelector('.rpt-rail-group')!;

  expect(filter.nextElementSibling).toBe(forms);
  expect(forms.compareDocumentPosition(firstReportGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  mounted.unmount();
});

it('applies a chart form immediately and reflects the visible selection', () => {
  const mounted = mount(<Harness />);
  const bar = [...mounted.container.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
    .find(button => button.textContent?.includes('reports.chartBar'))!;

  click(bar);

  expect(onApplied).toHaveBeenLastCalledWith({ report: 'Daily Patient Census', kind: 'bar' });
  expect(bar.getAttribute('aria-checked')).toBe('true');
  expect(bar.classList.contains('is-on')).toBe(true);
  mounted.unmount();
});


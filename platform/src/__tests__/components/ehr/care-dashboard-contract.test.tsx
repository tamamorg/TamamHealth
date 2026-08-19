import { renderToStaticMarkup } from 'react-dom/server';
import {
  EhrCareDashboardMetricItem,
  EhrRowDetail,
  type EhrCareDashboardRow,
} from '@/components/ehr/EhrCareDashboard';

const row = (overrides: Partial<EhrCareDashboardRow> = {}): EhrCareDashboardRow => ({
  id: 'visit-1',
  title: 'Nyandeng Deng',
  subtitle: 'Follow-up visit',
  ...overrides,
});

describe('care dashboard preview and navigation contracts', () => {
  it('keeps the full-page action when a row supplies custom preview content', () => {
    const markup = renderToStaticMarkup(
      <EhrRowDetail
        row={row({
          popupDetail: <p>Custom visit preview</p>,
          detailHref: '/patients/patient-1?tab=consultation',
          detailLabel: 'Open consultation',
        })}
        detailTab="visit"
        onCollapse={jest.fn()}
      />,
    );

    document.body.innerHTML = markup;
    const link = document.querySelector<HTMLAnchorElement>('a[href="/patients/patient-1?tab=consultation"]');

    expect(document.body.textContent).toContain('Custom visit preview');
    expect(link?.textContent).toBe('Open consultation');
  });

  it('uses the standard full-page label when a caller does not override it', () => {
    document.body.innerHTML = renderToStaticMarkup(
      <EhrRowDetail
        row={row({ detailHref: '/patients/patient-1' })}
        detailTab="visit"
        onCollapse={jest.fn()}
      />,
    );

    expect(document.querySelector('a')?.textContent).toBe('Open full page');
  });

  it('removes metrics with no action from keyboard interaction', () => {
    document.body.innerHTML = renderToStaticMarkup(
      <EhrCareDashboardMetricItem
        metric={{ label: 'Patients waiting', value: 4 }}
        onNavigate={jest.fn()}
      />,
    );
    const metric = document.querySelector<HTMLButtonElement>('button');

    expect(metric?.disabled).toBe(true);
    metric?.focus();
    expect(document.activeElement).not.toBe(metric);
  });

  it('keeps metrics enabled when they navigate or run an action', () => {
    const navigateMarkup = renderToStaticMarkup(
      <EhrCareDashboardMetricItem
        metric={{ label: 'Pending results', value: 2, href: '/lab' }}
        onNavigate={jest.fn()}
      />,
    );
    const actionMarkup = renderToStaticMarkup(
      <EhrCareDashboardMetricItem
        metric={{ label: 'Today', value: 8, onClick: jest.fn() }}
        onNavigate={jest.fn()}
      />,
    );

    expect(navigateMarkup).not.toContain('disabled=""');
    expect(actionMarkup).not.toContain('disabled=""');
  });
});

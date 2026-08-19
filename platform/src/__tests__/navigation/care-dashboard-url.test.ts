import {
  isIsoCalendarDate,
  readCareDashboardUrl,
  updateCareDashboardSearch,
} from '@/lib/navigation/care-dashboard-url';

describe('care dashboard URL state', () => {
  it('reads valid dashboard state and rejects impossible dates', () => {
    expect(readCareDashboardUrl('?day=2026-08-19&preview=visit%3A123')).toEqual({
      day: '2026-08-19',
      preview: 'visit:123',
    });
    expect(readCareDashboardUrl('?day=2026-02-30&preview=')).toEqual({
      day: null,
      preview: null,
    });
    expect(isIsoCalendarDate('2024-02-29')).toBe(true);
    expect(isIsoCalendarDate('2025-02-29')).toBe(false);
  });

  it('preserves page-owned query parameters while updating dashboard state', () => {
    expect(updateCareDashboardSearch('?lane=in_office&search=Nyandeng', {
      day: '2026-08-19',
      preview: 'visit:123',
    })).toBe('?lane=in_office&search=Nyandeng&day=2026-08-19&preview=visit%3A123');
  });

  it('removes only the requested dashboard key', () => {
    expect(updateCareDashboardSearch('?day=2026-08-19&preview=visit-1&tour=front-desk', {
      preview: null,
    })).toBe('?day=2026-08-19&tour=front-desk');
  });
});

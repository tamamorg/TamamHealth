export const CARE_DASHBOARD_DAY_PARAM = 'day';
export const CARE_DASHBOARD_PREVIEW_PARAM = 'preview';

export type CareDashboardUrlState = {
  day: string | null;
  preview: string | null;
};

export type CareDashboardUrlPatch = {
  day?: string | null;
  preview?: string | null;
};

/** Only calendar dates are accepted; malformed values never reach date widgets. */
export function isIsoCalendarDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function readCareDashboardUrl(search: string): CareDashboardUrlState {
  const params = new URLSearchParams(search);
  const day = params.get(CARE_DASHBOARD_DAY_PARAM);
  const preview = params.get(CARE_DASHBOARD_PREVIEW_PARAM);

  return {
    day: isIsoCalendarDate(day) ? day : null,
    preview: preview?.trim() || null,
  };
}

/**
 * Applies only dashboard-owned keys and preserves every query parameter owned
 * by the page (search, lane, filters, guided-tour state, and future additions).
 */
export function updateCareDashboardSearch(
  search: string,
  patch: CareDashboardUrlPatch,
): string {
  const params = new URLSearchParams(search);

  if (patch.day !== undefined) {
    if (patch.day && isIsoCalendarDate(patch.day)) params.set(CARE_DASHBOARD_DAY_PARAM, patch.day);
    else params.delete(CARE_DASHBOARD_DAY_PARAM);
  }

  if (patch.preview !== undefined) {
    if (patch.preview?.trim()) params.set(CARE_DASHBOARD_PREVIEW_PARAM, patch.preview);
    else params.delete(CARE_DASHBOARD_PREVIEW_PARAM);
  }

  const query = params.toString();
  return query ? `?${query}` : '';
}

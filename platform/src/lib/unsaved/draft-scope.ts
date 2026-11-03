/**
 * The page part of a draft's identity: path plus the query that picks a
 * record, without the parameters that only move around the same page (a
 * chart tab, a focused section, an open form), so a form reopened on another
 * tab of the same chart still finds its draft.
 */
const VIEW_ONLY_PARAMS = new Set(['tab', 'focus', 'form', 'panel', 'view', 'sort', 'q']);

export function pageDraftScope(location: Pick<Location, 'pathname' | 'search'> = window.location): string {
  const params = new URLSearchParams(location.search);
  for (const key of [...params.keys()]) if (VIEW_ONLY_PARAMS.has(key)) params.delete(key);
  params.sort();
  const query = params.toString();
  return query ? `${location.pathname}?${query}` : location.pathname;
}

const textOf = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/**
 * A popup's identity: the page, its title and the line under it (whose
 * record). Null when it has no title to go by — then it keeps no draft.
 */
export function popupDraftScope(dialog: HTMLElement | null, labelledBy?: string, describedBy?: string): string | null {
  if (!dialog) return null;
  const byId = (id?: string) => (id ? textOf(dialog.ownerDocument.getElementById(id)) : '');
  const title = byId(labelledBy) || textOf(dialog.querySelector('h1, h2, h3, [role="heading"]'));
  if (!title) return null;
  return `${pageDraftScope()}|popup|${title}|${byId(describedBy)}`;
}

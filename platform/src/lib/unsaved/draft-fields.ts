/**
 * Reading and refilling a form's fields from the DOM, so one draft keeper
 * works for every form without each one being wired by hand.
 *
 * Fields are found by what a person would recognise them by (name, label,
 * placeholder), not by position, so a field that appears only after an
 * earlier answer still finds its value. Refilling goes through the native
 * value setter and a real input/change event, which is what React's
 * controlled inputs listen for, so the form's own state updates as if typed.
 *
 * Never kept: passwords, PINs, one-time codes, card details, search and
 * filter boxes, file pickers, and anything inside `[data-no-draft]`.
 */

export type DraftField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
export type DraftValues = Record<string, string>;

/** Marks the root of a draft region; a region nested inside another is its own. */
export const DRAFT_ROOT_ATTR = 'data-draft-root';

const SKIPPED_INPUT_TYPES = new Set([
  'password', 'hidden', 'file', 'submit', 'button', 'reset', 'image', 'search',
]);
const SENSITIVE = /pass(word|code)|\bpin\b|one[-\s]?time|otp|cvv|cvc|card\s*(number|no)|security\s*code/i;
const SEARCHY = /search|filter|find\b/i;
/** React's generated ids change with the tree, so they cannot name a field across reloads. */
const GENERATED_ID = /^(:r|«r|_r_|r[0-9a-z]+:)/;

const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

/**
 * A label's own words. A field wrapped in its label would otherwise lend the
 * label its typed text (a textarea's content is text), and the field's name
 * would change with every keystroke.
 */
function ownText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) return '';
  let out = '';
  for (const child of Array.from(node.childNodes)) out += ownText(child);
  return out;
}

function labelText(el: DraftField): string {
  const byAria = el.getAttribute('aria-label');
  if (byAria) return byAria;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy.split(/\s+/)
      .map(id => { const ref = el.ownerDocument.getElementById(id); return ref ? ownText(ref) : ''; })
      .join(' ');
    if (clean(text)) return text;
  }
  // `labels` covers both <label for> and a wrapping <label>.
  const label = el.labels?.[0] ?? el.closest('label');
  return label ? ownText(label) : '';
}

/** What a field is recognised by, before de-duplication. */
function baseName(el: DraftField): string {
  const explicit = el.getAttribute('data-draft-key');
  if (explicit) return explicit;
  const parts = [
    el.getAttribute('name'),
    clean(labelText(el)),
    el.getAttribute('placeholder'),
    el.id && !GENERATED_ID.test(el.id) ? el.id : '',
  ];
  return clean(parts.find(part => part && clean(part)) || '');
}

/** Whether a field may be kept in a draft at all. */
export function isDraftable(el: Element): el is DraftField {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return false;
  if (el.disabled || (el as HTMLInputElement).readOnly) return false;
  if (el.closest('[data-no-draft]')) return false;
  if (el instanceof HTMLInputElement && SKIPPED_INPUT_TYPES.has(el.type)) return false;
  const role = el.getAttribute('role');
  if (role === 'searchbox' || role === 'combobox') return false;
  const autocomplete = el.getAttribute('autocomplete') || '';
  if (/password|one-time-code|cc-/.test(autocomplete)) return false;
  const described = `${el.getAttribute('name') || ''} ${el.id || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''}`;
  if (SENSITIVE.test(described) || SEARCHY.test(described)) return false;
  if (SENSITIVE.test(clean(labelText(el)))) return false;
  return true;
}

function belongsTo(el: Element, root: Element): boolean {
  return el.closest(`[${DRAFT_ROOT_ATTR}]`) === root;
}

/**
 * Every keepable field directly in this region, each under a stable key.
 * With `onlyInForms`, only fields inside a `<form>` count — a page's search
 * and filter boxes are not work in progress.
 */
export function draftFields(root: Element, onlyInForms = false): Array<{ key: string; el: DraftField }> {
  const seen = new Map<string, number>();
  const out: Array<{ key: string; el: DraftField }> = [];
  for (const el of Array.from(root.querySelectorAll('input, textarea, select'))) {
    if (!isDraftable(el) || !belongsTo(el, root)) continue;
    if (onlyInForms && !el.closest('form')) continue;
    let base = `${el.tagName.toLowerCase()}:${baseName(el)}`;
    if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) base += `=${el.value}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({ key: n === 0 ? base : `${base}#${n}`, el });
  }
  return out;
}

/** The key of one field, as `draftFields` would give it; null when it is not kept. */
export function draftKeyOf(target: EventTarget | null, root: Element, onlyInForms = false): string | null {
  if (!(target instanceof Element) || !isDraftable(target) || !belongsTo(target, root)) return null;
  return draftFields(root, onlyInForms).find(field => field.el === target)?.key ?? null;
}

export function readFieldValue(el: DraftField): string {
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return el.checked ? 'true' : 'false';
  if (el instanceof HTMLSelectElement && el.multiple) {
    return JSON.stringify(Array.from(el.selectedOptions).map(option => option.value));
  }
  return el.value;
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value); else el.value = value;
}

/**
 * Put a kept value back as if the user had entered it. Returns the value the
 * field held before, or null when nothing changed.
 */
export function writeFieldValue(el: DraftField, value: string): string | null {
  const before = readFieldValue(el);
  if (before === value) return null;
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    // A radio is set by choosing its sibling; "false" on its own changes nothing.
    if (el.type === 'radio' && value !== 'true') return null;
    el.click();
    return before;
  }
  if (el instanceof HTMLSelectElement) {
    if (el.multiple) {
      let wanted: string[] = [];
      try { wanted = JSON.parse(value) as string[]; } catch { return null; }
      for (const option of Array.from(el.options)) option.selected = wanted.includes(option.value);
    } else {
      if (!Array.from(el.options).some(option => option.value === value)) return null;
      setNativeValue(el, value);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return before;
  }
  setNativeValue(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return before;
}

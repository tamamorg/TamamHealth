import { clickLabel, closeStrayDialog, findMenuGroup, findNavControl } from '@/lib/tour/tour-show';

// jsdom has no layout, so give elements a size the "is it shown" check accepts.
function sized<T extends HTMLElement>(el: T): T {
  el.getBoundingClientRect = () => ({ width: 40, height: 20, top: 0, left: 0, right: 40, bottom: 20, x: 0, y: 0, toJSON: () => ({}) });
  return el;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('findNavControl', () => {
  it('finds a top-bar shortcut or menu item by its address', () => {
    const shortcut = sized(document.createElement('button'));
    shortcut.dataset.href = '/patients';
    document.body.append(shortcut);
    expect(findNavControl('/patients')).toBe(shortcut);
  });

  it('finds a plain link to the page', () => {
    const link = sized(document.createElement('a'));
    link.setAttribute('href', '/alerts');
    document.body.append(link);
    expect(findNavControl('/alerts')).toBe(link);
  });

  it('skips a control that is not on screen', () => {
    const hidden = document.createElement('a');
    hidden.setAttribute('href', '/messages');
    hidden.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
    document.body.append(hidden);
    expect(findNavControl('/messages')).toBeNull();
  });

  it('never points at a control inside the tour card itself', () => {
    const card = document.createElement('div');
    card.className = 'tour-card';
    const inside = sized(document.createElement('a'));
    inside.setAttribute('href', '/dashboard');
    card.append(inside);
    document.body.append(card);
    expect(findNavControl('/dashboard')).toBeNull();
  });
});

describe('findMenuGroup', () => {
  it('finds the collapsed menu group that holds a page', () => {
    const group = sized(document.createElement('button'));
    group.dataset.hrefs = '/wards /anc /immunizations';
    document.body.append(group);
    expect(findMenuGroup('/anc')).toBe(group);
    expect(findMenuGroup('/lab')).toBeNull();
  });
});

describe('clickLabel', () => {
  it('prefers the accessible name', () => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Open module menu');
    btn.textContent = '≡';
    expect(clickLabel(btn)).toBe('Open module menu');
  });

  it('skips avatar initials and names the row by its patient', () => {
    const row = document.createElement('div');
    row.textContent = 'SM\nSarah Madut\n09:15';
    // jsdom does not implement innerText; the helper falls back to textContent.
    expect(clickLabel(row)).toBe('Sarah Madut');
  });

  it('shortens a long label', () => {
    const btn = document.createElement('button');
    btn.textContent = 'A very long control label that goes on and on past forty characters';
    expect(clickLabel(btn).length).toBeLessThanOrEqual(40);
  });
});

describe('closeStrayDialog', () => {
  it('sends Escape to a dialog the next step does not use', () => {
    const popup = document.createElement('div');
    popup.setAttribute('role', 'dialog');
    document.body.append(popup);
    const seen: string[] = [];
    popup.addEventListener('keydown', e => seen.push((e as KeyboardEvent).key));
    closeStrayDialog('.ehr-top-search');
    expect(seen).toEqual(['Escape']);
  });

  it('leaves a dialog that holds the next step target alone', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const inner = document.createElement('div');
    inner.dataset.tour = 'booking';
    dialog.append(inner);
    document.body.append(dialog);
    const seen: string[] = [];
    dialog.addEventListener('keydown', e => seen.push((e as KeyboardEvent).key));
    closeStrayDialog('[data-tour="booking"]');
    expect(seen).toEqual([]);
  });

  it('ignores the tour card', () => {
    const card = document.createElement('div');
    card.setAttribute('role', 'dialog');
    card.className = 'tour-card';
    document.body.append(card);
    const seen: string[] = [];
    card.addEventListener('keydown', e => seen.push((e as KeyboardEvent).key));
    closeStrayDialog();
    expect(seen).toEqual([]);
  });
});

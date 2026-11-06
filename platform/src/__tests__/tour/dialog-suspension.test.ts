import { hasBlockingDialog } from '@/lib/tour/tour-dom';

afterEach(() => {
  document.body.replaceChildren();
});

test('the tour card does not suspend itself', () => {
  const tour = document.createElement('div');
  tour.className = 'tour-card';
  tour.setAttribute('role', 'dialog');
  document.body.append(tour);

  expect(hasBlockingDialog()).toBe(false);
});

test('an application dialog suspends the tour', () => {
  const tour = document.createElement('div');
  tour.className = 'tour-card';
  tour.setAttribute('role', 'dialog');
  const applicationDialog = document.createElement('div');
  applicationDialog.setAttribute('role', 'dialog');
  document.body.append(tour, applicationDialog);

  expect(hasBlockingDialog()).toBe(true);
});

test('a dialog holding the current step target does not suspend the tour', () => {
  // The patient list's Filters panel is a dialog that the "Narrow the list"
  // step opens itself; hiding the card there stranded the tour.
  const filters = document.createElement('div');
  filters.setAttribute('role', 'dialog');
  const panel = document.createElement('div');
  panel.className = 'ehr-list-filters-panel';
  filters.append(panel);
  document.body.append(filters);

  expect(hasBlockingDialog(document, '.ehr-list-filters-panel')).toBe(false);
  // Any other dialog still owns the screen.
  expect(hasBlockingDialog(document, '.tamam-header')).toBe(true);
  expect(hasBlockingDialog()).toBe(true);
});

test('a dialog that IS the step target does not suspend the tour', () => {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.dataset.tour = 'booking';
  document.body.append(dialog);

  expect(hasBlockingDialog(document, '[data-tour="booking"]')).toBe(false);
});

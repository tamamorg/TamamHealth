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

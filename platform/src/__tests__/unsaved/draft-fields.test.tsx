/**
 * Draft fields are found by what a person recognises them by, and a kept
 * value is put back through React's own change handling, so a controlled
 * form's state updates as if the value had been typed.
 */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { draftFields, writeFieldValue, readFieldValue, DRAFT_ROOT_ATTR } from '@/lib/unsaved/draft-fields';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const state = () => JSON.parse(document.querySelector('output')!.getAttribute('data-state')!);

function Form() {
  const [temp, setTemp] = useState('');
  const [notes, setNotes] = useState('');
  const [route, setRoute] = useState('oral');
  const [urgent, setUrgent] = useState(false);
  return (
    <form>
      <output data-state={JSON.stringify({ temp, notes, route, urgent })} />
      <label htmlFor="temp">Temperature</label>
      <input id="temp" value={temp} onChange={e => setTemp(e.target.value)} />
      <textarea aria-label="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
      <select aria-label="Route" value={route} onChange={e => setRoute(e.target.value)}>
        <option value="oral">Oral</option>
        <option value="iv">IV</option>
      </select>
      <label><input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} /> Urgent</label>
      <input type="password" aria-label="Password" defaultValue="" />
      <input aria-label="PIN" defaultValue="" />
      <input type="search" aria-label="Find patient" defaultValue="" />
      <input aria-label="Search drugs" defaultValue="" />
      <div data-no-draft><input aria-label="Note body" defaultValue="" /></div>
    </form>
  );
}

beforeEach(() => {
  container = document.createElement('div');
  container.setAttribute(DRAFT_ROOT_ATTR, '');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Form />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('keeps ordinary fields under readable keys and skips secrets, searches and opted-out areas', () => {
  const keys = draftFields(container).map(f => f.key);
  expect(keys).toEqual([
    'input:Temperature',
    'textarea:Notes',
    'select:Route',
    'input:Urgent=on',
  ]);
});

it('puts values back through React, so the form state updates', () => {
  const byKey = Object.fromEntries(draftFields(container).map(f => [f.key, f.el]));
  act(() => {
    writeFieldValue(byKey['input:Temperature'], '38.5');
    writeFieldValue(byKey['textarea:Notes'], 'Fever for two days');
    writeFieldValue(byKey['select:Route'], 'iv');
    writeFieldValue(byKey['input:Urgent=on'], 'true');
  });
  expect(state()).toEqual({ temp: '38.5', notes: 'Fever for two days', route: 'iv', urgent: true });
  expect(readFieldValue(byKey['input:Urgent=on'])).toBe('true');
});

it('ignores a select value the form no longer offers, and reports no change for an equal value', () => {
  const select = draftFields(container).find(f => f.key === 'select:Route')!.el;
  expect(writeFieldValue(select, 'rectal')).toBeNull();
  expect(writeFieldValue(select, 'oral')).toBeNull();
  expect(state().route).toBe('oral');
});

it('names a field wrapped in its label by the label alone, not by what was typed', () => {
  const label = document.createElement('label');
  label.append('Observations ');
  const area = document.createElement('textarea');
  label.appendChild(area);
  container.appendChild(label);
  const keyOf = () => draftFields(container).find(f => f.el === area)!.key;
  const before = keyOf();
  act(() => { writeFieldValue(area, 'Breathless on exertion'); });
  area.textContent = 'Breathless on exertion';
  expect(keyOf()).toBe(before);
  expect(before).toBe('textarea:Observations');
});

it('does not take fields from a nested draft region', () => {
  const nested = document.createElement('div');
  nested.setAttribute(DRAFT_ROOT_ATTR, '');
  const input = document.createElement('input');
  input.setAttribute('aria-label', 'Inner');
  nested.appendChild(input);
  container.appendChild(nested);
  expect(draftFields(container).map(f => f.key)).not.toContain('input:Inner');
  expect(draftFields(nested).map(f => f.key)).toEqual(['input:Inner']);
});

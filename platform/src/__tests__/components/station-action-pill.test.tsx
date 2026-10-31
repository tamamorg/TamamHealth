/**
 * A station row's pill is its action menu: it offers what can happen next, a
 * pick hands off to the slider (nothing is written from the row), and finished
 * work has no dropdown at all.
 */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import StationActionPill from '@/components/ehr/StationActionPill';
import { benchActions } from '@/components/lab/workflow/lab-workflow-types';
import { counterActions, counterPillLabel } from '@/components/pharmacy/workflow/pharmacy-workflow-types';

const t = (key: string) => key;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('StationActionPill', () => {
  it('hands the pick to the slider and writes nothing itself', () => {
    const onPick = jest.fn();
    act(() => root.render(<StationActionPill label="To collect" actions={[{ value: 'next', label: 'Collect specimen' }]} ariaLabel="Next" onPick={onPick} />));
    const select = host.querySelector('select')!;
    act(() => { select.value = 'next'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(onPick).toHaveBeenCalledWith('next');
  });

  it('has no dropdown once the work is finished, and only opens it', () => {
    const onOpen = jest.fn();
    act(() => root.render(<StationActionPill label="Resulted" actions={[]} ariaLabel="Open" onOpen={onOpen} />));
    expect(host.querySelector('select')).toBeNull();
    act(() => host.querySelector('button')!.click());
    expect(onOpen).toHaveBeenCalled();
  });
});

describe('what a row offers', () => {
  it('lab: the next step, rejection only once a specimen is in hand, nothing after a result', () => {
    expect(benchActions('ordered', t).map(a => a.value)).toEqual(['next']);
    expect(benchActions('specimen_collected', t).map(a => a.value)).toEqual(['next', 'reject']);
    expect(benchActions('in_process', t)[0].label).toBe('labFlow.nextResult');
    for (const stage of ['resulted', 'reviewed_by_clinician', 'acted_upon', 'communicated_to_patient'] as const) {
      expect(benchActions(stage, t)).toEqual([]);
    }
  });

  it('pharmacy: one fill, with its two other outcomes, whatever stage the record is at; nothing once given out', () => {
    for (const stage of ['prescribed', 'received_in_pharmacy_queue', 'under_review', 'cleared_for_dispensing', 'held_awaiting_clarification'] as const) {
      expect(counterActions(stage, t).map(a => a.value)).toEqual(['next', 'hold', 'stockout']);
    }
    for (const stage of ['dispensed', 'counseled', 'complete'] as const) expect(counterActions(stage, t)).toEqual([]);
  });

  it('pharmacy: the pill reports where the script stands, not a step', () => {
    expect(counterPillLabel('under_review', t)).toBe('rxFlow.pillToFill');
    expect(counterPillLabel('held_awaiting_clarification', t)).toBe('rxFlow.pillOnHold');
    expect(counterPillLabel('complete', t)).toBe('rxFlow.pillDispensed');
  });
});

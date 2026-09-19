import { renderToStaticMarkup } from 'react-dom/server';
import EhrStageDonut, { type StageSegment } from '@/components/ehr/EhrStageDonut';

const WAITING = 'var(--chart-1)';
const IN_SERVICE = 'var(--chart-5)';
const FINISHED = 'var(--color-success)';

const stages = (waiting: number, inService: number, finished: number): StageSegment[] => [
  { name: 'Waiting', value: waiting },
  { name: 'In service', value: inService },
  { name: 'Finished', value: finished },
];

function render(segments: StageSegment[]) {
  document.body.innerHTML = renderToStaticMarkup(<EhrStageDonut segments={segments} />);
  const ring = document.querySelector<HTMLElement>('.ehr-stage-donut-ring');
  const dots = Array.from(document.querySelectorAll<HTMLElement>('.ehr-stage-donut-legend i'));
  return {
    gradient: ring?.getAttribute('style') ?? '',
    dotColors: dots.map(dot => dot.getAttribute('style') ?? ''),
  };
}

describe('arrivals-by-stage donut', () => {
  it('draws a lone non-first stage in its own colour, not the first stage\'s', () => {
    // One patient in service, nobody waiting: the ring used to index colours
    // over the filtered slices and came out "Waiting" blue.
    const { gradient, dotColors } = render(stages(0, 1, 0));

    expect(gradient).toContain(`${IN_SERVICE} 0deg 360deg`);
    expect(gradient).not.toContain(WAITING);
    expect(dotColors[1]).toContain(IN_SERVICE);
  });

  it('splits the ring by each stage\'s share of the total', () => {
    const { gradient } = render(stages(1, 2, 1));

    expect(gradient).toContain(`${WAITING} 0deg 90deg`);
    expect(gradient).toContain(`${IN_SERVICE} 90deg 270deg`);
    expect(gradient).toContain(`${FINISHED} 270deg 360deg`);
  });

  it('keeps each slice matched to its legend dot when a middle stage is empty', () => {
    const { gradient, dotColors } = render(stages(3, 0, 1));

    expect(gradient).toContain(`${WAITING} 0deg 270deg`);
    expect(gradient).toContain(`${FINISHED} 270deg 360deg`);
    expect(gradient).not.toContain(IN_SERVICE);
    expect(dotColors).toEqual([
      expect.stringContaining(WAITING),
      expect.stringContaining(IN_SERVICE),
      expect.stringContaining(FINISHED),
    ]);
  });

  it('honours explicit segment colours', () => {
    const { gradient } = render([
      { name: 'Emergency', value: 0, color: '#9E1B14' },
      { name: 'Urgent', value: 1, color: '#B35900' },
      { name: 'Routine', value: 3, color: '#0A6E4A' },
    ]);

    expect(gradient).toContain('#B35900 0deg 90deg');
    expect(gradient).toContain('#0A6E4A 90deg 360deg');
  });

  it('still draws one quiet band on an empty day', () => {
    const { gradient } = render(stages(0, 0, 0));

    expect(gradient).toContain('0deg 360deg');
    expect(gradient).not.toContain(WAITING);
  });
});

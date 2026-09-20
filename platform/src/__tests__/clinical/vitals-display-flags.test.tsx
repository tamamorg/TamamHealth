import { renderToStaticMarkup } from 'react-dom/server';
import { assessVitalsForDisplay } from '@/lib/clinical/vitals';
import ChartVitalsBand from '@/components/ehr/chart/ChartVitalsBand';

jest.mock('@/lib/hooks/useNow', () => ({ useNow: () => Date.parse('2026-09-19T14:30:00.000Z') }));

/** The readings on the reported chart: "Test User", born the day before. */
const REPORTED = {
  systolic: 130, diastolic: 90, pulse: 73, respiratoryRate: 17,
  oxygenSaturation: 100, temperature: 40, weight: 70, height: 180,
};
const ONE_DAY_OLD = 1 / 365;

describe('assessVitalsForDisplay', () => {
  it('flags the reported neonate: 40°C is critical, pulse 73 and RR 17 are dangerously LOW for the age', () => {
    const flags = assessVitalsForDisplay(REPORTED, ONE_DAY_OLD);

    expect(flags.temperature).toMatchObject({ level: 'critical', direction: 'high' });
    expect(flags.pulse).toMatchObject({ level: 'high_risk', direction: 'low' });
    expect(flags.respiratoryRate).toMatchObject({ level: 'high_risk', direction: 'low' });
    // Age alone is an IITT RED criterion under 8 days, whatever the numbers say.
    expect(flags.patientAge).toMatchObject({ level: 'critical' });
    expect(flags.oxygenSaturation).toBeUndefined();
  });

  it('reads the same numbers differently for an adult — only the fever stands out', () => {
    const flags = assessVitalsForDisplay(REPORTED, 34);

    expect(flags.temperature).toMatchObject({ level: 'high_risk', direction: 'high' });
    expect(flags.pulse).toBeUndefined();
    expect(flags.respiratoryRate).toBeUndefined();
    // 130/90 sits on the normal boundary of the shared ranges (>140 / >90).
    expect(flags.systolic).toBeUndefined();
    expect(flags.diastolic).toBeUndefined();
  });

  it('marks a reading outside normal but short of a danger band as abnormal, with its direction', () => {
    const flags = assessVitalsForDisplay({ systolic: 150, diastolic: 58, temperature: 38.7, oxygenSaturation: 94 }, 40);

    expect(flags.systolic).toMatchObject({ level: 'abnormal', direction: 'high' });
    expect(flags.diastolic).toMatchObject({ level: 'abnormal', direction: 'low' });
    expect(flags.temperature).toMatchObject({ level: 'abnormal', direction: 'high' });
    expect(flags.oxygenSaturation).toMatchObject({ level: 'abnormal', direction: 'low' });
    expect(flags.systolic!.message).toContain('above the normal range');
  });

  it('does not call a healthy infant tachycardic by adult ranges', () => {
    // Pulse 130 / RR 35 are normal under one year; adults flag at >100 and >24.
    const flags = assessVitalsForDisplay({ pulse: 130, respiratoryRate: 35, systolic: 80, diastolic: 50 }, 0.5);

    expect(flags.pulse).toBeUndefined();
    expect(flags.respiratoryRate).toBeUndefined();
    expect(flags.systolic).toBeUndefined();
    expect(flags.diastolic).toBeUndefined();
  });

  it('applies the pregnancy blood-pressure rule as critical', () => {
    expect(assessVitalsForDisplay({ systolic: 165, diastolic: 112 }, 28).systolic?.level).toBe('abnormal');
    expect(assessVitalsForDisplay({ systolic: 165, diastolic: 112 }, 28, { isPregnant: true }).systolic)
      .toMatchObject({ level: 'critical', direction: 'high' });
  });

  it('lets RED outrank YELLOW and says when adult ranges were assumed', () => {
    const flags = assessVitalsForDisplay({ pulse: 160 });
    expect(flags.pulse).toMatchObject({ level: 'critical', direction: 'high' });

    const assumed = assessVitalsForDisplay({ respiratoryRate: 34 });
    expect(assumed.respiratoryRate!.message).toContain('Age unknown');
  });

  it('returns nothing for normal or missing readings', () => {
    expect(assessVitalsForDisplay({ systolic: 118, diastolic: 76, pulse: 72, respiratoryRate: 16, oxygenSaturation: 99, temperature: 36.8 }, 30)).toEqual({});
    expect(assessVitalsForDisplay({}, 30)).toEqual({});
  });
});

describe('chart vitals band', () => {
  function render(props: Partial<React.ComponentProps<typeof ChartVitalsBand>> = {}) {
    document.body.innerHTML = renderToStaticMarkup(
      <ChartVitalsBand
        latestVitals={REPORTED}
        latestRecordDate="2026-09-19T14:23:00.000Z"
        onViewVitalsHistory={jest.fn()}
        onRecordVitals={jest.fn()}
        canRecordVitals
        {...props}
      />,
    );
    const cell = (label: string) => Array.from(document.querySelectorAll<HTMLElement>('.tamam-vitals-cell'))
      .find(el => el.querySelector('.tamam-vitals-label')?.textContent === label)!;
    return { cell, alert: document.querySelector<HTMLElement>('.tamam-vitals-alert') };
  }

  it('draws the reported neonate\'s extremes as flagged cells, with direction and reason', () => {
    const { cell, alert } = render({ patientAgeYears: ONE_DAY_OLD });

    expect(cell('Temp').dataset.flag).toBe('critical');
    expect(cell('Temp').querySelector('.tamam-vitals-arrow')?.textContent).toBe('↑↑');
    expect(cell('Heart rate').dataset.flag).toBe('high_risk');
    expect(cell('Heart rate').querySelector('.tamam-vitals-arrow')?.textContent).toBe('↓');
    expect(cell('R. rate').dataset.flag).toBe('high_risk');
    expect(cell('SpO2').dataset.flag).toBeUndefined();

    // Not colour alone: the reason is on hover and in the accessibility tree.
    expect(cell('Temp').getAttribute('title')).toContain('40');
    expect(cell('Temp').querySelector('.tamam-vitals-sr')?.textContent).toContain('40');

    expect(alert?.dataset.level).toBe('critical');
    expect(alert?.textContent).toContain('Critical readings');
    expect(alert?.querySelector('b')?.textContent).toBe('3');
    expect(alert?.getAttribute('title')).toContain('under 8 days');
  });

  it('takes the worse of systolic and diastolic for the single BP cell', () => {
    const { cell } = render({ latestVitals: { systolic: 150, diastolic: 125 }, patientAgeYears: 50 });

    expect(cell('BP').dataset.flag).toBe('high_risk');
    expect(cell('BP').getAttribute('title')).toContain('Diastolic');
    expect(cell('BP').getAttribute('title')).toContain('Systolic');
  });

  it('stays quiet for a normal set and when there are no vitals at all', () => {
    const normal = render({ latestVitals: { systolic: 118, diastolic: 76, pulse: 72, temperature: 36.8 }, patientAgeYears: 30 });
    expect(normal.alert).toBeNull();
    expect(document.querySelectorAll('[data-flag]')).toHaveLength(0);

    const none = render({ latestVitals: undefined });
    expect(none.alert).toBeNull();
    expect(none.cell('BP').textContent).toContain('--');
  });
});

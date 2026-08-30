/**
 * Config-driven thresholds for triage vital-sign screening.
 *
 * `getTriageVitalWarnings` (lib/clinical/vitals.ts) used to carry every
 * numeric boundary as an inline literal. That is fine for a single national
 * default, but the WHO/ICRC/MSF Interagency Integrated Triage Tool is
 * explicit that most of it is NOT a fixed international standard: its own
 * FAQ says target wait times are "locally determined" (red = immediate;
 * yellow ~2h and green 4–6h are given only as examples), and a facility
 * running a 5-tier ESI-style scale or a different acuity policy needs to be
 * able to say so without a code change. This module is the seam: every
 * threshold the vitals engine consults lives here, typed, defaulted to the
 * cited sourced values, and mergeable with a facility-level override.
 *
 * `DEFAULT_TRIAGE_POLICY` is the exact set of numbers `vitals.ts` used before
 * this module existed — passing no policy at all reproduces prior behaviour
 * bit for bit. Only `resolveTriagePolicy` lets a caller change anything.
 *
 * Wiring a real per-facility override: `FacilitySettings`
 * (lib/settings/facility-settings.ts) already carries a `clinicalPolicy`
 * section (triage scale, diagnosis coding, door-to-clinician minutes,
 * allergy hard-stop) that replicates per hospital and is the natural home for
 * a `triagePolicy` override object. Adding it there is schema surgery in a
 * file this pass does not own (`facility-settings.ts` is not in this
 * change's file list), so `resolveTriagePolicy` is exported and documented
 * but not yet called from a settings read path — see the triage clinical
 * core audit report for the follow-up.
 */

/** A single numeric threshold with the citation that justifies it. */
export interface CitedValue {
  value: number;
  source: string;
}

export interface TriagePolicy {
  /** Age at which the adult (not paediatric) vital-sign chart applies. */
  ageBands: {
    /** IITT/SATS select the adult chart at 12y+ (or >150cm on SATS); the
     *  paediatric chart applies below it. */
    adultMinYears: CitedValue;
  };

  /** WHO/ICRC/MSF IITT age-based paediatric criteria — independent of vitals. */
  infant: {
    /** Any infant younger than this is IITT RED regardless of vital signs. */
    under8DaysRedMaxAgeYears: CitedValue;
    /** An infant from the RED cutoff up to this age is IITT YELLOW. */
    eightDaysToSixMonthsYellowMaxAgeYears: CitedValue;
    /** Age below which an abnormal temperature is the RED "young infant
     *  emergency" criterion rather than the general high-risk YELLOW one. */
    neonatalTemperatureRedMaxAgeYears: CitedValue;
  };

  temperature: {
    lowC: CitedValue;
    highC: CitedValue;
  };

  spo2: {
    lowPercent: CitedValue;
  };

  adult: {
    pulse: { redLow: CitedValue; redHigh: CitedValue; yellowLow: CitedValue; yellowHigh: CitedValue };
    respiratoryRate: { yellowLow: CitedValue; yellowHigh: CitedValue };
    /** General (non-pregnancy) blood-pressure boundaries. IITT does not
     *  define a general numeric BP rule; NEWS2 supplies the low-systolic
     *  boundary and AHA/ACC supplies the severe-hypertension boundary. */
    bloodPressure: { systolicLow: CitedValue; systolicHigh: CitedValue; diastolicLow: CitedValue; diastolicHigh: CitedValue };
  };

  /** Age-banded paediatric pulse/respiratory-rate ranges, [low, high]. */
  child: {
    pulse: { under1: [number, number]; age1to4: [number, number]; age5to12: [number, number]; source: string };
    respiratoryRate: { under1: [number, number]; age1to4: [number, number]; age5to12: [number, number]; source: string };
  };

  /** IITT's only general numeric BP rule: pregnancy, and it is RED. */
  pregnancy: {
    sbpRedMin: CitedValue;
    dbpRedMin: CitedValue;
  };

  pain: {
    /** 0–10 NRS cut-point conventionally read as "severe". */
    severeMin: CitedValue;
  };

  glucose: {
    hypoRedMaxMmol: CitedValue;
    hyperYellowMinMmol: CitedValue;
  };

  gcs: {
    /** At or below this score: severe impairment, RED. */
    severeMaxScore: CitedValue;
    /** Below this (the scale's own ceiling): any impairment, YELLOW. */
    normalScore: CitedValue;
  };

  /** WHO MUAC malnutrition screen, ages 6–59 months. */
  muac: {
    eligibleMinAgeYears: CitedValue;
    eligibleMaxAgeYears: CitedValue;
    severeMaxCm: CitedValue;
    moderateMaxCm: CitedValue;
  };

  /**
   * Per-priority target time from triage to being seen. IITT's own FAQ:
   * "target times are locally determined" — red is immediate; yellow ~2h and
   * green 4–6h are given only as worked examples, not a standard. This is
   * therefore the most locally-variable section of the policy and the prime
   * candidate for a facility override. It is a distinct concept from
   * `patient-queue-service.ts`'s `TARGET_WAIT`, which times the gap between
   * front-desk STAGES (triage/rooming/consultation/…) regardless of acuity;
   * this times the gap from triage to being seen, by acuity. Not read by any
   * code yet — carried here so a facility that wants a different target
   * doesn't need a second config surface once one does.
   */
  targetWaitMinutesByPriority: {
    RED: CitedValue;
    YELLOW: CitedValue;
    GREEN: CitedValue;
  };
}

const IITT_SOURCE = 'WHO/ICRC/MSF Interagency Integrated Triage Tool (IITT) reference card, https://www.who.int/tools/triage';
const IITT_PAEDIATRIC_SOURCE = `${IITT_SOURCE} — paediatric (<12y) card`;
const IITT_ADULT_SOURCE = `${IITT_SOURCE} — adult (≥12y) card`;
const IITT_CHART_SELECTION_SOURCE = `${IITT_SOURCE}; SATS Training Manual 2012 (EMSSA) — adult chart applies at >12y (or >150cm on SATS)`;
const WHO_MUAC_SOURCE = 'WHO mid-upper arm circumference malnutrition screening, ages 6–59 months';
const NEWS2_SOURCE = 'Royal College of Physicians, National Early Warning Score 2 (NEWS2) — low-systolic boundary';
const AHA_ACC_SOURCE = 'AHA/ACC 2017 Hypertension Guideline — severe/hypertensive-urgency boundary';
const PAIN_SOURCE = 'Serlin RC et al., Pain 1995;61:277–284 (0–10 NRS mild/moderate/severe cut-points: severe ≥7); pre-existing platform convention';
const HYPOGLYCAEMIA_SOURCE = 'Consistent with ADA/EASD Level 2 hypoglycaemia (<3.0 mmol/L), Diabetes Care 2017;40:155–157; pre-existing platform convention, uncited before this policy — flagged for clinical review';
const HYPERGLYCAEMIA_SOURCE = 'Pre-existing platform "critical high" glucose alert convention; not tied to a specific external guideline — flagged for clinical review';
const GCS_SOURCE = 'Teasdale G, Jennett B. Lancet 1974;2:81–84 — Glasgow Coma Scale; ≤8 conventionally denotes severe impairment requiring airway protection, 15 is the scale\'s ceiling (normal)';
const IITT_FAQ_TARGET_TIMES_SOURCE = `${IITT_SOURCE} FAQ: target times are locally determined; red = immediate, yellow ≈2h and green 4–6h are given only as worked examples, not a fixed standard`;

/** WHO severe acute malnutrition MUAC threshold, ages 6–59 months. */
export const MUAC_SEVERE_CM = 11.5;
/** WHO moderate acute malnutrition MUAC threshold, ages 6–59 months. */
export const MUAC_MODERATE_CM = 12.5;

const cited = (value: number, source: string): CitedValue => ({ value, source });

/**
 * Exact reproduction of the values `vitals.ts` used before this module
 * existed. Passing no policy to `getTriageVitalWarnings` resolves to this.
 */
export const DEFAULT_TRIAGE_POLICY: TriagePolicy = {
  ageBands: {
    adultMinYears: cited(12, IITT_CHART_SELECTION_SOURCE),
  },
  infant: {
    under8DaysRedMaxAgeYears: cited(8 / 365.25, `${IITT_PAEDIATRIC_SOURCE} RED: "any infant under 8 days"`),
    eightDaysToSixMonthsYellowMaxAgeYears: cited(0.5, `${IITT_PAEDIATRIC_SOURCE} YELLOW: "any infant 8 days–6 months old"`),
    neonatalTemperatureRedMaxAgeYears: cited(2 / 12, `${IITT_PAEDIATRIC_SOURCE} RED: "age <2 months with temperature <36°C or >39°C"`),
  },
  temperature: {
    lowC: cited(36, `${IITT_ADULT_SOURCE}: high-risk temperature <36°C`),
    highC: cited(39, `${IITT_ADULT_SOURCE}: high-risk temperature >39°C`),
  },
  spo2: {
    lowPercent: cited(92, `${IITT_ADULT_SOURCE}: high-risk SpO2 <92%`),
  },
  adult: {
    pulse: {
      redLow: cited(50, `${IITT_ADULT_SOURCE} RED: HR <50`),
      redHigh: cited(150, `${IITT_ADULT_SOURCE} RED: HR >150`),
      yellowLow: cited(60, `${IITT_ADULT_SOURCE}: high-risk HR <60`),
      yellowHigh: cited(130, `${IITT_ADULT_SOURCE}: high-risk HR >130`),
    },
    respiratoryRate: {
      yellowLow: cited(10, `${IITT_ADULT_SOURCE}: high-risk RR <10`),
      yellowHigh: cited(30, `${IITT_ADULT_SOURCE}: high-risk RR >30`),
    },
    bloodPressure: {
      systolicLow: cited(90, `${NEWS2_SOURCE} (systolic ≤90)`),
      systolicHigh: cited(180, `${AHA_ACC_SOURCE} (systolic >180)`),
      diastolicLow: cited(40, `${NEWS2_SOURCE}-derived low-diastolic boundary (≤40)`),
      diastolicHigh: cited(120, `${AHA_ACC_SOURCE} (diastolic >120)`),
    },
  },
  child: {
    pulse: {
      under1: [90, 180],
      age1to4: [80, 160],
      age5to12: [70, 140],
      source: `${IITT_PAEDIATRIC_SOURCE}: age-banded high-risk heart rate`,
    },
    respiratoryRate: {
      under1: [25, 50],
      age1to4: [20, 40],
      age5to12: [10, 30],
      source: `${IITT_PAEDIATRIC_SOURCE}: age-banded high-risk respiratory rate`,
    },
  },
  pregnancy: {
    sbpRedMin: cited(160, `${IITT_SOURCE}: "PREGNANT WITH ANY OF … SBP ≥160" — RED`),
    dbpRedMin: cited(110, `${IITT_SOURCE}: "PREGNANT WITH ANY OF … DBP ≥110" — RED`),
  },
  pain: {
    severeMin: cited(7, PAIN_SOURCE),
  },
  glucose: {
    hypoRedMaxMmol: cited(3, HYPOGLYCAEMIA_SOURCE),
    hyperYellowMinMmol: cited(25, HYPERGLYCAEMIA_SOURCE),
  },
  gcs: {
    severeMaxScore: cited(8, GCS_SOURCE),
    normalScore: cited(15, GCS_SOURCE),
  },
  muac: {
    eligibleMinAgeYears: cited(0.5, `${WHO_MUAC_SOURCE} (from 6 months)`),
    eligibleMaxAgeYears: cited(5, `${WHO_MUAC_SOURCE} (to 59 months)`),
    severeMaxCm: cited(MUAC_SEVERE_CM, `${WHO_MUAC_SOURCE}: severe acute malnutrition <11.5cm`),
    moderateMaxCm: cited(MUAC_MODERATE_CM, `${WHO_MUAC_SOURCE}: moderate acute malnutrition 11.5–12.5cm`),
  },
  targetWaitMinutesByPriority: {
    RED: cited(0, `${IITT_FAQ_TARGET_TIMES_SOURCE} (red = immediate)`),
    YELLOW: cited(120, `${IITT_FAQ_TARGET_TIMES_SOURCE} (yellow ≈2h example)`),
    GREEN: cited(270, `${IITT_FAQ_TARGET_TIMES_SOURCE} (green 4–6h example; midpoint used)`),
  },
};

/**
 * A deep-partial override for any subset of the policy tree, at any depth.
 * Recurses through plain nested objects (`adult.pulse`, `child`, …); at a
 * `CitedValue` leaf it stops and allows a partial `{ value?, source? }`
 * (see `mergeCited`); at a fixed-size age-band tuple (`child.pulse.under1`)
 * it allows only a whole-tuple replacement, matching how `resolveTriagePolicy`
 * actually merges one — there is no meaningful "partial tuple".
 */
type DeepPartialPolicy<T> = T extends CitedValue
  ? Partial<CitedValue>
  : T extends readonly [number, number]
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartialPolicy<T[K]> }
      : T;

export type TriagePolicyOverride = DeepPartialPolicy<TriagePolicy>;

function mergeCited(base: CitedValue, override?: Partial<CitedValue>): CitedValue {
  if (!override) return base;
  return { value: override.value ?? base.value, source: override.source ?? base.source };
}

/**
 * Deep-merge a partial override onto the sourced defaults. Every leaf falls
 * back independently, so an override supplying only
 * `{ adult: { pulse: { redLow: { value: 55 } } } }` changes nothing else —
 * including the `source` string of the value it left untouched, and the
 * `source` of the value it DID touch if the override didn't supply a new one
 * (an admin who moves a number without recording why still has the
 * previous citation rather than an empty one).
 *
 * `orgSettings` is typed loosely (`Partial<TriagePolicy> | null | undefined`)
 * rather than tied to a concrete facility-settings shape, because no such
 * shape carries a `triagePolicy` field yet — see the module docstring. A
 * future settings read path can pass `facilitySettings.triagePolicy` here
 * directly once that field exists.
 */
export function resolveTriagePolicy(orgSettings?: TriagePolicyOverride | null): TriagePolicy {
  if (!orgSettings) return DEFAULT_TRIAGE_POLICY;
  const d = DEFAULT_TRIAGE_POLICY;
  return {
    ageBands: {
      adultMinYears: mergeCited(d.ageBands.adultMinYears, orgSettings.ageBands?.adultMinYears),
    },
    infant: {
      under8DaysRedMaxAgeYears: mergeCited(d.infant.under8DaysRedMaxAgeYears, orgSettings.infant?.under8DaysRedMaxAgeYears),
      eightDaysToSixMonthsYellowMaxAgeYears: mergeCited(d.infant.eightDaysToSixMonthsYellowMaxAgeYears, orgSettings.infant?.eightDaysToSixMonthsYellowMaxAgeYears),
      neonatalTemperatureRedMaxAgeYears: mergeCited(d.infant.neonatalTemperatureRedMaxAgeYears, orgSettings.infant?.neonatalTemperatureRedMaxAgeYears),
    },
    temperature: {
      lowC: mergeCited(d.temperature.lowC, orgSettings.temperature?.lowC),
      highC: mergeCited(d.temperature.highC, orgSettings.temperature?.highC),
    },
    spo2: {
      lowPercent: mergeCited(d.spo2.lowPercent, orgSettings.spo2?.lowPercent),
    },
    adult: {
      pulse: {
        redLow: mergeCited(d.adult.pulse.redLow, orgSettings.adult?.pulse?.redLow),
        redHigh: mergeCited(d.adult.pulse.redHigh, orgSettings.adult?.pulse?.redHigh),
        yellowLow: mergeCited(d.adult.pulse.yellowLow, orgSettings.adult?.pulse?.yellowLow),
        yellowHigh: mergeCited(d.adult.pulse.yellowHigh, orgSettings.adult?.pulse?.yellowHigh),
      },
      respiratoryRate: {
        yellowLow: mergeCited(d.adult.respiratoryRate.yellowLow, orgSettings.adult?.respiratoryRate?.yellowLow),
        yellowHigh: mergeCited(d.adult.respiratoryRate.yellowHigh, orgSettings.adult?.respiratoryRate?.yellowHigh),
      },
      bloodPressure: {
        systolicLow: mergeCited(d.adult.bloodPressure.systolicLow, orgSettings.adult?.bloodPressure?.systolicLow),
        systolicHigh: mergeCited(d.adult.bloodPressure.systolicHigh, orgSettings.adult?.bloodPressure?.systolicHigh),
        diastolicLow: mergeCited(d.adult.bloodPressure.diastolicLow, orgSettings.adult?.bloodPressure?.diastolicLow),
        diastolicHigh: mergeCited(d.adult.bloodPressure.diastolicHigh, orgSettings.adult?.bloodPressure?.diastolicHigh),
      },
    },
    child: {
      pulse: { ...d.child.pulse, ...(orgSettings.child?.pulse ?? {}) },
      respiratoryRate: { ...d.child.respiratoryRate, ...(orgSettings.child?.respiratoryRate ?? {}) },
    },
    pregnancy: {
      sbpRedMin: mergeCited(d.pregnancy.sbpRedMin, orgSettings.pregnancy?.sbpRedMin),
      dbpRedMin: mergeCited(d.pregnancy.dbpRedMin, orgSettings.pregnancy?.dbpRedMin),
    },
    pain: {
      severeMin: mergeCited(d.pain.severeMin, orgSettings.pain?.severeMin),
    },
    glucose: {
      hypoRedMaxMmol: mergeCited(d.glucose.hypoRedMaxMmol, orgSettings.glucose?.hypoRedMaxMmol),
      hyperYellowMinMmol: mergeCited(d.glucose.hyperYellowMinMmol, orgSettings.glucose?.hyperYellowMinMmol),
    },
    gcs: {
      severeMaxScore: mergeCited(d.gcs.severeMaxScore, orgSettings.gcs?.severeMaxScore),
      normalScore: mergeCited(d.gcs.normalScore, orgSettings.gcs?.normalScore),
    },
    muac: {
      eligibleMinAgeYears: mergeCited(d.muac.eligibleMinAgeYears, orgSettings.muac?.eligibleMinAgeYears),
      eligibleMaxAgeYears: mergeCited(d.muac.eligibleMaxAgeYears, orgSettings.muac?.eligibleMaxAgeYears),
      severeMaxCm: mergeCited(d.muac.severeMaxCm, orgSettings.muac?.severeMaxCm),
      moderateMaxCm: mergeCited(d.muac.moderateMaxCm, orgSettings.muac?.moderateMaxCm),
    },
    targetWaitMinutesByPriority: {
      RED: mergeCited(d.targetWaitMinutesByPriority.RED, orgSettings.targetWaitMinutesByPriority?.RED),
      YELLOW: mergeCited(d.targetWaitMinutesByPriority.YELLOW, orgSettings.targetWaitMinutesByPriority?.YELLOW),
      GREEN: mergeCited(d.targetWaitMinutesByPriority.GREEN, orgSettings.targetWaitMinutesByPriority?.GREEN),
    },
  };
}

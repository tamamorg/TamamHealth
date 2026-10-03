'use client';

/**
 * The drug panel beside the prescribing form: what is known about the drug in
 * front of the prescriber, and what is known about giving it to THIS patient.
 *
 * The reference product fills this rail from a licensed monograph database
 * (brand names, pronunciation, per-drug counselling text). This platform does
 * not bundle one, and inventing counselling text for a medicine is not a
 * cosmetic shortcut — it is a clinical safety problem. So the rail keeps the
 * reference's shape (identity → dosage context → Warnings / Uses / Cautions)
 * and fills it only from data the platform actually holds:
 *
 *   · identity + brand + class come from the WHO-EML formulary,
 *   · dosage context is the patient's own observations (weight drives most
 *     paediatric EML dosing),
 *   · Warnings are computed live — interactions against this patient's active
 *     medicines and their recorded allergies,
 *   · Cautions are this facility's dispensing realities: controlled-drug
 *     handling, stock on hand, expiry.
 *
 * Sections with nothing real to say say so, rather than filling the space.
 */

import { useState } from 'react';
import type { FormularyDrug } from '@/lib/data/formulary';
import type { StockPosition } from '@/lib/pharmacy-stock-position';

export interface MonographWarning {
  severity: 'contraindicated' | 'serious' | 'moderate' | 'minor' | 'allergy';
  text: string;
}

interface DrugMonographPanelProps {
  drug: FormularyDrug | null;
  /** Live interaction + allergy findings for this patient. */
  warnings: MonographWarning[];
  /** "Wt 62 kg · 60 y" — empty when the chart holds no usable observation. */
  observations: string;
  /** The drug's position on this facility's shelf at the prescribed quantity.
   *  Null when the facility has no on-site pharmacy. */
  stock: StockPosition | null;
  /** The patient's current medicines, for context under the warnings. */
  currentMedications: string[];
}

/** Brand in parentheses — "Artemether-Lumefantrine (Coartem)" → "Coartem". */
function brandOf(drug: FormularyDrug): string | null {
  const m = drug.name.match(/\(([^)]+)\)/);
  if (!m) return null;
  // "(injection)" is a dosage form, not a brand.
  return /injection|tablet|capsule|syrup|suspension|oral|iv|im/i.test(m[1]) ? null : m[1];
}

/** Generic stem — the name without its brand or form parenthetical. */
function genericOf(drug: FormularyDrug): string {
  return drug.name.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
}

export default function DrugMonographPanel({
  drug, warnings, observations, stock, currentMedications,
}: DrugMonographPanelProps) {
  const [openSection, setOpenSection] = useState<'warnings' | 'uses' | 'cautions'>('warnings');

  if (!drug) {
    return <p className="cn-card-empty">Pick a drug to see what it means for this patient.</p>;
  }

  const brand = brandOf(drug);
  const cautions: string[] = [];
  if (stock?.controlledSchedule) {
    cautions.push(`Controlled drug (schedule ${stock.controlledSchedule}) — register entry required at dispensing.`);
  }
  if (stock?.requiresWitness) {
    cautions.push('Dispensing must be witnessed and co-signed.');
  }
  // The same shelf position the form's stock notice shows — every in-date
  // batch summed, judged against the quantity being prescribed.
  if (!stock) {
    cautions.push('This facility has no on-site pharmacy — the patient fills this at an outside pharmacy.');
  } else if (stock.state === 'untracked') {
    cautions.push('Stock is not tracked at this facility.');
  } else if (stock.state === 'not_stocked') {
    cautions.push('Not stocked at this facility — the patient may need an external pharmacy.');
  } else if (stock.state === 'expired') {
    cautions.push('Only expired stock remains at this facility.');
  } else if (stock.state === 'out') {
    cautions.push('Out of stock at this facility.');
  } else {
    const unit = stock.unit ? ` ${stock.unit}` : '';
    const qualifier = stock.state === 'short'
      ? ` — less than the ${stock.requested} prescribed`
      : stock.state === 'low' ? ' — at or below reorder level' : '';
    cautions.push(`Stock at this facility: ${stock.available}${unit}${qualifier}.`);
    if (stock.soonestExpiry) cautions.push(`Batch ${stock.soonestBatch || '—'} expires ${stock.soonestExpiry}.`);
  }

  return (
    <div className="cn-rx-monograph">
      <h3 className="cn-rx-drugname">{genericOf(drug).toUpperCase()}</h3>
      <p className="cn-rx-drugform">
        {[drug.form, drug.category].filter(Boolean).join(' · ')}
      </p>

      <h4 className="cn-rx-panelhead">Common Brand Names</h4>
      <p className="cn-rx-panelbody">{brand || 'Not recorded in the formulary.'}</p>

      <h4 className="cn-rx-panelhead">Recommended Dosage</h4>
      <p className="cn-rx-panelbody">
        {observations || 'No patient observations available.'}
      </p>

      <div className="cn-rx-tabs" role="tablist" aria-label="Drug information">
        {(['warnings', 'uses', 'cautions'] as const).map(key => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={openSection === key}
            onClick={() => setOpenSection(key)}
          >
            {key === 'warnings' ? 'Warnings' : key === 'uses' ? 'Uses' : 'Cautions'}
            {key === 'warnings' && warnings.length > 0 ? ` · ${warnings.length}` : ''}
          </button>
        ))}
      </div>

      {openSection === 'warnings' && (
        <>
          {warnings.length === 0 ? (
            <p className="cn-rx-panelbody">
              No interaction or allergy warnings for this patient.
            </p>
          ) : (
            <ul className="cn-rx-warnings">
              {warnings.map(w => (
                <li key={w.text} data-severity={w.severity}>{w.text}</li>
              ))}
            </ul>
          )}
          {currentMedications.length > 0 && (
            <>
              <h4 className="cn-rx-panelhead">Checked against</h4>
              <ul className="cn-rx-warnings cn-rx-currentmeds">
                {currentMedications.slice(0, 8).map(m => <li key={m}>{m}</li>)}
              </ul>
            </>
          )}
        </>
      )}

      {openSection === 'uses' && (
        <ul className="cn-rx-warnings">
          <li>Class: {drug.category}</li>
          <li>WHO ATC: {drug.atc}</li>
          {drug.form && <li>Form: {drug.form}</li>}
          <li className="cn-rx-note">
            Indication text is not bundled with this formulary — record the
            indication in Reason For Rx so it reaches the pharmacy.
          </li>
        </ul>
      )}

      {openSection === 'cautions' && (
        <ul className="cn-rx-warnings">
          {cautions.map(c => <li key={c}>{c}</li>)}
        </ul>
      )}
    </div>
  );
}

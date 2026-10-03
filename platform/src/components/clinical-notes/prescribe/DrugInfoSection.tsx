'use client';

/**
 * Drug Info — the prescribing form itself: what drug, how much, how long, why,
 * and how the patient takes it.
 *
 * The typeahead searches drug names by default and widens to class and ATC
 * code under "Advanced Search", because a prescriber who cannot recall the
 * brand can usually recall the class ("antimalarial", "J01" …).
 */

import { useMemo } from 'react';
import { Star } from '@/components/icons/lucide';
import { FORMULARY, type FormularyDrug } from '@/lib/data/formulary';
import { useRoleFlag } from '@/lib/settings/useRoleSetting';
import type { PharmacyInventoryDoc, ProblemDoc } from '@/lib/db-types';
import { stockPositionFor, type StockPosition, type StockState } from '@/lib/pharmacy-stock-position';
import type { RxDraft } from './types';
import Select from '@/components/Select';
import StockNotice from './StockNotice';

const RECOMMENDED_SIGS = [
  'Once daily',
  'Twice daily with food',
  'Three times daily after meals',
  'Every 8 hours until the course is finished',
  'At bedtime',
  'As needed for pain, up to three times daily',
];

interface DrugInfoSectionProps {
  draft: RxDraft;
  onChange: (patch: Partial<RxDraft>) => void;
  /** Free-text in the drug box before a formulary entry is picked. */
  query: string;
  onQueryChange: (value: string) => void;
  advanced: boolean;
  onToggleAdvanced: () => void;
  /** Active problems offered as Reason For Rx. */
  problems: ProblemDoc[];
  serviceLocations: string[];
  isFavorite: boolean;
  onToggleFavorite: () => void;
  showSigs: boolean;
  onToggleSigs: () => void;
  showReasons: boolean;
  onToggleReasons: () => void;
  /** This facility's shelf. Drives the prescriber's "Show only in-stock
   *  medicines by default" setting and the stock tag on each search result.
   *  Omitted when the facility has no on-site pharmacy — stock is then moot. */
  inventory?: PharmacyInventoryDoc[];
  facilityId?: string;
  facilityName: string;
  /** Shelf position of the picked drug at the typed quantity. */
  stock?: StockPosition | null;
  /** Switch this prescription to an outside pharmacy. */
  onIssueOutside?: () => void;
}

/** Search-result tags for the states a prescriber should see before picking. */
const RESULT_STOCK_TAG: Partial<Record<StockState, string>> = {
  out: 'Out of stock',
  expired: 'Expired stock only',
  not_stocked: 'Not stocked',
  low: 'Low stock',
};

export default function DrugInfoSection({
  draft, onChange, query, onQueryChange, advanced, onToggleAdvanced,
  problems, serviceLocations, isFavorite, onToggleFavorite, showSigs, onToggleSigs,
  showReasons, onToggleReasons, inventory, facilityId, facilityName, stock, onIssueOutside,
}: DrugInfoSectionProps) {
  // "Show only in-stock medicines by default" (`rx.inStockOnly`). Advanced
  // search deliberately ignores it: that mode exists to find anything, and a
  // prescriber who has widened the search is asking for the full formulary.
  const inStockOnly = useRoleFlag('rx.inStockOnly', true);
  const results = useMemo<Array<{ drug: FormularyDrug; stock: StockState | null }>>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2 || draft.drug) return [];
    const match = (d: FormularyDrug) => (advanced
      ? d.name.toLowerCase().includes(q) || d.category.toLowerCase().includes(q) || d.atc.toLowerCase().startsWith(q)
      : d.name.toLowerCase().includes(q));
    // The same shelf question the stock notice asks, so a result tagged "in
    // stock" here cannot turn into "not stocked" once it is picked. An empty
    // shelf means stock is not tracked: nothing is filtered or tagged.
    const tracked = Boolean(inventory?.length);
    const found = FORMULARY.filter(match).map(drug => ({
      drug,
      stock: tracked ? stockPositionFor(drug.name, inventory!, 1, { facilityId }).state : null,
    }));
    // Filter, but never to nothing: if the pharmacy stocks none of the
    // matches, showing the full list beats an empty box that reads as "this
    // drug does not exist".
    const stocked = (!advanced && inStockOnly && tracked)
      ? found.filter(r => r.stock === 'ok' || r.stock === 'low' || r.stock === 'untracked')
      : found;
    return (stocked.length ? stocked : found).slice(0, advanced ? 16 : 8);
  }, [query, draft.drug, advanced, inStockOnly, inventory, facilityId]);

  return (
    <>
      <div className="cn-rx-grid">
        <label className="cn-rx-field cn-rx-field--wide">
          <span className="field-required">Drug Name</span>
          <input
            className="cn-input"
            placeholder={advanced ? 'Name, class or ATC code…' : 'Search the formulary…'}
            value={draft.drug?.name ?? query}
            onChange={e => { onChange({ drug: null }); onQueryChange(e.target.value); }}
            aria-label="Drug name"
          />
          {results.length > 0 && (
            <div className="cn-inc-results cn-rx-results">
              {results.map(({ drug: d, stock: state }) => (
                <button key={d.name} type="button" onClick={() => { onChange({ drug: d }); onQueryChange(''); }}>
                  <span>{d.name}</span>
                  <span className="cn-meds-row-meta">
                    {d.category}{d.form ? ` · ${d.form}` : ''}
                    {state && RESULT_STOCK_TAG[state] && (
                      <span className="cn-rx-stocktag" data-stock={state}>{RESULT_STOCK_TAG[state]}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </label>

        <label className="cn-rx-field">
          <span className="field-required">Quantity</span>
          <input
            className="cn-input"
            type="number" step="any"
            min={1}
            value={draft.quantity}
            onChange={e => onChange({ quantity: e.target.value })}
            aria-label="Quantity"
          />
          {draft.drug && (
            <span className="cn-rx-qtynote">
              Total quantity: {draft.quantity || '0'}
              {draft.drug.form ? ` × ${draft.drug.form.toLowerCase()}` : ''}
            </span>
          )}
        </label>

        <label className="cn-rx-field">
          <span>Refill</span>
          <Select
            className="cn-select"
            value={draft.refills}
            onChange={e => onChange({ refills: e.target.value })}
            aria-label="Refills"
          >
            {['0', '1', '2', '3', '4', '5', '6'].map(n => <option key={n} value={n}>{n}</option>)}
          </Select>
        </label>

        <label className="cn-rx-field">
          <span>Days Supply</span>
          <input
            className="cn-input"
            type="number" step="1"
            min={0}
            value={draft.daysSupply}
            onChange={e => onChange({ daysSupply: e.target.value })}
            aria-label="Days supply"
          />
        </label>

        <label className="cn-rx-field">
          <span>Effective On</span>
          <input
            className="cn-input"
            type="date"
            value={draft.effectiveOn}
            onChange={e => onChange({ effectiveOn: e.target.value })}
            aria-label="Effective on"
          />
        </label>
      </div>

      {draft.drug && stock && (
        <StockNotice position={stock} facilityName={facilityName} onIssueOutside={onIssueOutside} />
      )}

      <div className="cn-rx-inlinerow">
        <button
          type="button"
          className="cn-card-head-action"
          onClick={onToggleAdvanced}
          aria-pressed={advanced}
        >
          {advanced ? 'Advanced Search ✓' : 'Advanced Search'}
        </button>
        <label className="cn-meds-nkm">
          <input
            type="checkbox"
            checked={draft.allowSubstitution}
            onChange={e => onChange({ allowSubstitution: e.target.checked })}
          />
          Allow Substitution
        </label>
      </div>

      <div className="cn-rx-grid">
        <label className="cn-rx-field cn-rx-field--wide">
          <span>Service Location</span>
          <Select
            className="cn-select"
            value={draft.serviceLocation}
            onChange={e => onChange({ serviceLocation: e.target.value })}
            aria-label="Service location"
          >
            {serviceLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
          </Select>
        </label>

        <div className="cn-rx-field cn-rx-field--wide">
          <span>Reason For Rx</span>
          <div className="cn-rx-reason">
            {draft.reason
              ? <span className="cn-rx-reason-chip" title={draft.reason}>{draft.reason}</span>
              : <span className="cn-rx-reason-empty">None recorded</span>}
            {/* "Change" once a reason is cited — "Add Reason" next to a reason
                that is already there reads as a second one. */}
            <button
              type="button"
              className="cn-rx-reason-action"
              onClick={onToggleReasons}
              aria-expanded={showReasons}
            >
              {draft.reason ? 'Change' : 'Add Reason'}
            </button>
          </div>
          {showReasons && (
            <div className="cn-inc-results cn-rx-results">
              {problems.length === 0 && (
                <p className="cn-consent-note" style={{ padding: '8px 10px' }}>
                  No active problems to cite — add one from the Assessment.
                </p>
              )}
              {problems.map(p => (
                <button
                  key={p._id}
                  type="button"
                  onClick={() => {
                    onChange({ reason: `${p.icd11Code ? `${p.icd11Code} · ` : ''}${p.name}` });
                    onToggleReasons();
                  }}
                >
                  {p.icd11Code && <span className="cn-inc-code">{p.icd11Code}</span>}
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <label className="cn-rx-field cn-rx-field--wide">
        <span className="field-required">Patient Instructions</span>
        <textarea
          className="cn-textarea cn-rx-instructions"
          value={draft.instructions}
          onChange={e => onChange({ instructions: e.target.value })}
          placeholder="e.g. One tablet twice daily after food, for 5 days"
          aria-label="Patient instructions"
        />
      </label>

      <button
        type="button"
        className="cn-card-head-action cn-inc-details-toggle"
        onClick={onToggleSigs}
        aria-expanded={showSigs}
      >
        Recommended Sigs {showSigs ? '▾' : '▸'}
      </button>
      {showSigs && (
        <ul className="cn-rx-sigs">
          {RECOMMENDED_SIGS.map(sig => (
            <li key={sig}>
              <button type="button" onClick={() => onChange({ instructions: sig })}>• {sig}</button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="cn-rx-favorite"
        onClick={onToggleFavorite}
        disabled={!draft.drug}
        aria-pressed={isFavorite}
      >
        <Star size={13} /> {isFavorite ? 'In Favorites' : 'Add To Favorites'}
      </button>
    </>
  );
}

'use client';

/**
 * The O3 "Add drug order" / "Add test order" search step: Back to the basket,
 * a search field, and one tile per match with two ways on — straight into the
 * basket, or into the full order form first.
 */

import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, Search, ShoppingCart, X } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

export interface SearchItem {
  key: string;
  title: string;
  /** "Tablet", "Blood" — after an em dash, as O3 writes it. */
  detail?: string;
  /** Already in the basket: Add to basket would add it twice. */
  inBasket?: boolean;
}

export default function OrderSearchView({
  items, query, onQuery, placeholder, onBack, onAdd, onForm, header, showAllWhenEmpty, minQuery = 2,
}: {
  items: SearchItem[];
  query: string;
  onQuery: (value: string) => void;
  placeholder: string;
  onBack: () => void;
  onAdd: (key: string) => void;
  onForm: (key: string) => void;
  /** Lines under Back (the patient's allergies on a drug order). */
  header?: React.ReactNode;
  /** A short list (the lab catalogue) shows in full before anything is typed. */
  showAllWhenEmpty?: boolean;
  minQuery?: number;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const searching = query.trim().length >= minQuery;
  const visible = searching || showAllWhenEmpty ? items : [];

  return (
    <div className="obf-search">
      <div className="obf-search-top">
        <button type="button" className="obf-back" onClick={onBack}>
          <ArrowLeft aria-hidden /> {t('basket.backToBasket')}
        </button>
        {header}
      </div>
      <div className="obf-search-field">
        <Search aria-hidden />
        <input
          ref={input}
          type="search"
          value={query}
          onChange={e => onQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        {query && (
          <button type="button" className="obf-search-clear" onClick={() => onQuery('')} aria-label={t('basket.clearSearch')}>
            <X aria-hidden />
          </button>
        )}
      </div>
      <div className="obf-results">
        {searching && (
          <div className="obf-results-count">
            <span>{t('basket.resultsFor', { count: items.length, query: query.trim() })}</span>
            <button type="button" className="obf-link" onClick={() => onQuery('')}>{t('basket.clearResults')}</button>
          </div>
        )}
        {!searching && !showAllWhenEmpty && <p className="obf-hint">{t('basket.searchHint', { count: minQuery })}</p>}
        {searching && items.length === 0 && <p className="obf-hint">{t('basket.noMatches', { query: query.trim() })}</p>}
        <ul className="obf-tiles">
          {visible.map(item => (
            <li key={item.key} className="obf-tile">
              <p className="obf-tile-name">
                <strong>{item.title}</strong>{item.detail ? <span> — {item.detail}</span> : null}
              </p>
              <div className="obf-tile-actions">
                <button type="button" className="obf-link" onClick={() => onAdd(item.key)} disabled={item.inBasket}>
                  {item.inBasket ? t('basket.inBasket') : t('basket.addToBasket')} <ShoppingCart aria-hidden />
                </button>
                <button type="button" className="obf-link" onClick={() => onForm(item.key)}>
                  {t('basket.orderForm')} <ArrowRight aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

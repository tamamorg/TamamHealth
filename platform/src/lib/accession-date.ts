import { jubaDate } from './time-juba';

/**
 * The YYMMDD part of an accession number (`ACC-261106-…`), on the clinical day
 * (activeCountry's zone, Juba by default) rather than the UTC date: an order
 * placed at 23:00 UTC is already tomorrow's work at the bench. Existing stored
 * accession numbers are never recomputed; this only stamps new ones and the
 * fallback shown for orders that predate accessions.
 */
export function accessionDay(at: Date | string | number = new Date()): string {
  const date = new Date(at);
  const day = jubaDate(Number.isNaN(date.getTime()) ? new Date() : date);
  return day.slice(2).replace(/-/g, '');
}

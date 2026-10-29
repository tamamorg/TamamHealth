'use client';

/**
 * The patient's unsigned orders. They outlive the panel — a clinician who
 * closes the basket to check a result comes back to the same orders — so
 * they are kept per patient in the encrypted draft store (lib/draft-storage:
 * AES-GCM under a per-tab key, never plaintext, dropped at logout).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { dropDraft, loadDraft, saveDraft } from '@/lib/draft-storage';
import type { BasketOrder } from './basket-types';

const keyFor = (patientId: string) => `order-basket:${patientId}`;

interface BasketState {
  patientId: string;
  orders: BasketOrder[];
  loaded: boolean;
}

export function useOrderBasket(patientId: string) {
  const [state, setState] = useState<BasketState>({ patientId, orders: [], loaded: false });
  // Another patient's chart: start from an empty, not-yet-loaded basket.
  if (state.patientId !== patientId) setState({ patientId, orders: [], loaded: false });
  const orders = state.patientId === patientId ? state.orders : [];
  // The current list, for writers that run between renders. Kept in step by
  // the writers and the load below, never during render.
  const current = useRef<BasketOrder[]>([]);
  // Set once the clinician changes the basket: the stored copy, if it loads
  // after that, must not overwrite what they just did.
  const touched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    touched.current = false;
    current.current = [];
    void loadDraft<BasketOrder[]>(keyFor(patientId)).then(stored => {
      if (cancelled) return;
      if (!touched.current && Array.isArray(stored)) current.current = stored;
      const loadedOrders = current.current;
      setState(prev => (prev.patientId !== patientId ? prev : { patientId, orders: loadedOrders, loaded: true }));
    });
    return () => { cancelled = true; };
  }, [patientId]);

  const commit = useCallback((next: BasketOrder[]) => {
    touched.current = true;
    current.current = next;
    setState(prev => ({ ...prev, patientId, orders: next }));
    void (next.length ? saveDraft(keyFor(patientId), next) : dropDraft(keyFor(patientId)));
  }, [patientId]);

  /** Add an order, or replace the one with the same id (an edit). */
  const put = useCallback((order: BasketOrder) => {
    const prev = current.current;
    commit(prev.some(o => o.id === order.id) ? prev.map(o => (o.id === order.id ? order : o)) : [...prev, order]);
  }, [commit]);

  const remove = useCallback((id: string) => {
    commit(current.current.filter(o => o.id !== id));
  }, [commit]);

  return { orders, loaded: state.patientId === patientId && state.loaded, put, remove, replaceAll: commit };
}

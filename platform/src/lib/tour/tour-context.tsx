'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { getDefaultDashboard } from '@/lib/permissions';
import type { UserRole } from '@/lib/db-types';
import TourCard, { TourClickHint } from '@/components/tour/TourCard';
import { buildGenericTour } from './generic-steps';
import { journeyTourForRole } from './journey-tours';
import { hasSeenTour, markTourSeen } from './tour-storage';
import { hasBlockingDialog } from './tour-dom';
import { CLICK_PAUSE_MS, SCROLL_SETTLE_MS, SETTLE_MS, MODULE_TRIGGER, clickLabel, closeStrayDialog, findMenuGroup, findNavControl, isShown } from './tour-show';
import type { TourDefinition } from './types';

// Journey tours (one per role, derived from docs/USER-JOURNEYS.md) take
// priority; any role without one falls back to a generated shell tour
// (buildGenericTour), so "Take a tour" is available to every user.
function tourForRole(role: UserRole): TourDefinition {
  return journeyTourForRole(role) ?? buildGenericTour(role);
}

const MEASURE_RETRY_MS = 120;
const MEASURE_TIMEOUT_MS = 4000;

interface TourContextValue {
  /** Whether the signed-in user has a tour defined at all. */
  available: boolean;
  start: () => void;
}

const TourContext = createContext<TourContextValue>({ available: false, start: () => {} });

export function useTourContext(): TourContextValue {
  return useContext(TourContext);
}

/** A step route containing a `[param]` segment, e.g. `/patients/[id]`. */
function isDynamicRoute(route: string): boolean {
  return route.includes('[');
}

/**
 * Does the browser's path satisfy a step's route? Static routes match exactly;
 * a dynamic route matches segment-for-segment with `[param]` accepting any one
 * non-empty segment, so `/patients/[id]` matches `/patients/pat-00042` but not
 * `/patients` or `/patients/pat-1/labs`.
 */
function routeMatches(pathname: string, route: string): boolean {
  // A step may name a view of a page (`/epidemic-intelligence?tab=curves`):
  // the path decides whether we are on the page; the query is checked where
  // the tour navigates (queryMatches), since usePathname never carries it.
  route = routePath(route);
  if (!isDynamicRoute(route)) return pathname === route;
  const a = pathname.split('/').filter(Boolean);
  const b = route.split('/').filter(Boolean);
  if (a.length !== b.length) return false;
  return b.every((seg, i) => (seg.startsWith('[') && seg.endsWith(']') ? a[i].length > 0 : seg === a[i]));
}

/** A step route without its query string. */
function routePath(route: string): string {
  const q = route.indexOf('?');
  return q === -1 ? route : route.slice(0, q);
}

/** Whether the address bar already carries every query param the step names. */
function queryMatches(route: string): boolean {
  const q = route.indexOf('?');
  if (q === -1 || typeof window === 'undefined') return true;
  const want = new URLSearchParams(route.slice(q + 1));
  const have = new URLSearchParams(window.location.search);
  for (const [k, v] of want) if (have.get(k) !== v) return false;
  return true;
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const tour = useMemo(() => (currentUser ? tourForRole(currentUser.role) : undefined), [currentUser]);
  const steps = useMemo(() => tour?.steps ?? [], [tour]);

  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const autoStartedRef = useRef(false);
  // Some steps click the row they are describing and the next step lives on
  // the record that row opens. Remember that expected transition so the route
  // guard does not immediately send the user back to the list page.
  const pendingRouteStepRef = useRef<{ fromIndex: number; toIndex: number; route: string } | null>(null);

  const step = active ? steps[stepIndex] : undefined;

  // ── Show, don't move ──
  // While the tour clicks something on the user's behalf, the card steps
  // aside and a pointer rests on the control with its name ("Click
  // “Patients”") before the click lands. `demo` is that pointer; `runRef`
  // cancels a running sequence when the tour moves on or ends.
  const [demo, setDemo] = useState<{ rect: DOMRect; label: string } | null>(null);
  const runRef = useRef(0);
  const busyRef = useRef(false);
  // Set while next() is clicking its way to the next page. The route effect
  // must not push the CURRENT step's route back in that window: it saw the
  // new pathname before setStepIndex landed and bounced the user back and
  // forth (code review, 2026-11-05).
  const navigatingRef = useRef(false);
  const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  const showClick = useCallback(async (el: HTMLElement, run: number): Promise<boolean> => {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await wait(SCROLL_SETTLE_MS);
    if (runRef.current !== run || !el.isConnected) return false;
    const label = clickLabel(el);
    setDemo({ rect: el.getBoundingClientRect(), label });
    // Follow the control if the page shifts under it during the pause.
    for (let waited = 0; waited < CLICK_PAUSE_MS; waited += 250) {
      await wait(Math.min(250, CLICK_PAUSE_MS - waited));
      if (runRef.current !== run || !el.isConnected) break;
      setDemo({ rect: el.getBoundingClientRect(), label });
    }
    if (runRef.current !== run || !el.isConnected) { setDemo(null); return false; }
    el.click();
    // Keep the ring on the control for a beat after the click, so the page
    // change reads as caused by it.
    await wait(SETTLE_MS);
    setDemo(null);
    return runRef.current === run;
  }, []);
  const waitFor = useCallback(async <T,>(find: () => T | null, ms: number, run: number): Promise<T | null> => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (runRef.current !== run) return null;
      const found = find();
      if (found) return found;
      await wait(100);
    }
    return null;
  }, []);
  // Reach a page the way a user would: its link or top-bar shortcut if one
  // is on screen, else through the ☰ menu (and the group that holds it).
  // False when no control leads there; the route effect then pushes.
  const navigateVisibly = useCallback(async (route: string, run: number): Promise<boolean> => {
    const path = routePath(route);
    let control = findNavControl(path);
    if (!control) {
      const trigger = document.querySelector<HTMLElement>(MODULE_TRIGGER);
      if (!isShown(trigger)) return false;
      if (trigger.getAttribute('aria-expanded') !== 'true' && !(await showClick(trigger, run))) return false;
      control = await waitFor(() => findNavControl(path), 700, run);
      if (!control) {
        const group = await waitFor(() => findMenuGroup(path), 500, run);
        if (group && await showClick(group, run)) control = await waitFor(() => findNavControl(path), 700, run);
      }
      if (!control) {
        // Nothing in the menu leads there; close it again before the push.
        if (trigger.getAttribute('aria-expanded') === 'true') trigger.click();
        return false;
      }
    }
    return showClick(control, run);
  }, [showClick, waitFor]);

  const stop = useCallback(() => {
    pendingRouteStepRef.current = null;
    navigatingRef.current = false;
    runRef.current += 1;
    busyRef.current = false;
    setDemo(null);
    setActive(false);
    setRect(null);
  }, []);

  const finish = useCallback(() => {
    if (tour && currentUser) markTourSeen(tour.key, currentUser._id);
    stop();
  }, [tour, currentUser, stop]);

  const start = useCallback(() => {
    if (!tour) return;
    pendingRouteStepRef.current = null;
    setStepIndex(0);
    setRect(null);
    setActive(true);
  }, [tour]);

  // Auto-launch once per user, the first time they land on their role's home
  // dashboard (not just /dashboard — a lab tech lands on /dashboard/lab, a
  // pharmacist on /dashboard/pharmacy, … nurse-family roles now share
  // /dashboard with doctors, since the standalone nurse station was merged
  // into the shared clinical workspace). The ref is only marked once the timer
  // actually fires: context hydration right after login re-runs this effect
  // within the 600ms window, and marking earlier would let the cleanup cancel
  // the launch permanently.
  useEffect(() => {
    if (!tour || !currentUser || autoStartedRef.current) return;
    if (pathname !== getDefaultDashboard(currentUser.role)) return;
    if (hasSeenTour(tour.key, currentUser._id)) return;
    const timer = setTimeout(() => {
      autoStartedRef.current = true;
      start();
    }, 600);
    return () => clearTimeout(timer);
  }, [tour, currentUser, pathname, start]);

  // Follow the current step to its route.
  //
  // A step may name a dynamic route (`/patients/[id]`). Those cannot be
  // navigated to — there is no id to push — so the step instead rides along
  // once the user is already on a matching page: the previous step opens a
  // record (usually via `preClickSelector` on the first row), and this one
  // recognises where it landed. Without this, every detail page in the app —
  // the chart, the note, the triage form, the MAR — was unreachable by a
  // tour, which is most of what a clinician's day actually is.
  useEffect(() => {
    if (!active || !step) return;
    if (navigatingRef.current) return;
    if (isDynamicRoute(step.route)) return;
    if (pathname === routePath(step.route) && queryMatches(step.route)) return;

    const pending = pendingRouteStepRef.current;
    if (
      pending?.fromIndex === stepIndex &&
      pending.toIndex === stepIndex + 1 &&
      routeMatches(pathname, pending.route)
    ) {
      pendingRouteStepRef.current = null;
      setStepIndex(pending.toIndex);
      return;
    }

    pendingRouteStepRef.current = null;
    router.push(step.route);
  }, [active, step, stepIndex, pathname, router]);

  // Locate (and, if needed, reveal) the current step's target once we're on
  // the right route. Polls briefly since a fresh navigation's target may not
  // exist in the DOM the instant the route changes.
  useEffect(() => {
    if (!active || !step) return;
    // Clear the previous spotlight on the next paint. Keeping this inside the
    // browser callback avoids a synchronous effect-state cascade while still
    // preventing an old page's highlight from lingering during navigation.
    const clearRectFrame = requestAnimationFrame(() => setRect(null));
    if (!routeMatches(pathname, step.route)) {
      return () => cancelAnimationFrame(clearRectFrame);
    }

    // Narrative step with no anchor — render the card centred over the page.
    if (!step.target) {
      return () => cancelAnimationFrame(clearRectFrame);
    }

    let cancelled = false;
    let clickedPreStep = false;
    const startedAt = Date.now();

    // A click on the highlighted row can be the bridge into a dynamic record
    // route (its id only exists once the row handles the click). That click
    // is the NEXT step's way in, so it waits for Next (see `next`), where the
    // user watches it happen; here the step just points at the row.
    const nextStep = steps[stepIndex + 1];
    const bridge = !!step.preClickSelector && step.preClickSelector === step.target
      && !!nextStep && isDynamicRoute(nextStep.route);
    const run = runRef.current;

    const tick = () => {
      if (cancelled) return;
      if (step.preClickSelector && !clickedPreStep && !bridge) {
        const trigger = document.querySelector<HTMLElement>(step.preClickSelector);
        if (isShown(trigger)) {
          // A reveal click (a tab, a chip, a panel toggle): shown, then made.
          clickedPreStep = true;
          void showClick(trigger, run).then(() => { if (!cancelled) setTimeout(tick, MEASURE_RETRY_MS); });
          return;
        }
      }
      const el = document.querySelector<HTMLElement>(step.target);
      // Only accept a target that is actually visible: wizard stages hide
      // their sections with display:none, and a hidden element measures as a
      // zero rect at (0,0) — spotlighting that pins the highlight to the
      // screen corner. Keep polling instead; on timeout the card renders
      // centred like a narrative step.
      if (el && el.getBoundingClientRect().width > 0) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        requestAnimationFrame(() => {
          if (!cancelled) setRect(el.getBoundingClientRect());
        });
        return;
      }
      if (Date.now() - startedAt > MEASURE_TIMEOUT_MS) return;
      setTimeout(tick, MEASURE_RETRY_MS);
    };
    tick();

    return () => {
      cancelled = true;
      cancelAnimationFrame(clearRectFrame);
    };
  }, [active, step, stepIndex, steps, pathname, showClick]);

  // Keep the highlight glued to its target through scrolling/resizing.
  useEffect(() => {
    if (!active || !step || !rect || !step.target) return;
    const el = document.querySelector<HTMLElement>(step.target);
    if (!el) return;
    const onUpdate = () => setRect(el.getBoundingClientRect());
    window.addEventListener('scroll', onUpdate, true);
    window.addEventListener('resize', onUpdate);
    return () => {
      window.removeEventListener('scroll', onUpdate, true);
      window.removeEventListener('resize', onUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, step, rect !== null]);

  // Next shows how the user gets to the next step: the row that opens a
  // record, or the link / ☰ menu entry for the next page, clicked in front of
  // them. Back and the step list jump directly; that is a shortcut the user
  // asked for, not a lesson.
  const next = useCallback(async () => {
    if (busyRef.current) return;
    if (stepIndex >= steps.length - 1) { finish(); return; }
    const current = steps[stepIndex];
    const upcoming = steps[stepIndex + 1];
    const run = ++runRef.current;
    busyRef.current = true;
    try {
      pendingRouteStepRef.current = null;
      if (current.preClickSelector && current.preClickSelector === current.target && isDynamicRoute(upcoming.route)) {
        const row = document.querySelector<HTMLElement>(current.target);
        if (isShown(row)) {
          pendingRouteStepRef.current = { fromIndex: stepIndex, toIndex: stepIndex + 1, route: upcoming.route };
          const from = window.location.pathname;
          if (await showClick(row, run)) {
            // Already where the next step lives (a drawer opened on the same
            // record): move straight on.
            if (routeMatches(window.location.pathname, upcoming.route)) {
              pendingRouteStepRef.current = null;
              setStepIndex(stepIndex + 1);
              return;
            }
            // The route effect advances once the record opens; if the row
            // did not navigate, move on anyway rather than strand the tour.
            await waitFor(() => (window.location.pathname !== from ? true : null), 3000, run);
            if (runRef.current === run && window.location.pathname === from) {
              pendingRouteStepRef.current = null;
              setStepIndex(stepIndex + 1);
            }
          }
          return;
        }
      }
      // A popup this step opened (and the next step does not point into)
      // closes first, or it would hide the tour on the steps after.
      closeStrayDialog(upcoming.target || undefined);
      if (!isDynamicRoute(upcoming.route) && window.location.pathname !== routePath(upcoming.route)) {
        navigatingRef.current = true;
        try {
          await wait(150);
          await navigateVisibly(upcoming.route, run);
        } finally {
          navigatingRef.current = false;
        }
      }
      if (runRef.current === run) setStepIndex(stepIndex + 1);
    } finally {
      if (runRef.current === run) busyRef.current = false;
      setDemo(null);
    }
  }, [stepIndex, steps, finish, showClick, waitFor, navigateVisibly]);

  const back = useCallback(() => {
    runRef.current += 1;
    busyRef.current = false;
    setDemo(null);
    pendingRouteStepRef.current = null;
    setStepIndex(i => Math.max(0, i - 1));
  }, []);

  const jumpTo = useCallback((index: number) => {
    runRef.current += 1;
    busyRef.current = false;
    setDemo(null);
    pendingRouteStepRef.current = null;
    setStepIndex(index);
  }, []);

  // A dialog owns the screen while it is open. The tour card renders at
  // z-9999 — above every modal — so an active tour sat ON TOP of whatever
  // form the user opened mid-tour, hiding its fields behind the walkthrough
  // that was supposed to explain them (observed live over the patient
  // registration workspace). Watch for an open dialog and suspend the card;
  // it returns, same step, when the dialog closes.
  const [dialogOpen, setDialogOpen] = useState(false);
  useEffect(() => {
    if (!active) return;
    // The tour card is itself an accessible dialog. Counting it here creates
    // an oscillation: render card -> detect "dialog" -> hide card -> detect no
    // dialog -> render card, forever. Only suspend for a dialog owned by the
    // application underneath the tour.
    const check = () => setDialogOpen(hasBlockingDialog(document, step?.target || undefined));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [active, step]);

  // Esc ends the tour, permanently — the same promise the ✕ makes. Every
  // dismissable surface in the product answers Esc; the one whose whole job
  // is teaching the interface should not be the exception. The listener
  // yields to open dialogs: their own Esc handling closes THEM first.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (hasBlockingDialog()) return;
      finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, finish]);

  const value = useMemo(() => ({ available: !!tour, start }), [tour, start]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {active && demo && <TourClickHint rect={demo.rect} label={demo.label} />}
      {active && step && !dialogOpen && !demo && (
        <TourCard
          // Keyed per step so each new card fades in (globals.css .tour-card).
          key={step.id}
          step={step}
          rect={rect}
          index={stepIndex}
          total={steps.length}
          stepTitles={steps.map(s => s.title)}
          onJumpTo={jumpTo}
          onBack={stepIndex > 0 ? back : undefined}
          onNext={() => { void next(); }}
          onSkip={finish}
          isLast={stepIndex === steps.length - 1}
        />
      )}
    </TourContext.Provider>
  );
}

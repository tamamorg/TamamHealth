'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useApp } from '@/lib/context';
import { getDefaultDashboard } from '@/lib/permissions';
import type { UserRole } from '@/lib/db-types';
import TourCard from '@/components/tour/TourCard';
import { buildGenericTour } from './generic-steps';
import { journeyTourForRole } from './journey-tours';
import { hasSeenTour, markTourSeen } from './tour-storage';
import { hasBlockingDialog } from './tour-dom';
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
  if (!isDynamicRoute(route)) return pathname === route;
  const a = pathname.split('/').filter(Boolean);
  const b = route.split('/').filter(Boolean);
  if (a.length !== b.length) return false;
  return b.every((seg, i) => (seg.startsWith('[') && seg.endsWith(']') ? a[i].length > 0 : seg === a[i]));
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const { currentUser } = useApp();
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

  const stop = useCallback(() => {
    pendingRouteStepRef.current = null;
    setActive(false);
    setRect(null);
  }, []);

  const finish = useCallback(() => {
    if (tour && currentUser) markTourSeen(tour.key, currentUser._id);
    stop();
  }, [tour, currentUser, stop]);

  const start = useCallback(() => {
    if (!tour) return;
    // The Get Started onboarding overlay covers the home dashboard for new
    // users — exactly when the tour auto-launches. Ask it to collapse to its
    // pill so the tour can actually point at the page underneath.
    window.dispatchEvent(new CustomEvent('tamam:tour-started'));
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
    if (isDynamicRoute(step.route)) return;
    if (pathname === step.route) return;

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

    const tick = () => {
      if (cancelled) return;
      if (step.preClickSelector && !clickedPreStep) {
        const trigger = document.querySelector<HTMLElement>(step.preClickSelector);
        if (trigger) {
          const nextStep = steps[stepIndex + 1];
          // A click on the highlighted row can be the bridge into a dynamic
          // record route. The route cannot be pushed directly because its id
          // only becomes known after the row handles the click.
          if (
            step.preClickSelector === step.target &&
            nextStep &&
            isDynamicRoute(nextStep.route)
          ) {
            pendingRouteStepRef.current = {
              fromIndex: stepIndex,
              toIndex: stepIndex + 1,
              route: nextStep.route,
            };
          }
          trigger.click();
          clickedPreStep = true;
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
  }, [active, step, stepIndex, steps, pathname]);

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

  const next = useCallback(() => {
    if (stepIndex >= steps.length - 1) { finish(); return; }
    pendingRouteStepRef.current = null;
    setStepIndex(i => i + 1);
  }, [stepIndex, steps.length, finish]);

  const back = useCallback(() => {
    pendingRouteStepRef.current = null;
    setStepIndex(i => Math.max(0, i - 1));
  }, []);

  const jumpTo = useCallback((index: number) => {
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
    const check = () => setDialogOpen(hasBlockingDialog());
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [active]);

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
      {active && step && !dialogOpen && (
        <TourCard
          step={step}
          rect={rect}
          index={stepIndex}
          total={steps.length}
          stepTitles={steps.map(s => s.title)}
          onJumpTo={jumpTo}
          onBack={stepIndex > 0 ? back : undefined}
          onNext={next}
          onSkip={finish}
          isLast={stepIndex === steps.length - 1}
        />
      )}
    </TourContext.Provider>
  );
}

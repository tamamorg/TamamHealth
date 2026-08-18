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

  const step = active ? steps[stepIndex] : undefined;

  const stop = useCallback(() => {
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
    if (pathname !== step.route) router.push(step.route);
  }, [active, step, pathname, router]);

  // Locate (and, if needed, reveal) the current step's target once we're on
  // the right route. Polls briefly since a fresh navigation's target may not
  // exist in the DOM the instant the route changes.
  useEffect(() => {
    if (!active || !step) return;
    if (!routeMatches(pathname, step.route)) { setRect(null); return; }

    // Narrative step with no anchor — render the card centred over the page.
    if (!step.target) { setRect(null); return; }

    let cancelled = false;
    let clickedPreStep = false;
    setRect(null);
    const startedAt = Date.now();

    const tick = () => {
      if (cancelled) return;
      if (step.preClickSelector && !clickedPreStep) {
        const trigger = document.querySelector<HTMLElement>(step.preClickSelector);
        if (trigger) {
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

    return () => { cancelled = true; };
  }, [active, step, pathname]);

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
    setStepIndex(i => i + 1);
  }, [stepIndex, steps.length, finish]);

  const back = useCallback(() => {
    setStepIndex(i => Math.max(0, i - 1));
  }, []);

  const value = useMemo(() => ({ available: !!tour, start }), [tour, start]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {active && step && (
        <TourCard
          step={step}
          rect={rect}
          index={stepIndex}
          total={steps.length}
          stepTitles={steps.map(s => s.title)}
          onJumpTo={setStepIndex}
          onBack={stepIndex > 0 ? back : undefined}
          onNext={next}
          onSkip={finish}
          isLast={stepIndex === steps.length - 1}
        />
      )}
    </TourContext.Provider>
  );
}

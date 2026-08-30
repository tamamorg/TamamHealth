'use client';

// First-run "Get Started" experience, shown to a new user on their home
// dashboard only. It overlays the dashboard content area (never the sidebar),
// so it requires no changes to the 13 individual dashboard pages. The user can
// minimise it to a launcher pill or skip setup entirely; both choices persist.
//
// The checklist is generated from the platform's own nav/permissions (see
// lib/onboarding/steps.ts), so it always teaches exactly the features the
// signed-in role can use.

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useOnboarding } from '@/lib/hooks/useOnboarding';
import { getDefaultDashboard } from '@/lib/permissions';
import type { OnboardingSection, OnboardingStep } from '@/lib/onboarding/steps';
import {
  Check, Lock, X, ArrowRight, Star, ChevronUp,
} from '@/components/icons/lucide';

export default function GetStartedCard() {
  const router = useRouter();
  const pathname = usePathname();
  const { currentUser } = useAuth();
  const {
    ready, plan, completedStepIds, completedCount, totalSteps,
    allDone, finished, collapsed,
    completeStep, setCollapsed, dismiss, finish,
  } = useOnboarding();

  // When the guided tour starts it needs the dashboard visible — collapse
  // this overlay to its launcher pill so the tour can spotlight the page.
  useEffect(() => {
    const onTourStarted = () => setCollapsed(true);
    window.addEventListener('tamam:tour-started', onTourStarted);
    return () => window.removeEventListener('tamam:tour-started', onTourStarted);
  }, [setCollapsed]);

  if (!currentUser || !ready || !plan || finished) return null;

  // Only surface on the role's home dashboard — not on every page.
  const home = getDefaultDashboard(currentUser.role);
  if (pathname !== home) return null;

  if (collapsed) {
    return (
      <div
        className="gsc-collapsed-pill absolute bottom-4 start-4 z-30 flex items-center gap-0.5 rounded-full py-0.5 ps-1.5 pe-1 text-xs font-semibold text-white shadow-lg"
        style={{ background: 'var(--accent-primary)' }}
      >
        <button
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-1.5 rounded-full px-1.5 py-1 transition-transform"
        >
          Get started
          <span className="rounded-full bg-white/25 px-1.5 py-0.5 text-[10px]">
            {completedCount}/{totalSteps}
          </span>
        </button>
        {/* Dismiss the onboarding entirely (same effect as "Skip setup"). */}
        <button
          onClick={() => dismiss()}
          aria-label="Dismiss get started"
          title="Dismiss"
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/25"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  const firstName = currentUser.name?.split(' ')[0] || 'there';

  return (
    <div
      className="absolute inset-0 z-30 overflow-y-auto"
      style={{ background: 'var(--bg-primary)' }}
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/tamamhealth-logo.svg" alt="" className="h-10 w-10" />
            <div>
              <h1
                className="text-xl font-bold"
                style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-platform)', letterSpacing: '-0.01em' }}
              >
                Welcome, {firstName}!
              </h1>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Let’s get your {plan.roleLabel} workspace set up.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCollapsed(true)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-black/5"
              style={{ color: 'var(--text-muted)' }}
            >
              <ChevronUp className="w-3.5 h-3.5" /> Minimize
            </button>
            <button
              onClick={() => { if (confirm('Skip setup? You can always come back later.')) dismiss(); }}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-black/5"
              style={{ color: 'var(--text-muted)' }}
            >
              <X className="w-3.5 h-3.5" /> Skip setup
            </button>
          </div>
        </div>

        {allDone && <AllDoneBanner onFinish={finish} />}

        <div className="mx-auto max-w-3xl space-y-4">
          {plan.sections.map((section, i) => {
            const unlocked = isSectionUnlocked(plan.sections, i, completedStepIds);
            return (
              <SectionCard
                key={section.id}
                section={section}
                defaultOpen={i === 0}
                unlocked={unlocked}
                completedStepIds={completedStepIds}
                onStart={(step) => {
                  completeStep(step.id);
                  if (step.href && step.href !== pathname) router.push(step.href);
                }}
                onToggle={completeStep}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AllDoneBanner({ onFinish }: { onFinish: () => void }) {
  return (
    <div
      className="mb-5 flex items-center justify-between gap-4 rounded-xl border p-4"
      style={{ borderColor: 'var(--border-medium)', background: 'var(--bg-card-solid)' }}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: 'rgba(15, 160, 106,0.12)' }}>
          <Star className="w-5 h-5" style={{ color: 'var(--color-success-text)' }} />
        </div>
        <div>
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>You’re all set! 🎉</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>You’ve completed every step. Nice work.</p>
        </div>
      </div>
      <button
        onClick={onFinish}
        className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
        style={{ background: 'var(--accent-primary)' }}
      >
        Finish
      </button>
    </div>
  );
}

function SectionCard({
  section, defaultOpen, unlocked, completedStepIds, onStart, onToggle,
}: {
  section: OnboardingSection;
  defaultOpen: boolean;
  unlocked: boolean;
  completedStepIds: Set<string>;
  onStart: (step: OnboardingStep) => void;
  onToggle: (id: string) => void;
}) {
  const done = section.steps.filter(s => completedStepIds.has(s.id)).length;
  const total = section.steps.length;
  const complete = done >= total;
  const [open, setOpen] = useState(defaultOpen && unlocked);

  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{
        borderColor: 'var(--border-medium)',
        background: 'var(--bg-card-solid)',
        opacity: unlocked ? 1 : 0.6,
      }}
    >
      <button
        onClick={() => unlocked && setOpen(o => !o)}
        disabled={!unlocked}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start"
        style={{ cursor: unlocked ? 'pointer' : 'default' }}
      >
        <div className="flex items-center gap-3">
          {!unlocked && <Lock className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
          {unlocked && complete && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: 'var(--color-success)' }}>
              <Check className="w-3.5 h-3.5 text-white" />
            </span>
          )}
          <div>
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{section.title}</h3>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {unlocked ? section.subtitle : 'Complete the previous section to unlock'}
            </p>
          </div>
        </div>
        <span className="whitespace-nowrap text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          {done} of {total} done
        </span>
      </button>

      {unlocked && (
        <div
          className="h-0.5 w-full"
          style={{ background: 'var(--border-light)' }}
        >
          <div className="h-full transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%`, background: 'var(--accent-primary)' }} />
        </div>
      )}

      {open && unlocked && (
        <ul className="divide-y" style={{ borderColor: 'var(--border-light)' }}>
          {section.steps.map(step => {
            const isDone = completedStepIds.has(step.id);
            return (
              <li key={step.id} className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => onToggle(step.id)}
                  aria-label={isDone ? 'Mark not done' : 'Mark done'}
                  className="flex-shrink-0"
                >
                  {isDone ? (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: 'var(--color-success)' }}>
                      <Check className="w-3.5 h-3.5 text-white" />
                    </span>
                  ) : (
                    <span className="block h-5 w-5 rounded-full border-2" style={{ borderColor: 'var(--border-medium)' }} />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className="text-sm font-semibold"
                    style={{
                      color: 'var(--text-primary)',
                      textDecoration: isDone ? 'line-through' : 'none',
                      opacity: isDone ? 0.6 : 1,
                    }}
                  >
                    {step.title}
                    <span className="ms-2 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                      ({step.estMinutes}m)
                    </span>
                  </p>
                  <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>{step.description}</p>
                </div>
                <button
                  onClick={() => onStart(step)}
                  className="flex flex-shrink-0 items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors"
                  style={{ borderColor: 'var(--border-medium)', color: 'var(--text-primary)' }}
                >
                  {step.href ? 'Start' : 'Done'}
                  {step.href && <ArrowRight className="w-3 h-3" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A section unlocks when every step in all preceding sections is complete. */
function isSectionUnlocked(
  sections: OnboardingSection[],
  index: number,
  completed: Set<string>,
): boolean {
  for (let i = 0; i < index; i++) {
    const allDone = sections[i].steps.every(s => completed.has(s.id));
    if (!allDone) return false;
  }
  return true;
}

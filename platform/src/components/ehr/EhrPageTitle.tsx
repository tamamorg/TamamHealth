'use client';

/**
 * EhrPageTitle — the list-page title: the name of the page, and nothing else.
 *
 * Replaces EhrPageGreeting (2026-08-24), which opened every module with
 *
 *   Welcome, Gatluak Puok
 *   RECEPTIONIST · PATIENTS
 *
 * so the largest text on a list page was the reader's own name, repeated
 * identically on all 31 of them, while the page you had actually navigated to
 * was demoted to half of a 11.5px eyebrow. The greeting belongs on the landing
 * dashboard a session opens with — it is a poor heading for a page reached by
 * clicking its name in the rail. The admin console dropped its own copy of the
 * same header for the same reason (see SadbPage).
 *
 * Kept as a component rather than a bare span so the 31 call sites share one
 * heading and cannot drift apart again.
 */
import type { ReactNode } from 'react';

export default function EhrPageTitle({
  children,
  className = '',
}: {
  /** The page name — "Patients", "Laboratory", "Blood units". */
  children: ReactNode;
  className?: string;
}) {
  return <span className={`ehr-page-title ${className}`.trim()}>{children}</span>;
}

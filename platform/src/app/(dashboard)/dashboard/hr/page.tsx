'use client';

/**
 * `/dashboard/hr` is retired — its content was merged into the facility
 * dashboard, which is what `people-nav.test.ts` pins ("the HR landing page has
 * no nav row"). What was left was a granted route with no nav row, no link and
 * no role calling it home: reachable only by typing the URL, and rendering a
 * second, staler answer to the question `/facility-management` already
 * answers.
 *
 * Kept as a stub rather than deleted, like `/notes` and `/consultation`, so an
 * old bookmark or deep link lands on the live dashboard instead of a 404. The
 * four HR areas it used to summarise — leave, schedule, payroll, accounts —
 * are each one click away in the PEOPLE & HR nav section.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HrHomeRetiredPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/facility-management');
  }, [router]);

  return <div className="cn-empty">Opening the facility dashboard…</div>;
}

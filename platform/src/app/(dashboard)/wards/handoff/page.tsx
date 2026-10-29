'use client';

/**
 * Shift handoff, as its own page.
 *
 * Authoring lived inside the nurse station as a dialog over whichever board
 * was open (`?station=handoff`). Now that the nurse experience is merging
 * into the shared clinical workspace, handoff needs an address of its own —
 * any clinical user with /wards access (nurses and doctors alike; Epic lets
 * both hand off) lands here to draft SBAR, sign off, or acknowledge the
 * previous shift's report.
 */

import { ArrowLeft } from '@/components/icons/lucide';
import HandoffWorkflow from '@/components/nurse/HandoffWorkflow';
import { useGoBack } from '@/lib/navigation/nav-history';

export default function ShiftHandoffPage() {
  // Back is the screen the user came from; the dashboard when there is none.
  const goBack = useGoBack('/dashboard');

  return (
    <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={goBack}
        className="flex items-center gap-1.5 text-[12px] font-bold mb-2 no-print"
        style={{ color: 'var(--accent-primary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
      >
        <ArrowLeft className="w-4 h-4" /> Back to dashboard
      </button>

      <h1 className="text-lg font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Shift Handoff</h1>

      <HandoffWorkflow />
    </main>
  );
}

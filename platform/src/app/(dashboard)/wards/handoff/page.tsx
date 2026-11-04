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

import HandoffWorkflow from '@/components/nurse/HandoffWorkflow';

export default function ShiftHandoffPage() {

  return (
    <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Back and the title are in the bar at the top (RouteContextBar). */}

      <HandoffWorkflow />
    </main>
  );
}

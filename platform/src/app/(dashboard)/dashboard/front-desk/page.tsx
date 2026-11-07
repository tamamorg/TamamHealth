'use client';

import '@/components/ehr/chart/panels/start-visit-panel.css';
import './registration-slider.css';
import FrontDeskBoard from '@/components/front-desk/desk-board/FrontDeskBoard';

/**
 * Front-desk operations workspace.
 *
 * Shows the live queue, today's appointments, and registry snapshots in one
 * view so reception can move patients without jumping between screens. The
 * board itself lives in `components/front-desk/desk-board/`.
 */
export default function FrontDeskDashboardPage() {
  return <FrontDeskBoard />;
}

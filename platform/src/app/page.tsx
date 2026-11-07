/* ═══════════════════════════════════════════════════════════════════
   TamamHealth — Root Entry Point
   The welcome page: choose the door (facility staff, ministry and county,
   patient portal, platform console), then sign in with credentials. A
   signed-in visitor (the installed app opens here) goes straight on to
   their workspace. See components/login/WelcomePage.tsx.
   ═══════════════════════════════════════════════════════════════════ */

import type { Metadata } from 'next';
import WelcomePage from '@/components/login/WelcomePage';

export const metadata: Metadata = {
  title: 'Welcome',
  description: 'Sign in to Tamam: facility staff, ministry and county health, or the patient portal.',
};

export default function RootPage() {
  return <WelcomePage />;
}

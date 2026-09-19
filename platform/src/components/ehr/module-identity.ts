/** Visual identity only. Never use this mapping for access control or routing. */
export type ModuleTone = 'care' | 'laboratory' | 'imaging' | 'pharmacy' | 'family' | 'finance' | 'operations';

export const MODULE_IDENTITIES: readonly { paths: readonly string[]; tone: ModuleTone; icon: string }[] = [
  { paths: ['/lab', '/dashboard/lab'], tone: 'laboratory', icon: 'microscope' },
  { paths: ['/blood-bank'], tone: 'laboratory', icon: 'bloodPressure' },
  { paths: ['/radiology', '/imaging'], tone: 'imaging', icon: 'scan' },
  { paths: ['/pharmacy', '/controlled-substances'], tone: 'pharmacy', icon: 'pill' },
  { paths: ['/anc', '/births', '/mch'], tone: 'family', icon: 'baby' },
  { paths: ['/immunizations'], tone: 'family', icon: 'vaccine' },
  { paths: ['/deaths'], tone: 'operations', icon: 'record' },
  { paths: ['/payments', '/billing', '/checkout'], tone: 'finance', icon: 'wallet' },
  { paths: ['/patients'], tone: 'care', icon: 'patient' },
  { paths: ['/appointments', '/book'], tone: 'care', icon: 'calendar' },
  { paths: ['/referrals', '/transfers'], tone: 'care', icon: 'arrowRightLeft' },
  { paths: ['/wards'], tone: 'care', icon: 'bedDouble' },
  { paths: ['/consultation', '/triage', '/rooming', '/notes'], tone: 'care', icon: 'stethoscope' },
  { paths: ['/messages', '/notifications', '/inquiries'], tone: 'care', icon: 'message' },
  { paths: ['/reports', '/analytics', '/government', '/surveillance', '/mch-analytics', '/vital-statistics', '/public-stats', '/epidemic-intelligence'], tone: 'operations', icon: 'chart' },
  { paths: ['/alerts', '/emergency-preparedness'], tone: 'operations', icon: 'shield' },
  { paths: ['/data-quality', '/dhis2-export'], tone: 'operations', icon: 'server' },
  { paths: ['/settings', '/admin', '/org-admin', '/system-admin', '/it', '/facility-settings'], tone: 'operations', icon: 'settings' },
  { paths: ['/equipment', '/inventory'], tone: 'operations', icon: 'package' },
  { paths: ['/hr', '/manage', '/facility-management', '/departments', '/facility-assessments', '/facility-overview', '/my-facility'], tone: 'operations', icon: 'hospital' },
  { paths: ['/dashboard'], tone: 'care', icon: 'layoutDashboard' },
];

export function moduleIdentity(href: string) {
  const path = href.split(/[?#]/)[0].replace(/\/$/, '') || '/';
  return MODULE_IDENTITIES.find(item => item.paths.some(prefix => path === prefix || path.startsWith(`${prefix}/`)))
    ?? { tone: 'care' as const, icon: 'record' };
}

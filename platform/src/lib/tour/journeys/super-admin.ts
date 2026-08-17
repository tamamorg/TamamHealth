import type { TourStep } from '../types';
import { finishStep, messagingStep } from './_shared';

// ── Super admin — §11.1 ────────────────────────────────────────────────────
export const SUPER_ADMIN_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/admin',
    target: '',
    title: 'Welcome, platform operator',
    body: 'Organizations, users, system config, tenant billing, and sync conflicts. Let’s walk the platform console.',
  },
  {
    id: 'orgs',
    route: '/admin/organizations',
    target: '',
    title: 'Organizations',
    body: 'Create and deactivate tenants — each organization is fully isolated.',
  },
  {
    id: 'users',
    route: '/admin/users',
    target: '',
    title: 'Cross-tenant users',
    body: 'Add users, change roles, activate/deactivate across every tenant. Only you can grant platform or national roles.',
  },
  {
    id: 'system',
    route: '/admin/system',
    target: '',
    title: 'System',
    body: 'Local data stores and build facts — platform settings live under Configuration.',
  },
  {
    id: 'billing',
    route: '/admin/billing',
    target: '',
    title: 'Tenant billing',
    body: 'Subscription plans and statuses per organization.',
  },
  {
    id: 'conflicts',
    route: '/admin/conflicts',
    target: '',
    title: 'Sync conflicts',
    body: 'Resolve or dismiss offline-sync conflicts — the safety valve of an offline-first system.',
  },
  messagingStep('/admin'),
  finishStep('/admin'),
];

// ── Medical superintendent — clinical journey + oversight stops ────────────

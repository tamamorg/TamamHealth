import type { TourStep } from '../types';
import { finishStep } from './_shared';

// ── Super admin — §11.1 ────────────────────────────────────────────────────
// /admin/control and /system-admin are both live routes but pure redirects
// (to /admin/security and /settings respectively) — the tour engine's
// route-follow effect would fight the page's own router.replace() and
// ping-pong between the two, so neither gets a stop. Their destinations are
// covered directly instead (security below; system-admin's target page is
// outside this package).
export const SUPER_ADMIN_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/admin',
    target: '',
    title: 'Welcome, platform operator',
    body: 'Tenants, configuration, data integrity, security, and platform health — everything a platform operator needs lives in this console. Let’s walk it.',
  },
  {
    id: 'command-deck',
    route: '/admin',
    target: '.sadb-kpi-row',
    title: "Today's command deck",
    body: 'Organizations, facilities, users, patients, and today’s encounters — five vitals for the whole platform. Tap a tile to jump straight into that module.',
    placement: 'bottom',
  },
  {
    id: 'readiness',
    route: '/admin',
    target: '.sadb-row-2',
    title: 'Readiness, business, and sync',
    body: 'A single readiness score built from open risk, sync health, and backups; your subscription mix; and the state of replication and DHIS2 export — the three signals that tell you whether today is normal. Tap a signal to see what is behind it, then open the module that owns it.',
    placement: 'bottom',
  },
  {
    id: 'orgs',
    route: '/admin/organizations',
    target: '.sadb-tenant-scroll',
    title: 'Organizations & subscriptions',
    body: 'Create tenants, edit branding, plans, and seat limits, and deactivate accounts — every organization’s data stays fully isolated from every other. The subscription vitals ride the KPI strip above the list, and each tenant’s own billing facts live on its page.',
    placement: 'top',
  },
  {
    id: 'users',
    route: '/admin/users',
    target: '.appointment-card-list',
    title: 'Cross-tenant users',
    body: 'Add users, change roles, reset passwords, deactivate — across every tenant. Only you can grant platform-level or national roles.',
    placement: 'top',
  },
  {
    id: 'config',
    route: '/admin/config',
    target: '.sadb-rail',
    title: 'Platform configuration',
    body: 'Platform identity, tenant defaults, maintenance mode, and the security-policy defaults every new tenant inherits — each lives in its own section here.',
    placement: 'right',
  },
  {
    id: 'flags',
    route: '/admin/flags',
    target: '[data-tour="admin-flags-matrix"]',
    title: 'Feature flags',
    body: 'Feature flags gate rollout per tenant — turn a capability on for one organization without exposing it platform-wide, and see at a glance which flags are actually in use.',
    placement: 'top',
  },
  {
    id: 'data-governance',
    route: '/admin/data',
    target: '.sadb-rail',
    title: 'Data governance',
    body: 'Duplicate patient candidates, facility data-completeness scores, and invalid or missing values — scanned live from the real patient registry, never sampled.',
    placement: 'right',
  },
  {
    id: 'interop',
    route: '/admin/interop',
    target: '.sadb-status-grid',
    title: 'Interoperability',
    body: 'DHIS2 export, country-node replication, and API keys — the platform’s real integration surface. Anything not wired up yet is labeled that way instead of hidden.',
    placement: 'top',
  },
  {
    id: 'sync',
    route: '/admin/sync',
    target: '.sa-table-scroll',
    title: 'Sync & jobs',
    body: 'The outbox of everything waiting to replicate to the country node. Run a job manually here if a facility’s backlog needs a push before it retries on its own.',
    placement: 'top',
  },
  {
    id: 'conflicts',
    route: '/admin/conflicts',
    target: '[data-tour="admin-conflicts-tabs"]',
    title: 'Sync conflicts',
    body: 'Replication conflicts land in this queue — pick the winning revision or dismiss with a reason. Nothing merges automatically; every resolution is a human decision.',
    placement: 'bottom',
  },
  {
    id: 'security',
    route: '/admin/security',
    target: '.sadb-rail',
    title: 'Security & compliance',
    body: 'PHI export controls, break-glass access, and backup objectives — set the policy defaults here and every tenant inherits them until it’s changed again. The Security watchlist section lists every high-risk action from the last seven days.',
    placement: 'right',
  },
  {
    id: 'audit',
    route: '/admin/audit',
    target: '.sadb-search-row',
    title: 'Audit logs',
    body: 'An append-only record of every privileged action on the platform — filter by risk, result, or organization, then export the current view as evidence for a compliance review.',
    placement: 'bottom',
  },
  {
    id: 'risk',
    route: '/admin/risk',
    target: '.sa-table-scroll',
    title: 'Risk & incident queue',
    body: 'Every open risk signal — audit failures, sync backlogs, suspended tenants, overdue backups — pulled live from each subsystem and ranked worst first. Click a row to jump to its source.',
    placement: 'top',
  },
  {
    id: 'system',
    route: '/admin/system',
    target: '.sadb-tenant-scroll',
    title: 'System',
    body: 'Every local data store and its document count, plus the build’s stack facts — a fast pulse check when something isn’t syncing right. Platform settings live under Configuration.',
    placement: 'top',
  },
  {
    id: 'support',
    route: '/admin/support',
    target: '.sadb-rail',
    title: 'Support operations',
    body: 'Look up any tenant or user, review support-access policy and its audit trail, or post an announcement — everything you need when a facility calls in.',
    placement: 'right',
  },
  // The standalone billing step is gone: /admin/billing merged into the
  // Organizations registry (2026-08-23), whose step above now covers it.
  {
    id: 'analytics',
    route: '/admin/analytics',
    target: '.sadb-kpi-row',
    title: 'Usage analytics',
    body: 'Fourteen days of encounters against audit failures, per-tenant patient and user growth, plan and status mix, and real interaction data — daily actives, top modules, top actions — further down this page.',
    placement: 'bottom',
  },
  // No messaging stop: unlike every other role, super_admin's nav (see
  // permissions.ts) carries no "/messages" entry — it's a platform-governance
  // IA, not a workspace one — and the floating dock only mounts on /dashboard
  // routes. The shared messagingStep()'s nav-item anchor would silently stall
  // here, so this tour skips straight to the close-out.
  finishStep('/admin'),
];

// ── Medical superintendent — clinical journey + oversight stops ────────────

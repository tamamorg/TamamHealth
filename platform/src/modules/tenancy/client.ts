'use client';

import dynamic from 'next/dynamic';

export {
  userWorksAtFacility, TENANCY_WORKSPACE_ROLES, TENANCY_ACTIONS_BY_ROLE,
  canPerformTenancyAction, managementRootForRole,
  type ManagementRoot, type TenancyAction, type TenancyCreateKind,
} from './index';
export { useAssignableFacilities } from './hooks/useAssignableFacilities';
export const ManagementWorkspace = dynamic(() => import('./components/ManagementWorkspace'), { ssr: false });
/* Loaded on the click that opens it — an admin dashboard should not carry the
   three tenancy forms in its own bundle for a button nobody may press. */
export const TenancyCreateDialogs = dynamic(() => import('./components/TenancyCreateDialogs'), { ssr: false });
/* One organization, hosted by both `/manage` (single-tenant roles) and
   `/admin/organizations/[id]` (drilled in from the registry). */
export const OrganizationDetail = dynamic(() => import('./components/OrganizationDetail'), { ssr: false });

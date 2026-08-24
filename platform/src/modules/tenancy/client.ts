'use client';

import dynamic from 'next/dynamic';

export {
  userWorksAtFacility, TENANCY_WORKSPACE_ROLES, TENANCY_ACTIONS_BY_ROLE,
  canPerformTenancyAction, managementViewsForRole, type ManagementView, type TenancyAction,
} from './index';
export { useAssignableFacilities } from './hooks/useAssignableFacilities';
export const ManagementWorkspace = dynamic(() => import('./components/ManagementWorkspace'), { ssr: false });

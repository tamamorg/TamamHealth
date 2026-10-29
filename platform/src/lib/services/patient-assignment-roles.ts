/**
 * Who may be named at each service station. Kept apart from
 * patient-assignment-service so the assign picker can filter staff without
 * loading the service (and its database) up front.
 */
import type { StationKey } from '@/data/mock';
import type { UserRole } from '../db-types';

export const STATION_STAFF_ROLES: Record<StationKey, readonly UserRole[]> = {
  lab: ['lab_tech'],
  pharmacy: ['pharmacist'],
  radiology: ['radiologist'],
  nutrition: ['nutritionist'],
};

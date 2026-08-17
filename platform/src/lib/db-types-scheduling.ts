/**
 * Staff Scheduling.
 */
import type { BaseDoc } from './db-types';

export interface StaffScheduleDoc extends BaseDoc {
  type: 'staff_schedule';
  userId: string;
  userName: string;
  role: string;
  facilityId: string;
  facilityName: string;
  shiftType: 'morning' | 'afternoon' | 'night' | 'on_call';
  shiftDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  department?: string;
  isOnCall: boolean;
  notes?: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'absent' | 'swapped';
  swappedWith?: string; // userId of swap partner
  orgId?: string;
}

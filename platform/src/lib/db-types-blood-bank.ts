/**
 * Blood Bank Management.
 */
import type { BaseDoc } from './db-types';

export interface BloodBankDoc extends BaseDoc {
  type: 'blood_bank';
  unitId: string;
  bloodGroup: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
  component: 'whole_blood' | 'packed_rbc' | 'platelets' | 'ffp' | 'cryoprecipitate';
  volume: number; // ml
  collectionDate: string;
  expiryDate: string;
  donorId?: string;
  donorName?: string;
  status: 'available' | 'reserved' | 'crossmatched' | 'transfused' | 'expired' | 'discarded';
  facilityId: string;
  facilityName: string;
  reservedForPatient?: string;
  crossmatchResult?: 'compatible' | 'incompatible' | 'pending';
  transfusedTo?: string;
  transfusedAt?: string;
  transfusedBy?: string;
  screeningResults?: {
    hiv: boolean;
    hepatitisB: boolean;
    hepatitisC: boolean;
    syphilis: boolean;
    malaria: boolean;
  };
  notes?: string;
  orgId?: string;
}

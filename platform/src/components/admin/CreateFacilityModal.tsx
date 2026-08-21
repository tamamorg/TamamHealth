'use client';

/**
 * Back-compat entry point for the create case.
 *
 * The form itself moved to `FacilityFormModal`, which handles create AND edit
 * and carries the full field set (capacity, staffing, infrastructure, services,
 * coordinates) that used to exist only in Settings -> Manage and could never be
 * corrected afterwards. Callers that only ever register a facility keep this
 * narrower prop shape — there is nothing for them to pass a `facility` to.
 */

import FacilityFormModal from './FacilityFormModal';
import type { HospitalDoc, OrganizationDoc } from '@/lib/db-types';

export interface CreateFacilityModalProps {
  onClose: () => void;
  onCreated: (hospital: HospitalDoc) => void;
  orgId?: string;
  organizations?: readonly OrganizationDoc[];
  actor?: { _id?: string; username?: string };
  brandColor?: string;
}

export default function CreateFacilityModal({ onCreated, ...rest }: CreateFacilityModalProps) {
  return <FacilityFormModal {...rest} onSaved={onCreated} />;
}

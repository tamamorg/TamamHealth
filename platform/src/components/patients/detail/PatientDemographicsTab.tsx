'use client';
import { patientFullName } from '@/lib/patient-utils';
import type { AppointmentDoc, PatientDoc } from '@/lib/db-types';
import { PortalAccessCard } from './lazy-panels';
import { PatientDemographicsView } from './FacesheetViews';
import type { Dispatch, SetStateAction } from 'react';
import type { HospitalDoc } from '@/lib/db-types';
export default function PatientDemographicsTab({ patient, demographicsTab, setDemographicsTab, openEditModal, canRegisterPatients, patientAppointments, regHospital }: {
  patient: PatientDoc;
  demographicsTab: string;
  setDemographicsTab: Dispatch<SetStateAction<string>>;
  openEditModal: () => void;
  canRegisterPatients: boolean;
  patientAppointments: AppointmentDoc[];
  regHospital: HospitalDoc | undefined;
}) {
  return (
            <>
              <PatientDemographicsView
                patient={patient}
                activeTab={demographicsTab}
                onTabChange={setDemographicsTab}
                onEdit={openEditModal}
                // The header's "Edit details" is gated on canRegisterPatients;
                // this button opens the identical modal, so it has to be too —
                // otherwise any chart viewer (a nurse, a cashier looking up a
                // balance) could rewrite the patient's name, DOB or county.
                canEdit={canRegisterPatients}
                appointments={patientAppointments}
                regHospitalName={regHospital?.name || patient.registrationHospital || ''}
              />
              {/* Issuing somebody a key to their own record is an
                  administrative act, and Demographics is one of the few tabs a
                  front-desk role may open — which is where the person who
                  enrols patients is standing. The card hides itself for roles
                  the API would refuse. */}
              <PortalAccessCard
                patientId={patient._id}
                patientName={patientFullName(patient)}
                hospitalNumber={patient.hospitalNumber}
                facilityName={regHospital?.name}
              />
            </>
  );
}

'use client';

/**
 * Patient lists workspace panel — OpenMRS-style saved worklists. This app
 * has no saved-list feature, so the two lists shown are derived live from
 * real data already used elsewhere in the app (usePatients) rather than
 * inventing a list-definition data layer: "My patients" (this clinician's
 * hospital) and "Assigned to me" (patients whose assigned provider is this
 * clinician — the same `assignedDoctor` field AssignDoctorModal writes and the
 * registry's "Assigned to me" filter reads).
 *
 * Each row opens the registry ALREADY filtered to the list it counted. The
 * counts previously came from appointment providers while both rows navigated
 * to the same unfiltered /patients, so the number on the row and the list you
 * landed in were unrelated.
 */

import { useMemo } from 'react';
import { Users, ChevronRight } from '@/components/icons/lucide';
import { usePatients } from '@/lib/hooks/usePatients';
import type { ChartPanelRouter, ChartPanelUser } from './types';

interface PatientListsPanelProps {
  currentUser: ChartPanelUser | null | undefined;
  router: ChartPanelRouter;
  onClose: () => void;
}

export default function PatientListsPanel({ currentUser, router, onClose }: PatientListsPanelProps) {
  const { patients } = usePatients();

  const myPatientsCount = useMemo(
    () => (patients || []).filter(p => p.registrationHospital === currentUser?.hospitalId).length,
    [patients, currentUser?.hospitalId],
  );

  // Read out of the user once so the memo below depends on the FIELD rather
  // than on the whole user object: a dependency list naming a property of an
  // object the body reads is narrower than the compiler can infer, and it
  // skips optimizing the component rather than guess.
  const myUserId = currentUser?._id;
  const assignedToMeCount = useMemo(() => {
    if (!myUserId) return 0;
    return (patients || []).filter(p => p.assignedDoctor === myUserId).length;
  }, [patients, myUserId]);

  const lists = [
    { id: 'my-patients', name: 'My patients', type: `Hospital · ${currentUser?.hospitalName || '—'}`, count: myPatientsCount, href: '/patients' },
    { id: 'assigned-to-me', name: 'Assigned to me', type: 'Provider worklist', count: assignedToMeCount, href: '/patients?assigned=me' },
  ];

  const openList = (href: string) => {
    router.push(href);
    onClose();
  };

  return (
    <div className="omrs-drawer-body">
      {lists.map(list => (
        <button key={list.id} type="button" className="omrs-panel-list-item" onClick={() => openList(list.href)}>
          <Users />
          <div style={{ flex: 1 }}>
            <div className="omrs-panel-row-main">{list.name}</div>
            <div className="omrs-panel-row-sub">{list.type}</div>
          </div>
          <span className="omrs-panel-list-count">{list.count}</span>
          <ChevronRight />
        </button>
      ))}
    </div>
  );
}

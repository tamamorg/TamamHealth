'use client';

/**
 * Patient lists workspace panel — Tamam-style saved worklists. This app
 * has no saved-list feature, so the two lists shown are derived live from
 * real data already used elsewhere in the app (usePatients) rather than
 * inventing a list-definition data layer: "My patients" (this clinician's
 * hospital) and "Assigned to me" (patients whose assigned provider is this
 * clinician — the same `assignedDoctor` field AssignDoctorModal writes and the
 * registry's "Assigned to me" filter reads).
 *
 * Each row opens in place: its patients listed under it, the row's count being
 * the length of that list. A patient opens their chart. (The rows used to leave
 * for the registry, taking the clinician away to read a list.) Each open list
 * has its own search, and the count stays the whole list's size.
 */

import { useMemo, useState } from 'react';
import { Users, ChevronDown, Search } from '@/components/icons/lucide';
import { usePatients } from '@/lib/hooks/usePatients';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { patientDisplayName, patientFullName } from '@/lib/patient-utils';
import type { PatientDoc } from '@/lib/db-types';
import type { ChartPanelRouter, ChartPanelUser } from './types';

interface PatientListsPanelProps {
  currentUser: ChartPanelUser | null | undefined;
  router: ChartPanelRouter;
  onClose: () => void;
}

/** Full name, hospital number or phone; a phone matches whatever its spacing. */
export function matchesListSearch(patient: PatientDoc, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (patientFullName(patient).toLowerCase().includes(q)) return true;
  if ((patient.hospitalNumber || '').toLowerCase().includes(q)) return true;
  const digits = q.replace(/\D/g, '');
  return digits.length > 0 && (patient.phone || '').replace(/\D/g, '').includes(digits);
}

export default function PatientListsPanel({ currentUser, router, onClose }: PatientListsPanelProps) {
  const { t } = useTranslation();
  const { patients } = usePatients();
  const [openList, setOpenList] = useState<string | null>(null);
  const [searches, setSearches] = useState<Record<string, string>>({});
  const myHospitalId = currentUser?.hospitalId;
  const myUserId = currentUser?._id;

  // One line per list: its name and its size. The scope ("Hospital · …",
  // "Provider worklist") used to sit under each name; the user took it out
  // on 2026-11-05 as noise.
  const lists = useMemo<{ id: string; name: string; patients: PatientDoc[] }[]>(() => [
    {
      id: 'my-patients',
      name: t('patientLists.myPatients'),
      patients: (patients || []).filter(p => p.registrationHospital === myHospitalId),
    },
    {
      id: 'assigned-to-me',
      name: t('patients.assignedMe'),
      patients: myUserId ? (patients || []).filter(p => p.assignedDoctor === myUserId) : [],
    },
  ], [patients, myHospitalId, myUserId, t]);

  const openPatient = (id: string) => {
    router.push(`/patients/${encodeURIComponent(id)}`);
    onClose();
  };

  return (
    <div className="tamam-drawer-body tamam-plist">
      {lists.map(list => {
        const open = openList === list.id;
        const query = searches[list.id] ?? '';
        const shown = open ? list.patients.filter(p => matchesListSearch(p, query)) : [];
        const bodyId = `tamam-plist-${list.id}`;
        return (
          <section key={list.id} className={open ? 'tamam-plist-group is-open' : 'tamam-plist-group'}>
            <button type="button" className="tamam-plist-row" aria-expanded={open} aria-controls={bodyId}
              onClick={() => setOpenList(open ? null : list.id)}>
              <span className="tamam-plist-icon" aria-hidden><Users /></span>
              <span className="tamam-plist-name">{list.name}</span>
              <span className="tamam-plist-count">{list.patients.length}</span>
              <ChevronDown aria-hidden className="tamam-plist-chevron" />
            </button>
            {open && (
              <div id={bodyId} className="tamam-plist-body">
                <label className="tamam-section-search tamam-panel-search">
                  <Search aria-hidden />
                  <input
                    type="search"
                    value={query}
                    onChange={event => setSearches(prev => ({ ...prev, [list.id]: event.target.value }))}
                    aria-label={t('patientLists.searchLabel', { list: list.name })}
                    placeholder={t('patientLists.searchPlaceholder')}
                  />
                </label>
                <ul className="tamam-panel-patients">
                  {list.patients.length === 0 && <li className="tamam-panel-patients-empty">{t('patientLists.empty')}</li>}
                  {list.patients.length > 0 && shown.length === 0 && (
                    <li className="tamam-panel-patients-empty">{t('patientLists.noMatch')}</li>
                  )}
                  {shown.map(p => (
                    <li key={p._id}>
                      <button type="button" onClick={() => openPatient(p._id)}>
                        <span>{patientDisplayName(p)}</span>
                        <span>{p.hospitalNumber}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

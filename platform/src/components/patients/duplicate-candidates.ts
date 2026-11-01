import type { PatientDoc } from '@/lib/db-types';

/** One pair of records that look like the same person, and why. */
export interface DupPair {
  a: PatientDoc;
  b: PatientDoc;
  basis: string;
}

export function patientName(p: PatientDoc): string {
  const name = [p.firstName, p.surname].filter(Boolean).join(' ').trim();
  return name || p.hospitalNumber || p._id;
}

function normPhone(phone?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, '');
  return digits.length >= 7 ? digits : null;
}

/**
 * Candidate duplicate pairs: same surname + first name + date of birth, or the
 * same phone number. Pass records that are not already linked as duplicates.
 *
 * Known scale limit: each match group expands pairwise (O(n²) within a group),
 * fine for the small groups a name/DOB or phone collision produces but not for
 * a facility uploading a large duplicate batch at once.
 */
export function findDuplicateCandidates(patients: readonly PatientDoc[]): DupPair[] {
  const pairKeys = new Set<string>();
  const pairs: DupPair[] = [];

  const addGroupPairs = (group: PatientDoc[], basis: string) => {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const key = [group[i]._id, group[j]._id].sort().join('|');
        if (pairKeys.has(key)) continue;
        pairKeys.add(key);
        pairs.push({ a: group[i], b: group[j], basis });
      }
    }
  };

  const byNameDob = new Map<string, PatientDoc[]>();
  const byPhone = new Map<string, PatientDoc[]>();

  for (const p of patients) {
    const surname = (p.surname || '').trim().toLowerCase();
    const first = (p.firstName || '').trim().toLowerCase();
    const dob = (p.dateOfBirth || '').trim();
    if (surname && first && dob) {
      const key = `${surname}|${first}|${dob}`;
      const arr = byNameDob.get(key) || [];
      arr.push(p);
      byNameDob.set(key, arr);
    }
    const phone = normPhone(p.phone);
    if (phone) {
      const arr = byPhone.get(phone) || [];
      arr.push(p);
      byPhone.set(phone, arr);
    }
  }

  for (const group of byNameDob.values()) {
    if (group.length > 1) addGroupPairs(group, 'Name + DOB match');
  }
  for (const group of byPhone.values()) {
    if (group.length > 1) addGroupPairs(group, 'Same phone number');
  }
  return pairs;
}

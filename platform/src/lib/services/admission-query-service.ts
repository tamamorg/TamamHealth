/** Read-only admission queries shared by ward and prescribing workflows. */
import { getDB } from '../db';
import type { AdmissionDoc } from '../db-types-ward';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';

const wardDB = () => getDB('tamamhealth_wards');

export async function getAllAdmissions(scope?: DataScope): Promise<AdmissionDoc[]> {
  const all = await findByType<AdmissionDoc>(wardDB(), 'admission');
  all.sort((a, b) => (b.admissionDate || '').localeCompare(a.admissionDate || ''));
  return scope ? filterByScope(all, scope) : all;
}

export async function getActiveAdmissions(scope?: DataScope): Promise<AdmissionDoc[]> {
  return (await getAllAdmissions(scope)).filter(admission => admission.status === 'admitted');
}

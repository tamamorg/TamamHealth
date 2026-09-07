import { hospitalsDB } from '@/lib/db';
import type { AppointmentDoc } from '@/lib/db-types';
import { findByType } from '@/lib/services/db-query';
import { filterByScope, type DataScope } from '@/lib/services/data-scope';
import { logAuditSafe } from '@/lib/services/audit-service';
import { TAMAM_DEPARTMENT_CATALOG, appointmentBelongsToDepartment } from '../core/catalog';
import type { DepartmentDoc } from '../core/types';

const DEPARTMENT_CONFIG_ROLES = new Set<DataScope['role']>([
  'super_admin', 'org_admin', 'medical_superintendent', 'hospital_manager',
]);

export function departmentDocumentId(facilityId: string, code: string): string {
  return `department:${facilityId}:${code}`;
}

export async function getDepartments(scope: DataScope): Promise<DepartmentDoc[]> {
  if (!scope.orgId) return [];
  const docs = await findByType<DepartmentDoc>(hospitalsDB(), 'department');
  return filterByScope(docs, scope).filter((doc) => doc.isActive).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getDepartment(id: string, scope: DataScope): Promise<DepartmentDoc | null> {
  if (!scope.orgId) return null;
  try {
    const doc = await hospitalsDB().get(id) as DepartmentDoc;
    return filterByScope([doc], scope)[0] ?? null;
  } catch {
    return null;
  }
}

export async function resolveDepartmentByName(name: string, facilityId: string, scope: DataScope): Promise<DepartmentDoc | null> {
  const departments = await getDepartments(scope);
  return departments.find((department) => department.facilityId === facilityId
    && appointmentBelongsToDepartment({ department: name }, department)) ?? null;
}

/**
 * One-time, idempotent migration from facility free-text configuration to
 * stable entities. It is explicit so merely listing departments never writes.
 */
export async function provisionTamamDepartments(input: {
  scope: DataScope;
  facilityId: string;
  facilityName: string;
  actorId?: string;
  actorName?: string;
}): Promise<DepartmentDoc[]> {
  if (!input.scope.orgId) throw new Error('An organization scope is required');
  if (!DEPARTMENT_CONFIG_ROLES.has(input.scope.role)) {
    throw new Error('Your role cannot configure facility departments');
  }
  const entitled = filterByScope([{
    type: 'department', orgId: input.scope.orgId, facilityId: input.facilityId,
  }], input.scope);
  if (!entitled.length) throw new Error('The selected facility is outside your authorized scope');

  const db = hospitalsDB();
  const now = new Date().toISOString();
  for (const definition of TAMAM_DEPARTMENT_CATALOG) {
    const id = departmentDocumentId(input.facilityId, definition.code);
    try { await db.get(id); continue; } catch { /* create below */ }
    const doc: DepartmentDoc = {
      _id: id,
      type: 'department',
      code: definition.code,
      name: definition.name,
      aliases: [...definition.aliases],
      facilityId: input.facilityId,
      facilityName: input.facilityName,
      orgId: input.scope.orgId,
      parentDepartmentCode: definition.parentDepartmentCode,
      roomIds: [],
      specialties: [...definition.specialties],
      clinicDays: [],
      queueEnabled: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorId,
    };
    await db.put(doc);
  }
  await logAuditSafe('departments_provisioned', input.actorId, input.actorName, `Provisioned controlled department catalogue for facility ${input.facilityId}`);
  return getDepartments(input.scope);
}

export async function updateDepartmentConfiguration(input: {
  id: string;
  scope: DataScope;
  queueEnabled?: boolean;
  clinicDays?: DepartmentDoc['clinicDays'];
  actorId?: string;
  actorName?: string;
}): Promise<DepartmentDoc> {
  if (!DEPARTMENT_CONFIG_ROLES.has(input.scope.role)) throw new Error('Your role cannot configure facility departments');
  const existing = await getDepartment(input.id, input.scope);
  if (!existing) throw new Error('Department not found in your authorized scope');
  const updated: DepartmentDoc = {
    ...existing,
    queueEnabled: input.queueEnabled ?? existing.queueEnabled ?? true,
    clinicDays: input.clinicDays ?? existing.clinicDays,
    updatedAt: new Date().toISOString(),
  };
  const response = await hospitalsDB().put(updated);
  updated._rev = response.rev;
  await logAuditSafe('department_configuration_updated', input.actorId, input.actorName, `Updated department ${existing._id}`);
  return updated;
}

export function departmentAppointments(appointments: AppointmentDoc[], department: DepartmentDoc): AppointmentDoc[] {
  return appointments.filter((appointment) => appointmentBelongsToDepartment(appointment, department));
}

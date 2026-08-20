import { facilityAssessmentsDB } from '../db';
import type { FacilityAssessmentDoc } from '../db-types';
import { v4 as uuidv4 } from 'uuid';
import { emitSyncEvent } from './sync-event-service';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';

export async function getAllAssessments(scope?: DataScope): Promise<FacilityAssessmentDoc[]> {
  const db = facilityAssessmentsDB();
  const all = (await findByType<FacilityAssessmentDoc>(db, 'facility_assessment'))
    .sort((a, b) => new Date(b.assessmentDate).getTime() - new Date(a.assessmentDate).getTime());
  return scope ? filterByScope(all, scope) : all;
}

export async function getAssessmentsByFacility(facilityId: string): Promise<FacilityAssessmentDoc[]> {
  const all = await getAllAssessments();
  return all.filter(a => a.facilityId === facilityId);
}

export async function createAssessment(data: Omit<FacilityAssessmentDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>): Promise<FacilityAssessmentDoc> {
  const db = facilityAssessmentsDB();
  const now = new Date().toISOString();
  const id = `assess-${uuidv4()}`;
  const doc: FacilityAssessmentDoc = {
    _id: id,
    type: 'facility_assessment',
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  emitSyncEvent({
    resourceType: 'facility_assessment',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}

export async function updateAssessment(id: string, data: Partial<FacilityAssessmentDoc>): Promise<FacilityAssessmentDoc | null> {
  const db = facilityAssessmentsDB();
  try {
    const existing = await db.get(id) as FacilityAssessmentDoc;
    const updated = {
      ...existing,
      ...data,
      _id: existing._id,
      _rev: existing._rev,
      updatedAt: new Date().toISOString(),
    };
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    emitSyncEvent({
      resourceType: 'facility_assessment',
      resourceId: updated._id,
      operation: 'update',
      resourceVersion: updated._rev,
      orgId: updated.orgId,
      hospitalId: updated.facilityId,
    });
    return updated;
  } catch {
    return null;
  }
}

export async function deleteAssessment(id: string): Promise<boolean> {
  const db = facilityAssessmentsDB();
  try {
    const doc = await db.get(id);
    const typed = doc as unknown as FacilityAssessmentDoc;
    await db.remove(doc);
    emitSyncEvent({
      resourceType: 'facility_assessment',
      resourceId: id,
      operation: 'delete',
      orgId: typed.orgId,
      hospitalId: typed.facilityId,
    });
    return true;
  } catch {
    return false;
  }
}

export async function getAssessmentSummary(scope?: DataScope) {
  const all = await getAllAssessments(scope);
  // Latest assessment per facility
  const latest: Record<string, FacilityAssessmentDoc> = {};
  for (const a of all) {
    if (!latest[a.facilityId] || a.assessmentDate > latest[a.facilityId].assessmentDate) {
      latest[a.facilityId] = a;
    }
  }
  const latestList = Object.values(latest);
  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : 0;

  return {
    totalAssessments: all.length,
    facilitiesAssessed: latestList.length,
    avgOverallScore: avg(latestList.map(a => a.overallScore)),
    avgEquipmentScore: avg(latestList.map(a => a.generalEquipmentScore)),
    avgDiagnosticScore: avg(latestList.map(a => a.diagnosticCapacityScore)),
    avgMedicinesScore: avg(latestList.map(a => a.essentialMedicinesScore)),
    avgStaffingScore: avg(latestList.map(a => a.staffingScore)),
    avgReportingCompleteness: avg(latestList.map(a => a.reportingCompleteness)),
    avgDataQuality: avg(latestList.map(a => a.dataQualityScore)),
    withDHIS2: latestList.filter(a => a.hasDHIS2Reporting).length,
    withCleanWater: latestList.filter(a => a.hasCleanWater).length,
    facilityScores: latestList.map(a => ({
      facilityId: a.facilityId,
      facilityName: a.facilityName,
      overallScore: a.overallScore,
      date: a.assessmentDate,
      state: a.state,
    })).sort((a, b) => b.overallScore - a.overallScore),
  };
}

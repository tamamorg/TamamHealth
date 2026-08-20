import { ancDB, messagesDB } from '../db';
import type { ANCVisitDoc, MessageDoc } from '../db-types';
import { v4 as uuidv4 } from 'uuid';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { jubaYearMonth, jubaIsInMonth } from '../time-juba';
import { findByType } from './db-query';

export async function getAllANCVisits(scope?: DataScope): Promise<ANCVisitDoc[]> {
  const db = ancDB();
  const all = (await findByType<ANCVisitDoc>(db, 'anc_visit'))
    .filter(d => d.isDeleted !== true);
  /* istanbul ignore next -- defensive null-safety in sort */
  all.sort((a, b) => new Date(b.visitDate || '').getTime() - new Date(a.visitDate || '').getTime());
  return scope ? filterByScope(all, scope) : all;
}

export async function getByMother(motherId: string): Promise<ANCVisitDoc[]> {
  const all = await getAllANCVisits();
  return all.filter(v => v.motherId === motherId);
}

export async function getByFacility(facilityId: string): Promise<ANCVisitDoc[]> {
  const all = await getAllANCVisits();
  return all.filter(v => v.facilityId === facilityId);
}

export async function createANCVisit(data: Omit<ANCVisitDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>): Promise<ANCVisitDoc> {
  const db = ancDB();
  const now = new Date().toISOString();
  const id = `anc-${uuidv4()}`;
  const doc: ANCVisitDoc = {
    _id: id,
    type: 'anc_visit',
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  emitSyncEvent({
    resourceType: 'anc_visit',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });

  // Auto-trigger a clinical alert message if the mother is high-risk so the
  // facility's clinical team is notified immediately. The message lands in
  // the same Messages PouchDB so it shows up in the messages tab without
  // any extra wiring.
  if (data.riskLevel === 'high') {
    try {
      const msgs = messagesDB();
      const factors = (data.riskFactors || []).join(', ') || 'unspecified';
      /* istanbul ignore next -- defensive: motherId/motherName always provided in practice */
      const safeMotherIdVal = data.motherId || '';
      const safeMotherNameVal = data.motherName || 'Unknown mother';
      const alertDoc: MessageDoc = {
        _id: `msg-${uuidv4()}`,
        type: 'message',
        patientId: safeMotherIdVal,
        patientName: safeMotherNameVal,
        patientPhone: '',
        fromDoctorId: 'system',
        fromDoctorName: 'ANC High-Risk Alert',
        fromHospitalName: data.facilityName || '',
        subject: `HIGH-RISK PREGNANCY: ${data.motherName || 'patient'}`,
        body: `${data.motherName || 'patient'} (ANC visit ${data.visitNumber}) flagged HIGH-RISK. Risk factors: ${factors}. Schedule prompt obstetric review.`,
        channel: 'app',
        status: 'sent',
        sentAt: now,
        orgId: data.orgId,
        createdAt: now,
        updatedAt: now,
      };
      await msgs.put(alertDoc);
      await logAuditSafe('ANC_HIGH_RISK_ALERT', undefined, undefined,
        `Auto-alert: ${data.motherName} (ANC visit ${data.visitNumber}) — risk factors: ${factors}`
      );
    } catch (err) {
      console.warn('[ANC] failed to push high-risk alert message', err);
    }
  }

  return doc;
}

export async function getANCStats(scope?: DataScope) {
  const all = await getAllANCVisits(scope);
  const thisMonth = jubaYearMonth();

  // Unique mothers
  const motherIds = new Set(all.map(v => v.motherId));
  const totalMothers = motherIds.size;

  // ANC4+ coverage: mothers with 4+ visits
  let anc4Plus = 0;
  for (const motherId of motherIds) {
    const visits = all.filter(v => v.motherId === motherId);
    const visitNumbers = visits.map(v => v.visitNumber);
    /* istanbul ignore next -- defensive: visitNumbers is always non-empty when mother has visits */
    const maxVisit = visitNumbers.length > 0 ? Math.max(...visitNumbers) : 0;
    if (maxVisit >= 4) anc4Plus++;
  }

  // High risk count
  const highRiskMotherIds = new Set(
    all.filter(v => v.riskLevel === 'high').map(v => v.motherId)
  );

  // This month visits
  const thisMonthVisits = all.filter(v => jubaIsInMonth(v.visitDate, thisMonth)).length;

  // By state
  const byState = all.reduce((acc, v) => {
    const st = v.state || 'Unknown';
    acc[st] = (acc[st] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // ANC1 coverage (mothers with at least 1 visit)
  const anc1 = totalMothers;

  // Continuum funnel: count mothers by their highest visit number reached
  // (1, 2, 3, 4, 5+) so we can plot a drop-off curve.
  const continuum = { anc1: 0, anc2: 0, anc3: 0, anc4: 0, anc5plus: 0 };
  for (const motherId of motherIds) {
    const visits = all.filter(v => v.motherId === motherId);
    const max = Math.max(0, ...visits.map(v => v.visitNumber));
    continuum.anc1 += max >= 1 ? 1 : 0;
    continuum.anc2 += max >= 2 ? 1 : 0;
    continuum.anc3 += max >= 3 ? 1 : 0;
    continuum.anc4 += max >= 4 ? 1 : 0;
    continuum.anc5plus += max >= 5 ? 1 : 0;
  }

  return {
    totalMothers,
    anc1,
    anc4Plus,
    anc4PlusRate: totalMothers > 0 ? Math.round((anc4Plus / totalMothers) * 100) : 0,
    highRiskCount: highRiskMotherIds.size,
    thisMonthVisits,
    totalVisits: all.length,
    byState,
    continuum,
  };
}

export async function updateANCVisit(id: string, data: Partial<ANCVisitDoc>): Promise<ANCVisitDoc | null> {
  const db = ancDB();
  try {
    const existing = await db.get(id) as ANCVisitDoc;
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
      resourceType: 'anc_visit',
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

export async function deleteANCVisit(id: string): Promise<boolean> {
  const db = ancDB();
  try {
    const doc = await db.get(id);
    const typed = doc as unknown as ANCVisitDoc;
    await db.remove(doc);
    emitSyncEvent({
      resourceType: 'anc_visit',
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

export async function getHighRiskPregnancies(scope?: DataScope): Promise<ANCVisitDoc[]> {
  const all = await getAllANCVisits(scope);
  // Get the most recent visit for each high-risk mother
  const motherLatest = new Map<string, ANCVisitDoc>();
  for (const visit of all) {
    if (visit.riskLevel === 'high') {
      const existing = motherLatest.get(visit.motherId);
      if (!existing || visit.visitNumber > existing.visitNumber) {
        motherLatest.set(visit.motherId, visit);
      }
    }
  }
  return Array.from(motherLatest.values());
}

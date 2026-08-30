/**
 * API: /api/reports
 * GET — Generate CSV reports for MoH reporting.
 *
 * Query params:
 *   type: 'patients' | 'births' | 'deaths' | 'immunizations' | 'lab' | 'prescriptions' | 'dhis2'
 *   format: 'csv' | 'json' (default: csv)
 *   period: YYYY-MM (for DHIS2) or date range
 *   state: filter by state
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import type { UserRole } from '@/lib/db-types';
import { rowsToCsv } from '@/lib/csv';
// hospital_manager holds the /reports route in role-routes.ts (facility
// oversight reads utilisation via reports rather than the per-station
// worklists) — this list had drifted behind that grant.
const REPORT_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'government', 'county_health_director', 'medical_superintendent',
  'hrio', 'data_entry_clerk', 'hospital_manager',
];
function toCSV(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  return rowsToCsv(headers, rows);
}
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, REPORT_ROLES)) return forbidden();
    const url = new URL(request.url);
    const reportType = url.searchParams.get('type') || 'patients';
    const format = url.searchParams.get('format') || 'csv';
    const state = url.searchParams.get('state');
    const { logDataAccess } = await import('@/lib/services/audit-service');
    logDataAccess(auth.sub, auth.name, 'REPORT', reportType, 'EXPORT').catch(() => {});
    let csv = '';
    let jsonData: unknown = null;
    switch (reportType) {
      case 'patients': {
        const { getAllPatients } = await import('@/lib/services/patient-service');
        const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
        let patients = await getAllPatients(buildScopeFromAuth(auth));
        if (state) patients = patients.filter(p => p.state === state);
        const headers = ['Hospital Number', 'First Name', 'Surname', 'Gender', 'Date of Birth', 'Age', 'State', 'County', 'Phone', 'Geocode ID', 'Blood Type', 'Registration Date'];
        const rows = patients.map(p => [
          p.hospitalNumber, p.firstName, p.surname, p.gender, p.dateOfBirth,
          p.estimatedAge || '', p.state, p.county, p.phone, p.geocodeId,
          p.bloodType, p.registeredAt,
        ]);
        csv = toCSV(headers, rows);
        jsonData = patients.map(p => ({
          hospitalNumber: p.hospitalNumber, firstName: p.firstName, surname: p.surname,
          gender: p.gender, dateOfBirth: p.dateOfBirth, state: p.state, county: p.county,
        }));
        break;
      }
      case 'births': {
        const { getAllBirths } = await import('@/lib/services/birth-service');
        const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
        let births = await getAllBirths(buildScopeFromAuth(auth));
        if (state) births = births.filter(b => b.state === state);
        const headers = ['Certificate No', 'Child Name', 'Gender', 'Date of Birth', 'Place of Birth', 'Facility', 'Mother Name', 'Mother Age', 'Birth Weight (g)', 'Delivery Type', 'Attended By', 'State', 'County'];
        const rows = births.map(b => [
          b.certificateNumber, `${b.childFirstName} ${b.childSurname}`, b.childGender,
          b.dateOfBirth, b.placeOfBirth, b.facilityName, b.motherName, b.motherAge,
          b.birthWeight, b.deliveryType, b.attendedBy, b.state, b.county,
        ]);
        csv = toCSV(headers, rows);
        jsonData = births;
        break;
      }
      case 'deaths': {
        const { getAllDeaths } = await import('@/lib/services/death-service');
        const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
        let deaths = await getAllDeaths(buildScopeFromAuth(auth));
        if (state) deaths = deaths.filter(d => d.state === state);
        const headers = ['Certificate No', 'Deceased Name', 'Gender', 'Date of Death', 'Age at Death', 'Place of Death', 'Immediate Cause', 'ICD-11', 'Underlying Cause', 'ICD-11', 'Manner', 'Maternal Death', 'State', 'County'];
        const rows = deaths.map(d => [
          d.certificateNumber, `${d.deceasedFirstName} ${d.deceasedSurname}`, d.deceasedGender,
          d.dateOfDeath, d.ageAtDeath, d.placeOfDeath, d.immediateCause, d.immediateICD11,
          d.underlyingCause, d.underlyingICD11, d.mannerOfDeath, d.maternalDeath, d.state, d.county,
        ]);
        csv = toCSV(headers, rows);
        jsonData = deaths;
        break;
      }
      case 'immunizations': {
        const { getAllImmunizations } = await import('@/lib/services/immunization-service');
        const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
        let imms = await getAllImmunizations(buildScopeFromAuth(auth));
        if (state) imms = imms.filter(i => i.state === state);
        const headers = ['Patient Name', 'Gender', 'Date of Birth', 'Vaccine', 'Dose', 'Date Given', 'Next Due', 'Facility', 'Status', 'Adverse Reaction', 'State'];
        const rows = imms.map(i => [
          i.patientName, i.gender, i.dateOfBirth, i.vaccine, i.doseNumber,
          i.dateGiven, i.nextDueDate, i.facilityName, i.status, i.adverseReaction, i.state,
        ]);
        csv = toCSV(headers, rows);
        jsonData = imms;
        break;
      }
      case 'dhis2': {
        // DHIS2 dataset is national-aggregate (orgUnit "SS") — the export
        // ignores org boundaries by design. An org_admin / data_entry_clerk
        // scoped to a single tenant must NOT receive the cross-tenant
        // aggregate. Only national-scope reporters get it.
        const NATIONAL_DHIS2_ROLES: UserRole[] = ['super_admin', 'government', 'hrio', 'medical_superintendent'];
        if (!hasRole(auth, NATIONAL_DHIS2_ROLES)) return forbidden();
        const period = url.searchParams.get('period') || new Date().toISOString().slice(0, 7);
        const { generateDHIS2Export, exportToCSV } = await import('@/lib/services/dhis2-export-service');
        const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
        const dataset = await generateDHIS2Export(period, buildScopeFromAuth(auth));
        if (format === 'json') {
          return NextResponse.json(dataset);
        }
        csv = exportToCSV(dataset);
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown report type: ${reportType}` }, { status: 400 });
    }
    if (format === 'json') {
      return NextResponse.json({ data: jsonData });
    }
    // Return CSV as downloadable file
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="tamamhealth-${reportType}-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (err) {
    logApiError('[API /reports GET]', err);
    return serverError();
  }
}

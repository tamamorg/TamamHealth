/**
 * API: GET /api/terminology/[resource]?id=<id>
 *
 * Local terminology registry stand-in until the regional registry is live.
 * Serves FHIR CodeSystem and ValueSet resources used by forms + clinical UI.
 * When the regional layer is commissioned, this becomes a caching proxy.
 *
 * Public endpoint — terminology is reference data, no PHI.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logApiError, serverError } from '@/modules/identity';
import { FHIR_NAMESPACE_BASE } from '@/lib/fhir';

const CODE_SYSTEMS = {
  'icd11-notifiable-diseases': {
    resourceType: 'CodeSystem',
    id: 'icd11-notifiable-diseases',
    url: `${FHIR_NAMESPACE_BASE}/terminology/icd11-notifiable`,
    version: '2026-04',
    name: 'NotifiableDiseasesEAC',
    title: 'Notifiable Diseases — East African Region',
    status: 'active',
    content: 'complete',
    concept: [
      { code: '1D44', display: 'Cholera' },
      { code: '1A03', display: 'Measles' },
      { code: '1A0Z', display: 'Acute flaccid paralysis (polio surveillance)' },
      { code: '1A73', display: 'Viral haemorrhagic fever' },
      { code: '1C50', display: 'Meningococcal disease' },
      { code: '1C64', display: 'Tuberculosis' },
      { code: '1D01', display: 'Yellow fever' },
      { code: '1D02', display: 'Dengue' },
      { code: 'XN2ZW', display: 'COVID-19' },
    ],
  },
  'facility-levels-east-africa': {
    resourceType: 'CodeSystem',
    id: 'facility-levels-east-africa',
    url: `${FHIR_NAMESPACE_BASE}/terminology/facility-levels-ea`,
    version: '2026-04',
    name: 'FacilityLevelsEA',
    title: 'Facility Levels — East African Region',
    status: 'active',
    content: 'complete',
    concept: [
      { code: 'community', display: 'Community health post' },
      { code: 'phcu',      display: 'Primary health care unit' },
      { code: 'phcc',      display: 'Primary health care centre' },
      { code: 'county',    display: 'County hospital' },
      { code: 'state',     display: 'State/regional hospital' },
      { code: 'national',  display: 'National referral hospital' },
    ],
  },
};

const VALUE_SETS = {
  'maternal-risk-factors': {
    resourceType: 'ValueSet',
    id: 'maternal-risk-factors',
    url: `${FHIR_NAMESPACE_BASE}/terminology/maternal-risk`,
    version: '2026-04',
    name: 'MaternalRiskFactors',
    status: 'active',
    compose: {
      include: [{
        system: `${FHIR_NAMESPACE_BASE}/terminology/maternal-risk/codes`,
        concept: [
          { code: 'anaemia',        display: 'Anaemia' },
          { code: 'hypertension',   display: 'Hypertension' },
          { code: 'malaria',        display: 'Malaria in pregnancy' },
          { code: 'hiv-positive',   display: 'HIV positive' },
          { code: 'pre-eclampsia',  display: 'Pre-eclampsia' },
          { code: 'gestational-dm', display: 'Gestational diabetes' },
        ],
      }],
    },
  },
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> }
) {
  try {
    const { resource } = await params;
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (resource === 'CodeSystem') {
      if (!id) {
        return NextResponse.json({
          resourceType: 'Bundle',
          type: 'searchset',
          total: Object.keys(CODE_SYSTEMS).length,
          entry: Object.values(CODE_SYSTEMS).map((cs) => ({ fullUrl: `CodeSystem/${cs.id}`, resource: cs })),
        }, { headers: { 'Content-Type': 'application/fhir+json' } });
      }
      const cs = CODE_SYSTEMS[id as keyof typeof CODE_SYSTEMS];
      if (!cs) return NextResponse.json({ error: 'CodeSystem not found' }, { status: 404 });
      return NextResponse.json(cs, { headers: { 'Content-Type': 'application/fhir+json' } });
    }

    if (resource === 'ValueSet') {
      if (!id) {
        return NextResponse.json({
          resourceType: 'Bundle',
          type: 'searchset',
          total: Object.keys(VALUE_SETS).length,
          entry: Object.values(VALUE_SETS).map((vs) => ({ fullUrl: `ValueSet/${vs.id}`, resource: vs })),
        }, { headers: { 'Content-Type': 'application/fhir+json' } });
      }
      const vs = VALUE_SETS[id as keyof typeof VALUE_SETS];
      if (!vs) return NextResponse.json({ error: 'ValueSet not found' }, { status: 404 });
      return NextResponse.json(vs, { headers: { 'Content-Type': 'application/fhir+json' } });
    }

    return NextResponse.json({ error: `Unsupported resource type: ${resource}` }, { status: 400 });
  } catch (err) {
    logApiError('[API /terminology/:resource GET]', err);
    return serverError();
  }
}

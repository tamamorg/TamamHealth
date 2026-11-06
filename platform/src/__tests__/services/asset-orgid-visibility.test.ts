/**
 * An asset must be created with the tenant's orgId, or it is lost: the sync
 * validator refuses an orgId-less doc and filterByScope (fail-closed) hides it
 * from its own creator. The equipment page registered assets without orgId, so
 * `useAssets.create` now stamps it from the active data scope
 * (security/data audit 2026-11-05, §2.1 #10). This locks the contract that
 * makes that stamping load-bearing.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import { createAsset, getAllAssets } from '@/lib/services/asset-service';
import type { DataScope } from '@/lib/services/data-scope';

const creator: DataScope = { role: 'org_admin', orgId: 'org-a', hospitalId: 'h1' } as DataScope;

afterEach(async () => { await teardownTestDBs(); });

describe('asset orgId governs creator visibility', () => {
  it('an asset created with the creator orgId is visible to that creator', async () => {
    await createAsset({
      name: 'Oxygen concentrator', assetTag: 'OC-1', category: 'medical_equipment',
      condition: 'good', facilityId: 'h1', facilityName: 'Juba', facilityLevel: 'county', orgId: 'org-a',
    });
    const visible = await getAllAssets(creator);
    expect(visible.map(a => a.assetTag)).toContain('OC-1');
  });

  it('an asset created with no orgId is hidden from its creator (fail-closed)', async () => {
    await createAsset({
      name: 'Ghost monitor', assetTag: 'GM-1', category: 'medical_equipment',
      condition: 'good', facilityId: 'h1', facilityName: 'Juba', facilityLevel: 'county',
      // orgId omitted — the pre-fix equipment-page behaviour
    });
    const visible = await getAllAssets(creator);
    expect(visible.map(a => a.assetTag)).not.toContain('GM-1');
  });
});

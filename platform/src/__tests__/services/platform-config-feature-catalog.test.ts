/** @jest-environment node */
import { platformConfigDB } from '@/lib/db';
import { logAudit } from '@/lib/services/audit-service';
import { updatePlatformConfig } from '@/lib/services/platform-config-service';
import { TAMAM_REFERENCE_BASELINE_ID } from '@/modules/feature-catalog';

jest.mock('@/lib/db', () => ({ platformConfigDB: jest.fn() }));
jest.mock('@/lib/services/audit-service', () => ({ logAudit: jest.fn() }));

const db = {
  get: jest.fn(),
  put: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (platformConfigDB as jest.Mock).mockReturnValue(db);
  db.get.mockResolvedValue({
    _id: 'platform-config',
    _rev: '1-a',
    type: 'platform_config',
    featureCatalog: {
      baselineId: TAMAM_REFERENCE_BASELINE_ID,
      mode: 'tamam_current',
      cutovers: {},
    },
  });
  db.put.mockResolvedValue({ rev: '2-b' });
});

test('records feature rollout changes with their before and after stages', async () => {
  await updatePlatformConfig({
    featureCatalog: {
      baselineId: TAMAM_REFERENCE_BASELINE_ID,
      mode: 'tamam_current',
      cutovers: { appointments: 'parked' },
    },
  }, 'admin-1', 'admin');

  expect(logAudit).toHaveBeenCalledWith(
    'feature_catalog_updated',
    'admin-1',
    'admin',
    expect.stringContaining('appointments: default -> parked'),
    true,
  );
});

test('keeps unrelated platform configuration changes on the generic audit action', async () => {
  await updatePlatformConfig({ maintenanceMode: true }, 'admin-1', 'admin');

  expect(logAudit).toHaveBeenCalledWith(
    'platform_config_updated',
    'admin-1',
    'admin',
    'Updated platform configuration',
    true,
  );
});

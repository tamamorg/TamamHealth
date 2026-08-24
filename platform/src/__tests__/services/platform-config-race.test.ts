const mockGet = jest.fn();
const mockPut = jest.fn();

jest.mock('@/lib/db', () => ({
  platformConfigDB: () => ({ get: mockGet, put: mockPut }),
}));

import { getPlatformConfig } from '@/lib/services/platform-config-service';
import type { PlatformConfigDoc } from '@/lib/db-types';

const winner: PlatformConfigDoc = {
  _id: 'platform-config',
  _rev: '7-winner',
  type: 'platform_config',
  platformName: 'Replicated configuration',
  maintenanceMode: false,
  globalFeatureFlags: { signupsEnabled: true, trialDays: 30, maxOrganizations: 100 },
  defaultPrimaryColor: '#123456',
  defaultSecondaryColor: '#654321',
  superAdminPolicies: {
    passwordMinLength: 12,
    sessionTimeoutMinutes: 15,
    emergencyAccessEnabled: true,
    emergencyAccessReviewHours: 24,
    impersonationEnabled: false,
    impersonationMaxMinutes: 30,
    dualApprovalForHighRisk: true,
    auditRetentionYears: 6,
    phiExportRequiresReason: true,
    dataDeletionRequiresApproval: true,
    ssoEnabled: false,
    apiKeysEnabled: false,
    backupRpoHours: 24,
    backupRtoHours: 8,
    supportAccessRequiresTicket: true,
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('returns the winning document when another initializer creates the singleton', async () => {
  mockGet
    .mockRejectedValueOnce({ status: 404, name: 'not_found' })
    .mockResolvedValueOnce(winner);
  mockPut.mockRejectedValueOnce({ status: 409, name: 'conflict' });

  await expect(getPlatformConfig()).resolves.toBe(winner);
  expect(mockGet).toHaveBeenCalledTimes(2);
  expect(mockPut).toHaveBeenCalledTimes(1);
});

test('does not turn non-404 read errors into writes', async () => {
  const denied = { status: 401, name: 'unauthorized' };
  mockGet.mockRejectedValueOnce(denied);

  await expect(getPlatformConfig()).rejects.toBe(denied);
  expect(mockPut).not.toHaveBeenCalled();
});

test('does not hide non-conflict write failures', async () => {
  const unavailable = { status: 503, name: 'unavailable' };
  mockGet.mockRejectedValueOnce({ status: 404, name: 'not_found' });
  mockPut.mockRejectedValueOnce(unavailable);

  await expect(getPlatformConfig()).rejects.toBe(unavailable);
});

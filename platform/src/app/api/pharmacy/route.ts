/**
 * API: /api/pharmacy
 * GET  — List pharmacy inventory (supports ?hospitalId=xxx)
 * POST — Create inventory item, update stock, or decrement
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthPayload, unauthorized, forbidden, hasRole, serverError, logApiError,
} from '@/lib/api-auth';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse',
  'pharmacist', 'medical_superintendent',
];
const WRITE_ROLES: UserRole[] = [
  'super_admin', 'pharmacist', 'medical_superintendent',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const { getAllInventory, classifyStockStatus } = await import('@/lib/services/pharmacy-inventory-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const scope = buildScopeFromAuth(auth);
    const inventory = await getAllInventory(scope);
    // Add stock status classification to each item
    const enriched = inventory.map(item => ({
      ...item,
      stockStatus: classifyStockStatus(item),
    }));
    // Summary stats
    const summary = {
      total: enriched.length,
      adequate: enriched.filter(i => i.stockStatus === 'adequate').length,
      low: enriched.filter(i => i.stockStatus === 'low').length,
      critical: enriched.filter(i => i.stockStatus === 'critical').length,
      expired: enriched.filter(i => i.stockStatus === 'expired').length,
    };
    return NextResponse.json({ inventory: enriched, summary });
  } catch (err) {
    logApiError('[API /pharmacy GET]', err);
    return serverError();
  }
}
async function postHandler(request: NextRequest) {
  try {
    const { checkRateLimit } = await import('@/lib/api-security');
    const rateLimitResponse = await checkRateLimit(request, 'pharmacy:write', 30);
    if (rateLimitResponse) return rateLimitResponse;
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, WRITE_ROLES)) return forbidden();
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { sanitizePayload } = await import('@/lib/validation');
    body = sanitizePayload(body);
    const action = body.action as string;
    // Decrement stock (when dispensing)
    if (action === 'decrement') {
      if (!body.medicationName || !body.quantity) {
        return NextResponse.json(
          { error: 'medicationName and quantity are required' },
          { status: 400 }
        );
      }
      const { decrementStock } = await import('@/lib/services/pharmacy-inventory-service');
      await decrementStock(
        body.medicationName as string,
        auth.hospitalId,
        Number(body.quantity) || 1,
      );
      return NextResponse.json({ success: true });
    }
    // Update existing item
    if (action === 'update' && body.itemId) {
      const { updateInventoryItem } = await import('@/lib/services/pharmacy-inventory-service');
      const updated = await updateInventoryItem(body.itemId as string, {
        stockLevel: body.stockLevel !== undefined ? Number(body.stockLevel) : undefined,
        reorderLevel: body.reorderLevel !== undefined ? Number(body.reorderLevel) : undefined,
        expiryDate: body.expiryDate as string | undefined,
        batchNumber: body.batchNumber as string | undefined,
      } as Parameters<typeof updateInventoryItem>[1]);
      if (!updated) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      return NextResponse.json({ item: updated });
    }
    // Delete item
    if (action === 'delete' && body.itemId) {
      const { deleteInventoryItem } = await import('@/lib/services/pharmacy-inventory-service');
      const deleted = await deleteInventoryItem(body.itemId as string);
      if (!deleted) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      return NextResponse.json({ deleted: true });
    }
    // Create new inventory item
    if (!body.medicationName || !body.stockLevel || !body.batchNumber) {
      return NextResponse.json(
        { error: 'medicationName, stockLevel, and batchNumber are required' },
        { status: 400 }
      );
    }
    body.hospitalId = auth.hospitalId;
    body.orgId = auth.orgId;
    const { createInventoryItem } = await import('@/lib/services/pharmacy-inventory-service');
    const item = await createInventoryItem(body as Parameters<typeof createInventoryItem>[0]);
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    logApiError('[API /pharmacy POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'pharmacy.create' });

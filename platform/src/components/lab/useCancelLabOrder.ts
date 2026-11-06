'use client';

import { useCallback } from 'react';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { useConfirmPrompt } from '@/components/ConfirmDialog';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { describeError } from '@/lib/user-facing-error';
import type { LabResultDoc } from '@/lib/db-types';
import { effectiveOrderStatus } from '@/lib/services/lab-service';

/** Pure gate for the row action: only an order still at `ordered` can be withdrawn. */
export function canCancelLabOrder(order: Pick<LabResultDoc, 'orderStatus' | 'status'>): boolean {
  return effectiveOrderStatus(order) === 'ordered';
}

/**
 * "Cancel order" for a lab test that has not been collected yet: asks why
 * (required, danger tone), withdraws the order and its charge, and says what
 * happened to the charge. Returns whether the order was cancelled.
 */
export function useCancelLabOrder() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const confirmPrompt = useConfirmPrompt();
  const { t } = useTranslation();

  return useCallback(async (order: Pick<LabResultDoc, '_id' | 'testName'>): Promise<boolean> => {
    const reason = await confirmPrompt({
      title: t('lab.cancelOrderTitle', { test: order.testName }),
      message: t('lab.cancelOrderMessage'),
      inputLabel: t('lab.cancelOrderReason'),
      inputRequired: true,
      confirmLabel: t('lab.cancelOrder'),
      tone: 'danger',
    });
    if (!reason?.trim()) return false;
    try {
      const { cancelLabOrder } = await import('@/lib/services/lab-service');
      const { billing } = await cancelLabOrder(order._id, reason, {
        id: currentUser?._id,
        name: currentUser?.name || currentUser?.username || 'Staff',
        role: currentUser?.role,
      });
      if (billing === 'reversed') showToast(t('lab.orderCancelledRefund', { test: order.testName }), 'success');
      else if (billing === 'line_removed') showToast(t('lab.orderCancelledLineRemoved', { test: order.testName }), 'success');
      else if (billing === 'manual') showToast(t('lab.orderCancelledBilling', { test: order.testName }), 'success');
      else showToast(t('lab.orderCancelled', { test: order.testName }), 'success');
      return true;
    } catch (err) {
      showToast(describeError(err, t('lab.orderNotCancelled')), 'error');
      return false;
    }
  }, [confirmPrompt, currentUser, showToast, t]);
}

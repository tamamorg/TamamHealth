import { Banknote, Smartphone, CreditCard, Building2, Shield, Gift, FileText, type LucideIcon } from '@/components/icons/lucide';

export interface PaymentMethodConfig {
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  color: string;
}

/**
 * Display config (label/icon/colour) keyed by the low-level tender/provider
 * identifier used on `PaymentDoc.method` (see `PaymentMethodType` in
 * db-types-payments.ts).
 *
 * IMPORTANT — this is NOT the list of payment *methods* that a facility
 * offers. Two distinct concepts are deliberately conflated here only as a
 * display lookup; keep them separate when deciding what to show:
 *
 *   • "Methods" — the settings-gated tabs the cashier can pick from. These are
 *     the higher-level `PaymentMethodKey`s in facility-settings.ts
 *     (cash, mobile_money, voucher, partial_payment, bank_transfer, card) and
 *     are the source of truth for which payment options are *offered*.
 *   • "Mobile-money providers" — the sub-options shown *under* the single
 *     `mobile_money` method (mpesa / airtel / mtn_momo / m_gurush). Provider
 *     selection is independent of method gating: enabling `mobile_money` in
 *     settings exposes the providers below as sub-choices.
 *
 * `insurance` / `waiver` / `payment_plan` are payor/exemption flows, not
 * tender types, and live here only so receipts can render an icon for them.
 */

/** Mobile-money providers — sub-options under the `mobile_money` method. */
export const MOBILE_MONEY_PROVIDERS = ['mpesa', 'airtel', 'mtn_momo', 'm_gurush'] as const;
export type MobileMoneyProvider = typeof MOBILE_MONEY_PROVIDERS[number];

export const PAYMENT_METHOD_CONFIG: Record<string, PaymentMethodConfig> = {
  cash: { label: 'Cash', shortLabel: 'Cash', icon: Banknote, color: 'var(--color-success)' },
  mpesa: { label: 'M-Pesa', shortLabel: 'M-Pesa', icon: Smartphone, color: '#4CAF50' },
  airtel: { label: 'Airtel Money', shortLabel: 'Airtel', icon: Smartphone, color: '#E53935' },
  mtn_momo: { label: 'MTN Mobile Money', shortLabel: 'MTN MoMo', icon: Smartphone, color: '#FFC107' },
  m_gurush: { label: 'm-GURUSH', shortLabel: 'm-GURUSH', icon: Smartphone, color: '#0EA5A4' },
  card: { label: 'Card (Flutterwave)', shortLabel: 'Card', icon: CreditCard, color: 'var(--accent-primary)' },
  bank_transfer: { label: 'Bank Transfer', shortLabel: 'Bank', icon: Building2, color: '#607D8B' },
  insurance: { label: 'Insurance Payment', shortLabel: 'Insurance', icon: Shield, color: '#9C27B0' },
  waiver: { label: 'Fee Waiver', shortLabel: 'Waiver', icon: Gift, color: '#FF9800' },
  payment_plan: { label: 'Payment Plan', shortLabel: 'Plan', icon: FileText, color: '#00BCD4' },
};

export function getMethodConfig(method: string): PaymentMethodConfig {
  return PAYMENT_METHOD_CONFIG[method] || { label: method, shortLabel: method, icon: Banknote, color: 'var(--text-muted)' };
}

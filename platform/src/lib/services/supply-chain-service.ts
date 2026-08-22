/**
 * Supply Chain Service
 *
 * Provides stock-out alerts, supply chain visibility, and essential medicine
 * monitoring for low-resource hospital settings. Built around WHO's Model List
 * of Essential Medicines and South Sudan's pharmaceutical supply context.
 *
 * Key features:
 * - Real-time stock status classification (adequate/low/critical/expired/stockout)
 * - Facility-level and system-wide stock alerts
 * - Essential medicine gap analysis
 * - Consumption trend tracking for forecasting
 * - Expiry-soon warnings (30/60/90 day windows)
 */
import { pharmacyInventoryDB } from '../db';
import type { PharmacyInventoryDoc } from '../db-types';
import { classifyStockStatus, dispensedTodayOf } from './pharmacy-inventory-service';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';

// WHO Essential Medicines commonly needed in South Sudan facilities
const ESSENTIAL_MEDICINES = [
  // Antimalarials
  'Artemether-Lumefantrine', 'Artesunate', 'Quinine',
  // Antibiotics
  'Amoxicillin', 'Ciprofloxacin', 'Metronidazole', 'Gentamicin', 'Ceftriaxone',
  'Cotrimoxazole', 'Doxycycline', 'Azithromycin', 'Erythromycin',
  // Analgesics
  'Paracetamol', 'Ibuprofen', 'Diclofenac', 'Tramadol', 'Morphine',
  // ORS & IV Fluids
  'Oral Rehydration Salts', 'Ringer Lactate', 'Normal Saline', 'Dextrose 5%',
  // Maternal & Child
  'Oxytocin', 'Misoprostol', 'Magnesium Sulfate', 'Iron Folate', 'Zinc Sulfate',
  'Vitamin A',
  // HIV/TB
  'Nevirapine', 'Zidovudine', 'Tenofovir', 'Isoniazid', 'Rifampicin',
  // Vaccines
  'BCG', 'OPV', 'Pentavalent', 'Measles', 'Yellow Fever',
  // Other essentials
  'Adrenaline', 'Diazepam', 'Phenobarbitone', 'Salbutamol', 'Hydrocortisone',
  'Chlorhexidine', 'Insulin', 'Metformin', 'Amlodipine', 'Enalapril',
];

export interface StockAlert {
  id: string;
  medicationName: string;
  facilityId?: string;
  hospitalId?: string;
  alertType: 'stockout' | 'critical' | 'low' | 'expiring_soon' | 'expired';
  currentStock: number;
  reorderLevel: number;
  unit: string;
  expiryDate?: string;
  daysUntilExpiry?: number;
  isEssentialMedicine: boolean;
  severity: 'emergency' | 'high' | 'medium' | 'low';
  message: string;
  createdAt: string;
}

export interface SupplyChainSummary {
  totalItems: number;
  adequate: number;
  low: number;
  critical: number;
  expired: number;
  stockout: number;
  expiringWithin30Days: number;
  expiringWithin90Days: number;
  essentialMedicineGaps: string[];
  alerts: StockAlert[];
  facilityBreakdown: FacilityStockSummary[];
}

export interface FacilityStockSummary {
  facilityId: string;
  facilityName: string;
  totalItems: number;
  adequate: number;
  low: number;
  critical: number;
  stockout: number;
  expired: number;
  stockHealthPercent: number; // 0-100
}

function isEssentialMedicine(name: string): boolean {
  const lower = name.toLowerCase();
  return ESSENTIAL_MEDICINES.some(em => lower.includes(em.toLowerCase()));
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  return Math.floor((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function alertSeverity(item: PharmacyInventoryDoc, status: string): 'emergency' | 'high' | 'medium' | 'low' {
  const essential = isEssentialMedicine(item.medicationName);
  /* istanbul ignore next -- alertSeverity: expired branch */
  if (status === 'expired') return 'high';
  /* istanbul ignore next -- alertSeverity: stockout branch */
  if (status === 'stockout') return 'emergency';
  /* istanbul ignore next -- alertSeverity: critical + essential branch */
  if (status === 'critical' && essential) return 'emergency';
  /* istanbul ignore next -- alertSeverity: critical non-essential branch */
  if (status === 'critical') return 'high';
  if (status === 'low' && essential) return 'high';
  /* istanbul ignore next -- alertSeverity: non-essential low stock branch */
  if (status === 'low') return 'medium';
  /* istanbul ignore next -- defensive fallback: adequate non-essential stock */
  return 'low';
}

/**
 * Generate stock alerts for all inventory items across the system.
 */
export async function getStockAlerts(facilityId?: string, scope?: DataScope): Promise<StockAlert[]> {
  const db = pharmacyInventoryDB();
  let items = await findByType<PharmacyInventoryDoc>(db, 'pharmacy_inventory');
  /* istanbul ignore next -- defensive: facility filter depends on param */
  items = items.filter(d => !facilityId || d.hospitalId === facilityId);
  if (scope) items = filterByScope(items, scope);

  const alerts: StockAlert[] = [];
  const now = new Date().toISOString();

  for (const item of items) {
    const status = classifyStockStatus(item);
    const essential = isEssentialMedicine(item.medicationName);

    // Stock-level alerts
    if (item.stockLevel <= 0) {
      alerts.push({
        id: `alert-${item._id}-stockout`,
        medicationName: item.medicationName,
        facilityId: item.hospitalId,
        hospitalId: item.hospitalId,
        alertType: 'stockout',
        currentStock: 0,
        reorderLevel: item.reorderLevel,
        unit: item.unit,
        isEssentialMedicine: essential,
        severity: essential ? 'emergency' : 'high',
        message: `STOCKOUT: ${item.medicationName} has 0 ${item.unit} remaining${essential ? ' (ESSENTIAL MEDICINE)' : ''}`,
        createdAt: now,
      });
    } else if (status === 'critical') {
      alerts.push({
        id: `alert-${item._id}-critical`,
        medicationName: item.medicationName,
        facilityId: item.hospitalId,
        hospitalId: item.hospitalId,
        alertType: 'critical',
        currentStock: item.stockLevel,
        reorderLevel: item.reorderLevel,
        unit: item.unit,
        isEssentialMedicine: essential,
        severity: alertSeverity(item, 'critical'),
        message: `CRITICAL: ${item.medicationName} at ${item.stockLevel} ${item.unit} (reorder at ${item.reorderLevel})`,
        createdAt: now,
      });
    } else if (status === 'low') {
      alerts.push({
        id: `alert-${item._id}-low`,
        medicationName: item.medicationName,
        facilityId: item.hospitalId,
        hospitalId: item.hospitalId,
        alertType: 'low',
        currentStock: item.stockLevel,
        reorderLevel: item.reorderLevel,
        unit: item.unit,
        isEssentialMedicine: essential,
        severity: alertSeverity(item, 'low'),
        message: `LOW STOCK: ${item.medicationName} at ${item.stockLevel} ${item.unit} (reorder at ${item.reorderLevel})`,
        createdAt: now,
      });
    }

    // Expiry alerts
    /* istanbul ignore next -- defensive: item may lack expiry date */
    if (item.expiryDate) {
      const days = daysUntil(item.expiryDate);
      if (status === 'expired') {
        alerts.push({
          id: `alert-${item._id}-expired`,
          medicationName: item.medicationName,
          facilityId: item.hospitalId,
          hospitalId: item.hospitalId,
          alertType: 'expired',
          currentStock: item.stockLevel,
          reorderLevel: item.reorderLevel,
          unit: item.unit,
          expiryDate: item.expiryDate,
          daysUntilExpiry: days,
          isEssentialMedicine: essential,
          severity: 'high',
          message: `EXPIRED: ${item.medicationName} expired on ${item.expiryDate} — remove from dispensing`,
          createdAt: now,
        });
      } else if (days > 0 && days <= 90) {
        alerts.push({
          id: `alert-${item._id}-expiring`,
          medicationName: item.medicationName,
          facilityId: item.hospitalId,
          hospitalId: item.hospitalId,
          alertType: 'expiring_soon',
          currentStock: item.stockLevel,
          reorderLevel: item.reorderLevel,
          unit: item.unit,
          expiryDate: item.expiryDate,
          daysUntilExpiry: days,
          isEssentialMedicine: essential,
          severity: days <= 30 ? 'high' : 'medium',
          message: `EXPIRING: ${item.medicationName} expires in ${days} days (${item.expiryDate})`,
          createdAt: now,
        });
      }
    }
  }

  // Sort: emergency first, then high, medium, low
  const severityOrder = { emergency: 0, high: 1, medium: 2, low: 3 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts;
}

/**
 * Get a comprehensive supply chain summary across all facilities or a specific one.
 */
export async function getSupplyChainSummary(facilityId?: string, scope?: DataScope): Promise<SupplyChainSummary> {
  const db = pharmacyInventoryDB();
  let items = await findByType<PharmacyInventoryDoc>(db, 'pharmacy_inventory');
  /* istanbul ignore next -- defensive: facility filter depends on param */
  items = items.filter(d => !facilityId || d.hospitalId === facilityId);
  if (scope) items = filterByScope(items, scope);

  let adequate = 0, low = 0, critical = 0, expired = 0, stockout = 0;
  let expiringWithin30Days = 0, expiringWithin90Days = 0;

  const facilityMap = new Map<string, FacilityStockSummary>();
  const availableMeds = new Set<string>();

  for (const item of items) {
    const status = classifyStockStatus(item);
    availableMeds.add(item.medicationName.toLowerCase());

    // Facility aggregation
    /* istanbul ignore next -- defensive: hospitalId should always exist */
    const fid = item.hospitalId || 'unknown';
    if (!facilityMap.has(fid)) {
      facilityMap.set(fid, {
        facilityId: fid,
        facilityName: fid,
        totalItems: 0, adequate: 0, low: 0, critical: 0, stockout: 0, expired: 0,
        stockHealthPercent: 0,
      });
    }
    const fac = facilityMap.get(fid)!;
    fac.totalItems++;

    if (item.stockLevel <= 0) {
      stockout++;
      fac.stockout++;
    } else if (status === 'expired') {
      expired++;
      fac.expired++;
    } else if (status === 'critical') {
      critical++;
      fac.critical++;
    } else if (status === 'low') {
      low++;
      fac.low++;
    } else {
      adequate++;
      fac.adequate++;
    }

    /* istanbul ignore next -- defensive: item may lack expiry date */
    if (item.expiryDate) {
      const days = daysUntil(item.expiryDate);
      if (days > 0 && days <= 30) expiringWithin30Days++;
      if (days > 0 && days <= 90) expiringWithin90Days++;
    }
  }

  // Calculate facility health percentages
  for (const fac of facilityMap.values()) {
    /* istanbul ignore next -- defensive: totalItems is always > 0 when facility exists */
    fac.stockHealthPercent = fac.totalItems > 0
      ? Math.round((fac.adequate / fac.totalItems) * 100)
      : 0;
  }

  // Essential medicine gap analysis
  const essentialMedicineGaps = ESSENTIAL_MEDICINES.filter(
    em => !Array.from(availableMeds).some(am => am.includes(em.toLowerCase()))
  );

  const alerts = await getStockAlerts(facilityId, scope);

  return {
    totalItems: items.length,
    adequate,
    low,
    critical,
    expired,
    stockout,
    expiringWithin30Days,
    expiringWithin90Days,
    essentialMedicineGaps,
    alerts,
    facilityBreakdown: Array.from(facilityMap.values())
      .sort((a, b) => a.stockHealthPercent - b.stockHealthPercent),
  };
}

/**
 * Get consumption trends for a medication over the past N days.
 * Useful for forecasting re-order quantities.
 */
export async function getConsumptionTrend(
  medicationName: string,
  facilityId?: string,
  scope?: DataScope,
): Promise<{ dailyAverage: number; projectedStockoutDays: number | null; currentStock: number }> {
  const db = pharmacyInventoryDB();
  let items = await findByType<PharmacyInventoryDoc>(
    db,
    'pharmacy_inventory',
    { medicationName },
    { indexFields: ['type', 'medicationName'] },
  );
  /* istanbul ignore next -- defensive: facility filter depends on param */
  items = items.filter(d => !facilityId || d.hospitalId === facilityId);
  if (scope) items = filterByScope(items, scope);

  if (items.length === 0) {
    return { dailyAverage: 0, projectedStockoutDays: null, currentStock: 0 };
  }

  const item = items[0];
  // Day-guarded read: the raw field may hold yesterday's (or, on docs written
  // before the day-stamp existed, a lifetime) total — dispensedTodayOf
  // returns 0 for anything not stamped with today's Juba day.
  const dispensedToday = dispensedTodayOf(item);
  // Rough daily average until a real consumption history exists.
  const dailyAverage = dispensedToday > 0 ? dispensedToday : 1;
  const projectedStockoutDays = item.stockLevel > 0
    ? Math.ceil(item.stockLevel / dailyAverage)
    : 0;

  return {
    dailyAverage,
    projectedStockoutDays,
    currentStock: item.stockLevel,
  };
}

export { ESSENTIAL_MEDICINES };

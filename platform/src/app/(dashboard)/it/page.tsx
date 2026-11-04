'use client';

/**
 * Standalone IT Operations page. The console itself lives in
 * ItOperationsPanel and is also hosted as the "IT Operations" section of
 * /system-admin — this route stays for deep links and roles that keep a
 * dedicated nav entry.
 */

import EhrListHeader from '@/components/ehr/EhrListHeader';
import ItOperationsPanel from '@/components/admin/ItOperationsPanel';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function ItOperationsPage() {
  const { t } = useTranslation();
  return (
    <main className="page-container page-enter">
      <div className="dash-card overflow-hidden mb-4">
        <EhrListHeader title={t('ui.itOperations')} />
      </div>
      <ItOperationsPanel />
    </main>
  );
}

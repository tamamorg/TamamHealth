/**
 * DEPRECATED REDIRECT — remove after 2027-02-01.
 *
 * The Work Queue (inquiries · pending leave · available staff) was deleted
 * on 2026-11-04 in the management navigation redesign: it repeated three
 * pages that already exist in full (/inquiries, /hr/leave, the staff list),
 * and its KPI row repeated the counts on its own section list. Those pages
 * are now tabs of the Patients and Workforce hubs (lib/navigation/
 * module-hubs.ts). This stub only keeps old bookmarks working; nothing in
 * the product links here.
 */
import { redirect } from 'next/navigation';

export default function WorkQueueRedirect() {
  redirect('/inquiries');
}

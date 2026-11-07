import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { type AppointmentStatusGroup } from '@/lib/appointment-status';
import { jubaDate } from '@/lib/time-juba';
import { useUrlView } from '@/lib/navigation/use-url-view';

export function useDeskBoardState() {
  // Which of the three shared lanes the tabs show: Scheduled = today's
  // bookings still expecting the patient, In Office = the live in-building
  // queue, Finished = visits at/after checkout. Same lanes as every other
  // role dashboard and the mobile shell.
  const [queueFilter, setQueueFilter] = useState<AppointmentStatusGroup>('scheduled');
  // In the URL so Back returns to the tab the user was on.
  const [panelView, setPanelView] = useUrlView(['all', 'appointments', 'pending', 'queue', 'registered'] as const, 'all');
  const searchParams = useSearchParams();
  const queueSort: 'priority' | 'name' | 'time' | 'status' = 'priority';
  const [queueSearch, setQueueSearch] = useState('');
  const [queueNowMs, setQueueNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setQueueNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // The CLINICAL day (Africa/Juba), the same clock check-in stamps a walk-in's
  // booking with (check-in-service uses jubaDate()). A device-local day here
  // let a machine outside Juba see "Nov 5" while the walk-in's booking was
  // dated "Nov 6", so the queue row found no booking. Never a UTC slice.
  const today = jubaDate();
  // The day the board is showing. The mini-calendar drives it; today by
  // default. The LIVE parts of the board (triage queue, checkout encounters,
  // walk-ins physically in the building) only exist for today — another day
  // shows that day's appointments alone, split into the same three lanes.
  const [boardDate, setBoardDate] = useState<string>(today);
  const viewingToday = boardDate === today;

  // Deep link: ?lane= lands on a specific lane tab, ?q= prefills the queue
  // search and ?date= opens the board on a specific day — how any other
  // surface points a clerk straight at one patient's row.
  //
  // ?date= matters because this board only ever shows one day and defaults to
  // today: pointing at a patient whose booking is later in the week without it
  // lands the clerk on a lane filtered to someone with nothing on it, which
  // reads as "the link did nothing".
  useEffect(() => {
    const lane = searchParams?.get('lane');
    if (lane === 'scheduled' || lane === 'in_office' || lane === 'finished') {
      setQueueFilter(lane);
      setPanelView('all');
    }
    const q = searchParams?.get('q');
    if (q) setQueueSearch(q);
    // Validated shape, not just truthiness — boardDate drives every row filter
    // on the page, so a malformed value would empty the whole board.
    const date = searchParams?.get('date');
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) setBoardDate(date);
  }, [searchParams, setPanelView]);

  const handleTabChange = useCallback((tab: string) => {
    setQueueFilter(tab as AppointmentStatusGroup);
    // Leave any tile-opened special view: the lane tabs drive the main list.
    setPanelView('all');
  }, [setPanelView]);

  return {
    queueFilter, panelView, setPanelView, searchParams, queueSort,
    queueSearch, setQueueSearch, queueNowMs, today, boardDate, setBoardDate,
    viewingToday, handleTabChange,
  };
}

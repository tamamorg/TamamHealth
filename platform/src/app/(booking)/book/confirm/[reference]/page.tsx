import { publicBookingOrigin } from '@/lib/booking/public-base-url';
import { longWhen } from '@/lib/booking/public-client';
import T from '@/components/T';

export const dynamic = 'force-dynamic';

interface Confirmation {
  reference: string;
  status: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  providerName: string;
  facilityName: string;
  visitReasonName: string;
  firstName?: string;
}

async function load(ref: string): Promise<Confirmation | null> {
  try {
    const res = await fetch(`${publicBookingOrigin()}/api/booking/reference/${encodeURIComponent(ref)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json() as Confirmation;
  } catch {
    return null;
  }
}

/**
 * Status page for a booking reference.
 *
 * Reachable by anyone holding the reference, which is why the endpoint behind
 * it returns so little. A wrong code gets the same neutral message as an
 * expired one — there is nothing here to tell a guesser they are close.
 */
export default async function ConfirmPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const data = await load(reference);

  if (!data) {
    return (
      <div className="booking-page booking-confirm">
        <section className="booking-card">
          <div className="booking-card-body">
            <h1 className="booking-h1" style={{ fontSize: 22 }}><T k="ui.bookingNotFound" en="We couldn’t find that booking" /></h1>
            <p className="booking-hint">
              <T k="ui.bookingNotFoundHint" en="Check the reference from your confirmation message, or call the practice." />
            </p>
          </div>
        </section>
      </div>
    );
  }

  const confirmed = data.status === 'scheduled' || data.status === 'confirmed';

  return (
    <div className="booking-page booking-confirm">
      <section className="booking-card">
        <header className="booking-card-head">
          {confirmed
            ? <T k="ui.appointmentConfirmed" en="Appointment confirmed" />
            : <T k="ui.appointmentRequested" en="Appointment requested" />}
        </header>
        <div className="booking-card-body">
          {data.firstName && <p className="booking-hint" style={{ fontSize: 15 }}><T k="ui.helloName" vars={{ name: data.firstName }} en="Hello {{name}}," /></p>}
          <p className="booking-hint" style={{ fontSize: 15 }}>
            {confirmed
              ? <T k="ui.bookingConfirmedArriveEarly" en="Your appointment is booked. Arrive a few minutes early." />
              : <T k="ui.bookingRequestSent" en="Your request has been sent to the practice. They will confirm it shortly." />}
          </p>
          <div className="booking-reference">{data.reference}</div>
          <div className="booking-divider" />
          <b style={{ fontSize: 18 }}>{longWhen(data.date, data.startTime)}</b>
          <span className="booking-hint">
            {data.visitReasonName} · {data.durationMinutes} min
          </span>
          <span className="booking-hint">
            {data.providerName} · {data.facilityName}
          </span>
          <div className="booking-divider" />
          <p className="booking-hint">
            <T k="ui.bookingChangeCall" en="To change or cancel, call the practice and quote your reference." />
          </p>
        </div>
      </section>
    </div>
  );
}

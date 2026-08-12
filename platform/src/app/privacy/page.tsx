import type { Metadata } from 'next';
import PublicLegalShell from '@/components/PublicLegalShell';

export const metadata: Metadata = {
  title: 'Privacy Policy — TamamHealth',
  description: 'Privacy Policy for the TamamHealth digital health records platform.',
};

export default function PrivacyPage() {
  return (
    <PublicLegalShell
      title="Privacy Policy"
      // The eyebrow above already carries the platform's name; this says what
      // the document is about.
      subtitle="How personal and health information is collected, used, stored and shared."
    >
      <p>
        TamamHealth processes personal and health information to support patient care,
        facility operations, and public-health reporting. This policy summarises how that
        information is handled.
      </p>

      <h2>1. Information we process</h2>
      <p>
        Patient demographics and clinical records entered by healthcare workers; staff
        account details; and operational data (appointments, billing, inventory). Access
        and changes are recorded in an audit log.
      </p>

      <h2>2. How it is used</h2>
      <p>
        Information is used to deliver and coordinate care, to operate participating
        facilities, and to produce aggregated, de-identified statistics for health
        authorities. It is not sold.
      </p>

      <h2>3. Storage and security</h2>
      <p>
        The platform is offline-first: data is stored encrypted on the device and
        synchronised to the organisation&rsquo;s servers when online. Access is restricted by
        role and scoped to a user&rsquo;s organisation and facility. Passwords are stored only
        as salted hashes.
      </p>

      <h2>4. Sharing</h2>
      <p>
        Patient data is shared between facilities only where needed for referrals and
        continuity of care, and with health authorities as required by law. Sub-processors
        are bound by equivalent confidentiality obligations.
      </p>

      <h2>5. Your rights and contact</h2>
      <p>
        Patients may request access to or correction of their records through their
        facility. For privacy questions, contact your facility administrator or{' '}
        <a href="mailto:support.tamam@gmail.com">support.tamam@gmail.com</a>.
      </p>

      <p className="lg-note">
        This summary is provided for convenience. The operating organisation (e.g. the
        Ministry of Health) maintains the binding policy; contact your administrator for
        the full, current version.
      </p>
    </PublicLegalShell>
  );
}

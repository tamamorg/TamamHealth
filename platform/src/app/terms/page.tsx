import type { Metadata } from 'next';
import PublicLegalShell, { type LegalTocEntry } from '@/components/PublicLegalShell';

/**
 * /terms — the Terms & Conditions, as a document.
 *
 * Public and unauthenticated (see the allow-list in `proxy.ts`): a patient, a
 * regulator, or a facility deciding whether to adopt the platform has to be
 * able to read the whole text having never had a login. Nothing on this page
 * reads app state, and nothing on it is a step in signing in.
 *
 * When the text changes in substance, raise VERSION and move EFFECTIVE_DATE
 * in the same edit — §16 promises readers that both mean something.
 */

const VERSION = '2.0';
const EFFECTIVE_DATE = '12 August 2026';

export const metadata: Metadata = {
  title: 'Terms & Conditions — TamamHealth',
  description:
    'Terms & Conditions for the TamamHealth offline-first digital health records platform: authorised use, clinical responsibility, patient data, availability, and governing law.',
};

const TOC: LegalTocEntry[] = [
  { id: 'about', label: 'About this document' },
  { id: 'who', label: 'Who provides the platform' },
  { id: 'applies', label: 'Who these terms apply to' },
  { id: 'accounts', label: 'Accounts and credentials' },
  { id: 'clinical', label: 'Clinical responsibility' },
  { id: 'offline', label: 'Offline-first operation' },
  { id: 'patient-data', label: 'Patient information' },
  { id: 'residency', label: 'Where data lives' },
  { id: 'acceptable-use', label: 'Acceptable use' },
  { id: 'devices', label: 'Devices and security' },
  { id: 'third-party', label: 'Third-party services' },
  { id: 'ip', label: 'Intellectual property' },
  { id: 'suspension', label: 'Suspension and termination' },
  { id: 'liability', label: 'Disclaimers and liability' },
  { id: 'law', label: 'Governing law' },
  { id: 'changes', label: 'Changes to these terms' },
  { id: 'contact', label: 'Contact' },
];

export default function TermsPage() {
  return (
    <PublicLegalShell
      title="Terms & Conditions"
      // Not the platform's name again — the eyebrow above already says that.
      // This line is for the reader deciding whether the document is for them.
      subtitle="The rules for using the platform — for health workers, for patients, and for the organisations that run it."
      version={VERSION}
      effectiveDate={EFFECTIVE_DATE}
      toc={TOC}
    >
      <p>
        This document sets out the rules for using TamamHealth, an offline-first digital
        health records platform used by hospitals, clinics and health posts to register
        patients, record care, dispense medicines, and report to health authorities.
      </p>
      <p>
        <strong>You do not need an account to read it.</strong> It is published openly so
        that patients, health workers, facility managers, regulators and anyone deciding
        whether to adopt the platform can read the full text before, during, or entirely
        apart from using the system. It is a reference document, not a step in signing in.
      </p>

      <h2 id="about">1. About this document</h2>
      <p>
        These Terms describe what the platform is, what it may be used for, what each party
        is responsible for, and what it does not promise. They apply alongside the{' '}
        <a href="/privacy">Privacy Policy</a>, which describes how personal and health
        information is handled.
      </p>
      <p>
        Your facility or ministry may hold additional policies — on records management,
        clinical governance, or professional conduct. Where those are stricter than this
        document, they prevail for the people they cover. Nothing here reduces a duty you
        already owe your patients, your employer, or your professional council.
      </p>

      <h2 id="who">2. Who provides the platform, and who runs your copy</h2>
      <p>
        TamamHealth is the software provider. The platform is designed to be run by the
        organisation that delivers the care — a ministry of health, a hospital group, an
        NGO, or a single facility — on its own infrastructure or on infrastructure operated
        on its behalf. That organisation is referred to here as the <strong>operator</strong>.
      </p>
      <ul>
        <li>
          The operator decides who gets an account, what each role may see, how long records
          are kept, and to whom data is disclosed. In data-protection terms, the operator is
          the controller of the patient information in its deployment.
        </li>
        <li>
          TamamHealth supplies and maintains the software, and — only where the operator has
          asked it to host or support the deployment — processes data on the operator&rsquo;s
          documented instructions.
        </li>
        <li>
          The platform can be self-hosted in full. It has no licence server, activation call,
          or mandatory external service, and it must keep working when disconnected from the
          internet and from us.
        </li>
      </ul>

      <h2 id="applies">3. Who these terms apply to</h2>
      <ul>
        <li>
          <strong>Health workers and administrators</strong> given an account by their
          facility or organisation.
        </li>
        <li>
          <strong>Patients and their carers</strong> using the patient portal, online
          booking, or a link sent to them for a visit, a result, or a payment.
        </li>
        <li>
          <strong>Operators</strong> deploying and running the platform.
        </li>
      </ul>
      <p>
        Where a section applies to only one of these groups, it says so.
      </p>

      <h2 id="accounts">4. Accounts and credentials</h2>
      <p>
        Staff accounts are issued by a facility or organisation administrator; they cannot be
        self-registered, and requests for one are reviewed by a person. You are responsible
        for everything done under your account.
      </p>
      <ul>
        <li>Keep your password to yourself. Do not share a login, and do not sign in on
          behalf of a colleague — an entry made under your account is attributed to you in
          the record and in the audit log.</li>
        <li>Tell your administrator immediately if you believe your credentials, or a device
          holding an open session, have been lost or compromised.</li>
        <li>Accounts are personal to a role at a facility. When you change role, facility or
          employer, your access must be updated or withdrawn.</li>
      </ul>

      <h2 id="clinical">5. Clinical responsibility</h2>
      <p>
        <strong>The platform records and organises clinical information. It does not practise
        medicine.</strong> Every clinical decision — diagnosis, prescription, dose,
        referral, discharge — remains the responsibility of the treating clinician, exercised
        under their own licence and judgement.
      </p>
      <ul>
        <li>
          Alerts and checks in the system, including allergy and interaction warnings, dosing
          aids, coding suggestions and any AI-assisted feature, are <strong>advisory</strong>.
          They can be overridden, they may be incomplete, and they are not a substitute for
          professional judgement or for examining the patient.
        </li>
        <li>
          The platform is not certified as a medical device, and must not be relied on as the
          sole safeguard in an emergency or other time-critical situation.
        </li>
        <li>
          Information is only as good as what was entered. Verify anything that will change
          management — allergies, current medicines, weights and doses for children — with
          the patient or carer where you can.
        </li>
      </ul>

      <h2 id="offline">6. Offline-first operation and availability</h2>
      <p>
        The platform is built to work without connectivity: a clinician can register a
        patient, record a visit, prescribe and dispense with no signal, and the device
        synchronises when a connection returns. Two consequences follow, and both matter at
        the bedside.
      </p>
      <ul>
        <li>
          <strong>What you see may not be the newest version.</strong> Until a device has
          synchronised, care recorded elsewhere may not yet appear on it. Treat the record as
          a strong account of what is known locally, not a guarantee of everything that has
          happened.
        </li>
        <li>
          <strong>The same record may be edited in two places.</strong> The system reconciles
          this on sync and keeps both versions; where a conflict affects care, it is the
          facility&rsquo;s job to resolve it clinically.
        </li>
      </ul>
      <p>
        The software is provided on an &ldquo;as available&rdquo; basis. Operators must
        maintain fallback procedures — including paper — for power failures, lost devices,
        and events that take the system out of service, and must keep backups they have
        tested by restoring them.
      </p>

      <h2 id="patient-data">7. Patient information</h2>
      <p>
        Patient records are confidential. Access them only where you have a legitimate role
        in that patient&rsquo;s care, or a specific administrative or public-health duty that
        requires it, and only to the extent that duty requires.
      </p>
      <ul>
        <li>
          Looking up a record out of curiosity — a neighbour, a colleague, a public figure, a
          family member you are not treating — is a breach of these Terms and, in most
          professional codes, of a duty of confidence.
        </li>
        <li>
          Do not export, photograph, screenshot, print, forward, or copy patient information
          out of the system except where your role requires it and your organisation&rsquo;s
          policy permits it. A printed list left on a desk is a disclosure.
        </li>
        <li>
          Access and changes are recorded in an append-only audit log that users cannot edit
          or delete. Facilities and administrators may review it, and it may be used in
          disciplinary or legal proceedings.
        </li>
        <li>
          Records are scoped to an organisation and a facility. Do not attempt to reach data
          outside the scope your role was granted.
        </li>
      </ul>

      <h2 id="residency">8. Where data lives, and when it moves</h2>
      <p>
        Health data is among the most tightly regulated data there is, and the platform is
        built for that rather than around it. Patient data belongs to the country and the
        organisation it was collected in.
      </p>
      <ul>
        <li>
          Records are held on the device and synchronised to the operator&rsquo;s own node —
          intended to be hosted in-country or in-region. There is no single global database
          holding every deployment&rsquo;s patient data.
        </li>
        <li>
          Information crosses a border only where a specific function requires it and the
          operator has enabled it — for example an onward referral, or an outbreak signal —
          and subject to the law of the country the data came from.
        </li>
        <li>
          Reporting to health authorities is normally aggregated and de-identified.
          Identifiable data is disclosed only where the operator is required or permitted to
          do so by law.
        </li>
        <li>Patient data is never sold, and is not used to sell advertising.</li>
      </ul>

      <h2 id="acceptable-use">9. Acceptable use</h2>
      <p>You must not:</p>
      <ul>
        <li>attempt to bypass, disable or test access controls, authentication, tenancy
          boundaries or audit logging, except under a written authorisation from the operator
          for a security assessment;</li>
        <li>extract data in bulk, scrape the system, or connect unapproved tools to it;</li>
        <li>enter deliberately false clinical or identity information, or alter a record to
          misrepresent what happened — corrections are made as new, attributed entries, and
          the original remains visible;</li>
        <li>upload malware, or content unrelated to care, operations or public health;</li>
        <li>use patient data for research, publication, marketing or any secondary purpose
          without the approvals your jurisdiction and institution require;</li>
        <li>share, resell or sublicense access to the platform, or use another
          person&rsquo;s account.</li>
      </ul>

      <h2 id="devices">10. Devices and security</h2>
      <p>
        The platform stores data on the device so it can work offline, which makes the device
        part of the security perimeter. If you use one to reach patient records:
      </p>
      <ul>
        <li>lock it with a PIN, password or biometric, and do not leave a session open on a
          shared or public machine;</li>
        <li>sign out on a shared device when you finish, and use the platform&rsquo;s own
          sign-out rather than only closing the browser;</li>
        <li>report a lost or stolen device to your administrator at once, so its access can
          be revoked;</li>
        <li>do not install the platform on a device you do not control, and do not disable
          device encryption where your organisation requires it.</li>
      </ul>

      <h2 id="third-party">11. Third-party services</h2>
      <p>
        Some features can be connected to outside services — SMS reminders, payment
        providers, error monitoring, AI assistance. All of them are
        optional: the platform runs with none of them configured, and features that depend on
        one degrade rather than fail.
      </p>
      <p>
        Where the operator enables such a service, that provider&rsquo;s own terms and privacy
        practices also apply to what passes through it. Operators are responsible for
        choosing providers appropriate to the sensitivity of health data and for the
        agreements that govern them.
      </p>

      <h2 id="ip">12. Intellectual property</h2>
      <p>
        The platform&rsquo;s software, design and documentation remain the property of
        TamamHealth and its licensors, subject to the licence under which your organisation
        received it. <strong>The clinical and operational records created in the system belong
        to the operator and the patients they describe, not to us.</strong> An operator can
        take its data with it: records are held in open, documented formats and can be
        exported.
      </p>

      <h2 id="suspension">13. Suspension and termination of access</h2>
      <p>
        An administrator may suspend or withdraw an account at any time — most often when
        someone changes role or leaves. Access may be suspended immediately where there is a
        credible risk to patient data or to the integrity of the system, and the reason
        explained afterwards.
      </p>
      <p>
        Losing access does not delete the records you created: clinical records are retained
        by the operator under its own retention rules and the law that applies to it.
      </p>

      <h2 id="liability">14. Disclaimers and limitation of liability</h2>
      <p>
        The platform is provided without warranty that it will be uninterrupted, error-free,
        or fit for a particular clinical purpose beyond what is documented. To the fullest
        extent permitted by the applicable law, TamamHealth is not liable for clinical
        decisions taken by users, for loss arising from a facility&rsquo;s failure to maintain
        fallback procedures or tested backups, or for indirect or consequential loss.
      </p>
      <p>
        Nothing in this section excludes liability that cannot lawfully be excluded, and
        nothing in it displaces an operator&rsquo;s own duties to its patients. Where
        TamamHealth hosts or supports a deployment, the agreement signed with that operator
        governs, and prevails over this section if the two differ.
      </p>

      <h2 id="law">15. Governing law and legal context</h2>
      <p>
        For deployments in South Sudan, these Terms are governed by the laws of the Republic
        of South Sudan. For deployments elsewhere, the law of the country in which the
        operator delivers care governs, together with that country&rsquo;s data-protection
        regime — for example Kenya&rsquo;s Data Protection Act 2019, Nigeria&rsquo;s Data
        Protection Act 2023, or South Africa&rsquo;s POPIA.
      </p>
      <p>
        As at the effective date of this version, the South Sudanese framework relevant to
        this platform is, in summary:
      </p>
      <ul>
        <li>
          the <strong>Transitional Constitution of the Republic of South Sudan, 2011</strong>{' '}
          (as amended), article 22, under which privacy is inviolable and no person may be
          subjected to interference with their private life, family, home or correspondence
          save in accordance with the law; and article 32, which grants a right of access to
          information held by public bodies except where disclosure would compromise a
          person&rsquo;s privacy;
        </li>
        <li>
          the <strong>Right of Access to Information Act, 2013</strong>, which governs
          disclosure by public bodies and exempts information whose release would harm
          protected interests, including personal privacy;
        </li>
        <li>
          the <strong>Cybercrime and Abuse of Computer Bill, 2025</strong>, passed by the
          National Legislative Assembly and, at the time of writing, awaiting presidential
          assent;
        </li>
        <li>
          a first national <strong>Data Protection Bill</strong>, announced by the Ministry
          of Information, Communication Technology and Postal Services for 2026 and to be
          drafted jointly with the Ministry of Justice. South Sudan has no comprehensive
          data-protection statute in force as at this version&rsquo;s effective date.
        </li>
      </ul>
      <p>
        Because that framework is incomplete and changing, the platform is built to the
        stricter standard rather than the minimum one: role-scoped access, an append-only
        audit trail, in-country data residency by default, and no identifiers in logs or
        error reports. This summary is provided for orientation. It is not legal advice, and
        operators should take their own advice on the obligations that bind them.
      </p>

      <h2 id="changes">16. Changes to these terms</h2>
      <p>
        These Terms carry a version number and an effective date, both shown at the top of
        this document. When the substance changes, the version is raised and the date moved.
        Material changes affecting staff users are communicated to operators, who are
        responsible for telling their people. Continuing to use the platform after a new
        version takes effect means the current version applies to that use.
      </p>

      <h2 id="contact">17. Contact</h2>
      <p>
        For questions about your account, your access, or a patient&rsquo;s record, contact
        your facility or organisation administrator first — they hold the records and can act
        on them. For questions about the platform itself, or to report a security concern,
        contact <a href="mailto:support.tamam@gmail.com">support.tamam@gmail.com</a>.
      </p>
      <p>
        If you believe patient information has been exposed, report it to your administrator
        immediately and to us at the address above. Do not wait to be certain.
      </p>

      <p className="lg-note">
        <strong>Version {VERSION} · effective {EFFECTIVE_DATE}.</strong> This document
        describes the platform as supplied. The organisation operating your deployment — for
        example a ministry of health or a hospital group — maintains its own binding policies
        for the people and facilities it covers; where those are stricter, they apply. Ask
        your administrator for the version that governs your facility.
      </p>
    </PublicLegalShell>
  );
}

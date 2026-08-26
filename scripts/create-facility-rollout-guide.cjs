const fs = require('fs');
const path = require('path');
const {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} = require('docx');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'TamamHealth-Multi-Facility-Installation-and-Offline-Rollout-Guide.docx');
const LOGO = path.join(ROOT, 'platform', 'public', 'assets', 'logos', 'PNG', 'Tamam_Style_Guide-22.png');

const C = {
  navy: '113055', blue: '2191D0', orange: 'FF7F00', cyan: 'EAF8FD',
  pale: 'F5F8FA', gray: '5E6B75', line: 'B8CBD5', white: 'FFFFFF',
  green: 'E7F5EA', amber: 'FFF4D6', red: 'FDE9E7', darkGreen: '246B3A',
  darkAmber: '8A5A00', darkRed: 'A1271B', code: 'F1F3F5',
};

const TABLE_WIDTH = 9360;
const thin = { style: BorderStyle.SINGLE, size: 5, color: C.line };
const borders = { top: thin, bottom: thin, left: thin, right: thin, insideHorizontal: thin, insideVertical: thin };

function txt(text, opts = {}) {
  return new TextRun({ text, font: opts.font || 'Arial', size: opts.size || 20, color: opts.color || C.navy,
    bold: opts.bold, italics: opts.italics, break: opts.break });
}

function p(text, opts = {}) {
  const children = Array.isArray(text) ? text : [txt(text, opts)];
  return new Paragraph({
    children, alignment: opts.align, spacing: { after: opts.after ?? 120, before: opts.before ?? 0, line: opts.line || 276 },
    keepNext: opts.keepNext, pageBreakBefore: opts.pageBreakBefore,
  });
}

function h(text, level = 1) {
  const heading = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][level - 1];
  return new Paragraph({ text, heading, spacing: { before: level === 1 ? 280 : 180, after: 100 }, keepNext: true });
}

function bullet(text, level = 0) {
  return new Paragraph({ text, numbering: { reference: 'bullets', level }, spacing: { after: 70, line: 260 } });
}

function step(text, reference = 'steps') {
  return new Paragraph({ text, numbering: { reference, level: 0 }, spacing: { after: 90, line: 270 } });
}

function cell(content, width, opts = {}) {
  const paragraphs = Array.isArray(content) ? content : [p(content, { after: 20 })];
  return new TableCell({
    children: paragraphs, width: { size: width, type: WidthType.DXA }, verticalAlign: opts.verticalAlign || VerticalAlign.CENTER,
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 90, bottom: 90, left: 110, right: 110 },
  });
}

function table(headers, rows, widths, opts = {}) {
  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA }, columnWidths: widths, borders,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((x, i) => cell([p([txt(x, { bold: true, color: C.white })], { after: 0 })], widths[i], { fill: opts.headerFill || C.navy })) }),
      ...rows.map((row, ri) => new TableRow({ cantSplit: true, children: row.map((x, i) => cell(
        Array.isArray(x) ? x : String(x), widths[i], { fill: opts.rowFills ? opts.rowFills[ri] : (ri % 2 ? C.pale : C.white) }
      )) })),
    ],
  });
}

function callout(title, body, tone = 'blue') {
  const fill = tone === 'green' ? C.green : tone === 'amber' ? C.amber : tone === 'red' ? C.red : C.cyan;
  const color = tone === 'green' ? C.darkGreen : tone === 'amber' ? C.darkAmber : tone === 'red' ? C.darkRed : C.navy;
  return new Table({ width: { size: TABLE_WIDTH, type: WidthType.DXA }, columnWidths: [TABLE_WIDTH], borders,
    rows: [new TableRow({ children: [cell([
      p([txt(title, { bold: true, color })], { after: 55 }),
      p([txt(body, { color })], { after: 0 }),
    ], TABLE_WIDTH, { fill })] })] });
}

function code(lines) {
  return new Table({ width: { size: TABLE_WIDTH, type: WidthType.DXA }, columnWidths: [TABLE_WIDTH], borders,
    rows: [new TableRow({ children: [cell([new Paragraph({
      children: String(lines).split('\n').flatMap((line, i) => [txt(line, { font: 'Courier New', size: 17, color: '263238' }), ...(i < String(lines).split('\n').length - 1 ? [new TextRun({ break: 1 })] : [])]),
      spacing: { after: 0, line: 235 },
    })], TABLE_WIDTH, { fill: C.code })] })] });
}

function pageBreak() { return new Paragraph({ children: [new PageBreak()] }); }

const logo = fs.readFileSync(LOGO);
const header = new Header({ children: [new Paragraph({
  children: [new ImageRun({ data: logo, transformation: { width: 155, height: 38 }, type: 'png' })],
  border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: C.blue } }, spacing: { after: 60 },
})] });
const footer = new Footer({ children: [new Paragraph({
  children: [txt('TamamHealth | Controlled facility deployment guide', { size: 16, color: C.gray }), txt('    '), txt('Page ', { size: 16, color: C.gray }), new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 16, color: C.gray })],
  alignment: AlignmentType.RIGHT, border: { top: { style: BorderStyle.SINGLE, size: 5, color: C.line } }, spacing: { before: 60 },
})] });

const b = [];
b.push(new Paragraph({ spacing: { before: 1050, after: 460 }, alignment: AlignmentType.CENTER,
  children: [new ImageRun({ data: logo, transformation: { width: 360, height: 88 }, type: 'png' })] }));
b.push(p([txt('MULTI-FACILITY INSTALLATION', { bold: true, size: 42, color: C.navy }), txt(' & OFFLINE ROLLOUT GUIDE', { bold: true, size: 42, color: C.blue, break: 1 })], { align: AlignmentType.CENTER, after: 280, line: 480 }));
b.push(p('Facility-edge deployment without source-code distribution', { align: AlignmentType.CENTER, size: 25, color: C.gray, after: 520 }));
b.push(callout('AUDITED DEPLOYMENT GUIDE', 'Approved for controlled per-facility LAN pilots, subject to the go/no-go controls in this document. Automatic country-node federation is not yet production-ready.', 'green'));
b.push(p('Version 1.0  |  26 August 2026', { align: AlignmentType.CENTER, bold: true, before: 500, after: 80 }));
b.push(p('Classification: TamamHealth Confidential — authorized operators and licensed facilities only', { align: AlignmentType.CENTER, color: C.darkRed, size: 18 }));
b.push(pageBreak());

b.push(h('Document control', 1));
b.push(table(['Field', 'Value'], [
  ['Document owner', 'TamamHealth Health Technologies'],
  ['Audience', 'Implementation leads, facility IT officers, security administrators, clinical champions and support teams'],
  ['Deployment profile', 'Facility-edge: same-site HTTPS application, authenticated CouchDB gateway and browser offline storage'],
  ['Audit basis', 'Repository configuration, offline architecture, security boundaries, backup scripts and verification results current at 26 August 2026'],
  ['Distribution', 'Controlled copy. Do not place in a public repository or unrestricted file share.'],
  ['Review cadence', 'Before every major release and at least annually'],
], [2500, 6860]));
b.push(h('How to use this guide', 2));
b.push(p('Use Sections 1–5 to approve the deployment pattern. Use Sections 6–13 for installation and commissioning. Use Sections 14–18 to operate, recover and expand the fleet. A facility must not enter live patient data until every go/no-go item has evidence and an accountable owner.'));
b.push(h('Contents', 1));
b.push(table(['Sections 1–6', 'Sections 7–13', 'Sections 14–18 and appendices'], [[
  '1. Executive decision\n2. Audit findings\n3. Supported deployment patterns\n4. Source-code and IP protection\n5. Prerequisites and sizing\n6. Site configuration plan',
  '7. Pre-install go/no-go\n8. Prepare the edge host\n9. Obtain the controlled release\n10. Configure the facility\n11. Establish trusted HTTPS\n12. First-run provisioning\n13. Offline commissioning test',
  '14. How offline operation works\n15. Backup and continuity\n16. Operations and upgrades\n17. Multi-facility model\n18. Incident quick guide\nAppendices A–D',
]], [3120, 3120, 3120]));
b.push(pageBreak());

b.push(h('1. Executive decision', 1));
b.push(p('TamamHealth can operate without external internet at a facility when the application server, CouchDB and HTTPS gateway are installed on that facility’s local network and devices have prepared their offline packs. Staff use the same trusted local URL whether the WAN is available or unavailable. Records continue to be written locally and shared through the facility node over the LAN.'));
b.push(callout('Deployment verdict', 'Proceed with a controlled pilot using one facility edge per remote site. Do not deliver the Git repository to facilities. Build signed, versioned images centrally; publish them to a private registry; and give each site only the deployment bundle, exact image digests and site-specific secrets.', 'green'));
b.push(h('1.1 What this achieves', 2));
[
  'The web application shell and approved patient/workflow routes remain available after external internet loss.',
  'Authenticated users can continue work on enrolled devices using time-limited offline sessions.',
  'Multiple devices in the same facility can share data through the LAN-hosted edge node while the WAN is down.',
  'Tenant databases are selected and authorized by the same-origin gateway; CouchDB is not exposed directly to browsers.',
  'Nightly local CouchDB backups are created and verified, with fourteen-day local retention.',
].forEach(x => b.push(bullet(x)));
b.push(h('1.2 What this does not achieve yet', 2));
[
  'Independent facility nodes do not automatically converge into a national dataset. The repository contains a facility outbox, but the country-node receiver is not runnable.',
  'Application configuration cannot turn on full-disk encryption, install certificate trust or provide a UPS; operators must implement and attest these controls.',
  'A container image conceals normal source distribution, but a party with root control of the server can inspect or copy image layers and JavaScript bundles. Contracts, access control, signed releases and operational custody remain necessary.',
].forEach(x => b.push(bullet(x)));

b.push(h('2. Audit findings', 1));
b.push(table(['Status', 'Finding', 'Required action'], [
  ['GREEN', 'Facility-edge compose profile, HTTPS gateway, tenant-aware CouchDB gateway, offline preparation and live Settings capability checks exist.', 'Commission using the acceptance test in Section 13.'],
  ['GREEN', 'Production configuration fails closed when required facility-edge boundary settings or strong secrets are missing.', 'Run validation before every start and after configuration change.'],
  ['GREEN', 'Local backups enumerate TamamHealth databases, dump data and verify counts/checkpoints.', 'Monitor the backup log and preserve verified copies off-host.'],
  ['AMBER', 'Disk encryption is an operator attestation; the application cannot prove the host and device disks are encrypted.', 'Capture OS-level evidence before go-live.'],
  ['AMBER', 'Caddy uses a private certificate authority. Every managed device must trust that root certificate.', 'Install the root through device management and verify the browser lock icon.'],
  ['AMBER', 'The current facility instructions build from source.', 'Replace with a controlled binary-image distribution workflow; never clone the repository on facility servers.'],
  ['AMBER', 'The proprietary LICENSE states that a license key is required, but application-level license-key enforcement was not found in the audited runtime code.', 'Treat license enforcement as a separate product hardening item; do not claim it is active.'],
  ['RED', 'The country-node directory is a design stake only; no production receiver or deployable service exists.', 'Use an interim operating model or complete and validate federation before promising cross-site synchronization.'],
], [1100, 4200, 4060], { rowFills: [C.green, C.green, C.green, C.amber, C.amber, C.amber, C.amber, C.red] }));
b.push(h('2.1 Verified engineering evidence', 2));
b.push(p('At the close of the implementation audit: 210 test suites and 2,222 tests passed; TypeScript passed; the production build passed with 192 routes; localization parity passed with 6,541 keys in each locale; lint had zero errors and 369 pre-existing warnings; and the facility Docker Compose configuration resolved successfully. A browser login-shell check hydrated without console errors.'));
b.push(pageBreak());

b.push(h('3. Supported deployment patterns', 1));
b.push(table(['Pattern', 'WAN-down behavior', 'Cross-facility view', 'Use now?'], [
  ['Central in-country server plus device offline storage', 'An already prepared browser continues locally; devices cannot share through the central server when the WAN path is down.', 'Yes, while the central server is reachable.', 'Use where reliable national/in-country connectivity is available.'],
  ['One facility edge per site', 'Prepared devices continue locally and can share through the same facility LAN.', 'No automatic convergence between independent nodes today.', 'Recommended for remote facilities.'],
  ['Federated facility edges to country node', 'Local work continues and queues changes for upstream exchange.', 'Intended, but the receiver and production conflict/identity operations are incomplete.', 'Do not sell or deploy as production capability yet.'],
], [2400, 2550, 2450, 1960]));
b.push(h('3.1 Reference facility architecture', 2));
b.push(table(['Zone', 'Components', 'Boundary'], [
  ['Managed clinical devices', 'Browser, service worker, encrypted local device storage, prepared offline pack', 'Users authenticate; device is enrolled and physically controlled.'],
  ['Facility LAN edge', 'Caddy HTTPS gateway → TamamHealth platform → same-origin /api/couch gateway → tenant CouchDB', 'Only ports 80/443 face the LAN. CouchDB port 5984 binds to host loopback.'],
  ['Recovery', 'Verified nightly CouchDB backup volume plus encrypted off-host copy', 'Backup credentials and media are restricted and tested.'],
  ['Upstream', 'Optional future exchange to a country node', 'Not production-ready in the current repository.'],
], [2100, 4050, 3210]));

b.push(h('4. Source-code and intellectual-property protection', 1));
b.push(callout('Non-negotiable distribution rule', 'No facility, reseller or field technician receives Git credentials, a repository clone, a build context, source maps, CI secrets or a production signing secret. Installation uses immutable container images and a minimal site configuration bundle.', 'red'));
b.push(h('4.1 Controlled release channel', 2));
[
  'Build images only in TamamHealth-controlled CI from a reviewed release commit.',
  'Publish to a private registry under TamamHealth ownership. Grant a facility a read-only robot credential scoped only to its approved images.',
  'Deploy by immutable SHA-256 image digest, not “latest”, “production” or another mutable tag.',
  'Sign images and retain an SBOM, vulnerability report, test evidence and release approval for each digest.',
  'Provide a small bundle containing Compose YAML, Caddy configuration, backup utility, environment templates, checksums and this guide. These operational files must contain no application source.',
  'Keep JWT keys, license-signing secrets, CI tokens and registry write credentials out of the bundle. Generate facility runtime secrets separately.',
  'Disable shell access for normal facility users; restrict host administration to named TamamHealth or approved partner operators with MFA and audit logging.',
].forEach(x => b.push(bullet(x)));
b.push(h('4.2 Honest protection boundary', 2));
b.push(p('Client-side JavaScript must be sent to a user’s browser, and a root administrator can export container layers. Obfuscation may raise effort but does not create a security boundary and must not be the main control. The practical protection model combines limited distribution, private registry access, signed releases, contractual licensing, server custody, monitoring and rapid credential revocation. Patient data remains the facility’s property; the application code remains TamamHealth property.'));
b.push(h('4.3 Release artifact inventory', 2));
b.push(table(['Artifact', 'Facility receives?', 'Control'], [
  ['Application source/Git history', 'No', 'Remain in private TamamHealth repository.'],
  ['Platform container image', 'Pull access only', 'Private registry, digest pin, signature verification.'],
  ['CouchDB/Caddy base images', 'Yes through approved registry/cache', 'Pin vendor images by digest and scan.'],
  ['Deployment/config bundle', 'Yes', 'No source; checksum and version manifest.'],
  ['Runtime secrets', 'Site-specific only', 'Generated per facility, encrypted at rest, never emailed in plaintext.'],
  ['Signing/license authority secrets', 'No', 'TamamHealth-controlled secrets manager/HSM.'],
], [2950, 1850, 4560]));
b.push(pageBreak());

b.push(h('5. Facility prerequisites and sizing', 1));
b.push(table(['Profile', 'Suggested starting point', 'Use'], [
  ['Pilot/small clinic', '2 CPU, 8 GB RAM, 100 GB encrypted SSD', 'Limited users and attachments; measure before expansion.'],
  ['Standard hospital', '4 CPU, 16 GB RAM, 250 GB encrypted SSD', 'Typical facility pilot with concurrent departments.'],
  ['Large/referral facility', '8 CPU, 32 GB RAM, 500 GB+ encrypted SSD', 'Higher concurrency and attachments; load test and monitor.'],
], [2200, 3200, 3960]));
b.push(p('These are starting estimates, not guarantees. Imaging and scanned attachments dominate storage. Measure daily database growth, concurrent sessions, replication latency, backup duration and restore duration during the pilot.'));
b.push(h('5.1 Required local infrastructure', 2));
[
  'Reliable LAN router and access points, with a reserved static IP for the edge server.',
  'UPS sized for the edge server, router and access point; documented safe-shutdown procedure.',
  'Encrypted system/data disks and encrypted managed clinician devices.',
  'Local DNS entry for the approved facility hostname; avoid .local because multicast DNS can conflict.',
  'A tested method for installing the Caddy root CA on all managed device types.',
  'A second encrypted backup target or approved offsite transfer path.',
].forEach(x => b.push(bullet(x)));

b.push(h('6. Site identity and configuration plan', 1));
b.push(table(['Field', 'Example', 'Rule'], [
  ['Organization ID', 'org-ss-moh-001', 'Globally unique; never recycle.'],
  ['Facility ID', 'facility-juba-001', 'Globally unique across all nodes.'],
  ['Facility code', 'JTH', 'Stable patient-number prefix approved by operations.'],
  ['Hostname', 'tamamhealth.jth.example.org', 'Owned namespace, resolvable on facility LAN.'],
  ['Server IP', '10.40.10.20', 'Reserved address outside the DHCP pool.'],
  ['Release digest', 'sha256:<64 hexadecimal characters>', 'Copied from approved release manifest.'],
  ['Configuration owner', 'Named person/role', 'Two-person approval for secret-bearing changes.'],
], [2300, 2950, 4110]));
b.push(callout('Configuration is not a security device', 'The environment profile enforces application boundaries, but it cannot encrypt an operating-system disk, configure a router, establish physical custody or install a certificate on a clinician device. Those controls need separate evidence.', 'amber'));
b.push(pageBreak());

b.push(h('7. Pre-install go/no-go', 1));
[
  'The signed service agreement and proprietary software license cover this organization and site.',
  'TamamHealth approved the exact release digest and retained its build/test/SBOM evidence.',
  'The facility has not received and will not receive the source repository.',
  'Server, network equipment, administrator and maintenance owner are recorded.',
  'Host and clinician-device full-disk encryption are enabled and evidenced.',
  'Static IP, hostname and split/local DNS entry are tested from every clinical network segment.',
  'UPS runtime and safe shutdown have been tested.',
  'Backup destination, encryption, retention and restore-test owner are approved.',
  'Registry pull credentials are read-only, site-scoped and stored outside the Compose file.',
].forEach(x => b.push(bullet(x)));

b.push(h('8. Prepare the edge host', 1));
b.push(step('Install a supported, security-maintained Linux server release. Apply all security updates, set accurate time synchronization and restrict administrative SSH to the management network.', 'hostSteps'));
b.push(step('Enable full-disk encryption during operating-system installation. If adding a data disk later, verify the exact block device with two operators before formatting; a wrong device selection is destructive.', 'hostSteps'));
b.push(step('Create named administrator accounts, disable shared credentials, require SSH keys and MFA through the approved access path, and record all privileged access.', 'hostSteps'));
b.push(step('Install the approved Docker Engine and Compose plugin from the vendor-supported channel. Configure daemon log rotation and ensure Docker is not exposed over unauthenticated TCP.', 'hostSteps'));
b.push(step('Reserve the server IP and create the local DNS record. From two facility devices, confirm the hostname resolves to the LAN IP even when the WAN is disconnected.', 'hostSteps'));
b.push(step('Create a restricted installation directory, for example /opt/tamamhealth. Only the deployment administrator group may read secret-bearing files.', 'hostSteps'));

b.push(h('9. Obtain the controlled release', 1));
b.push(p('A TamamHealth release administrator produces a facility-specific release manifest and bundle. Because public browser settings are compiled into the current image, the approved image must be built with the facility URL/profile or the platform must first be changed to a runtime-injected public configuration model. Do not reuse an image baked for another hostname.'));
b.push(h('9.1 Authenticate and pull', 2));
b.push(code(`docker login registry.example.org --username <site-readonly-robot>
docker compose --env-file .env.facility-edge -f compose.facility.yml pull
docker image inspect <platform-image>@sha256:<approved-digest>`));
b.push(p('Compare the local digest with the signed release manifest. If signature or digest verification fails, stop and contact TamamHealth. Never substitute a mutable tag.'));
b.push(h('9.2 Bundle contents', 2));
b.push(code(`compose.facility.yml
Caddyfile
dump-couchdb.sh
.env.facility-edge.example
platform.env.production.example
release-manifest.json
release-manifest.sig
checksums.sha256
TamamHealth-Multi-Facility-Installation-and-Offline-Rollout-Guide.docx`));

b.push(h('10. Configure the facility', 1));
b.push(h('10.1 Facility deployment variables', 2));
b.push(code(`FACILITY_HOSTNAME=tamamhealth.<facility>.example.org
FACILITY_APP_URL=https://tamamhealth.<facility>.example.org
FACILITY_PLATFORM_IMAGE=registry.example.org/tamam/platform@sha256:<digest>
COUCHDB_USER=<site-specific-admin>
COUCHDB_PASSWORD=<long-random-secret>
COUCHDB_GATEWAY_SECRET=<at-least-32-random-characters>
COUCHDB_WEBHOOK_SECRET=<at-least-32-random-characters>
NEXT_PUBLIC_OFFLINE_PATIENT_ROUTE_LIMIT=500
PHI_AT_REST_STRATEGY=disk-encryption
PHI_ENCRYPTION_ENABLED=false`));
b.push(h('10.2 Platform runtime secrets', 2));
b.push(code(`NODE_ENV=production
NEXT_PUBLIC_DEMO_MODE=false
NEXT_PUBLIC_SYNC_ENABLED=true
NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED=true
NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED=true
NEXT_PUBLIC_COUCHDB_URL=https://tamamhealth.<facility>.example.org/api/couch
NEXT_PUBLIC_APP_URL=https://tamamhealth.<facility>.example.org
NEXT_PUBLIC_OFFLINE_DEPLOYMENT_MODE=facility-edge
JWT_SECRET=<48-byte-random-secret>
SUPERADMIN_INITIAL_PASSWORD=<unique-minimum-16-character-password>
SINGLE_REPLICA_ACK=true`));
b.push(callout('Secret rules', 'Generate all secrets independently per facility. Never reuse CouchDB, JWT, gateway, webhook, bootstrap or registry credentials. Do not commit environment files, place them in support tickets or transmit them through ordinary email.', 'red'));
b.push(h('10.3 Validate before starting', 2));
b.push(code(`docker compose --env-file .env.facility-edge -f compose.facility.yml config
chmod 600 .env.facility-edge platform.env.production
docker compose --env-file .env.facility-edge -f compose.facility.yml up -d
docker compose --env-file .env.facility-edge -f compose.facility.yml ps
docker compose --env-file .env.facility-edge -f compose.facility.yml logs --tail=200 platform`));
b.push(p('A production boot refusal is a safety control. Correct the reported configuration; do not weaken validation or change the deployment mode to bypass it.'));
b.push(pageBreak());

b.push(h('11. Establish trusted HTTPS', 1));
b.push(p('The service worker and secure offline behavior require HTTPS. The facility Caddy gateway uses an internal certificate authority. Export its root certificate through the documented Caddy data volume procedure, verify its fingerprint out-of-band, and install it in the trusted root store of every managed device.'));
b.push(h('11.1 Verification on each device', 2));
[
  'Open the exact FACILITY_APP_URL, not an IP address or alternate alias.',
  'Confirm the browser shows a valid secure connection with the expected hostname.',
  'Confirm the issuing root fingerprint matches the commissioned facility certificate record.',
  'Open the application once, sign in and verify the service worker/offline readiness status in Settings.',
  'Reject click-through certificate warnings. A warning means the trust setup is incomplete.',
].forEach(x => b.push(bullet(x)));

b.push(h('12. First-run provisioning and device enrollment', 1));
b.push(step('Sign in with the one-time superadministrator credential on a trusted administrator device. Rotate it immediately and store recovery material in the approved vault.', 'firstRun'));
b.push(step('Create or verify the organization and facility. Confirm identifiers, facility code, country, timezone and clinical ownership before creating users.', 'firstRun'));
b.push(step('Create least-privilege facility administrators, clinicians, pharmacists, laboratory staff and records users. Disable accounts not required for the pilot.', 'firstRun'));
b.push(step('Open Settings → Data Management on each managed device. Select Prepare offline pack, permit persistent storage, and wait for all readiness checks to pass.', 'firstRun'));
b.push(step('Record device owner, asset identifier, browser/OS version, certificate fingerprint, offline-pack build ID and enrollment date.', 'firstRun'));
b.push(step('Lock down devices: disk encryption, screen lock, automatic updates, no shared OS account, no unapproved browser extensions and remote-loss procedure.', 'firstRun'));
b.push(h('12.1 New installations versus migrations', 2));
b.push(p('A new tenant database is provisioned through the authenticated gateway when the organization relationship is established. A migration from an existing shared database is a separate controlled activity: run a dry run, back up both source and target, review counts/conflicts, perform the migration in a maintenance window and preserve rollback evidence. Never treat a migration command as part of ordinary first-run setup.'));

b.push(h('13. Offline commissioning test', 1));
b.push(callout('Test the failure that matters', 'Disconnect the external WAN while keeping the facility router, access point and edge server powered. Turning off Wi-Fi tests device isolation, not facility offline operation.', 'blue'));
b.push(table(['Test', 'Expected evidence', 'Pass/owner'], [
  ['Normal online/LAN baseline', 'Two enrolled devices sign in; health/readiness checks are green; both see the same approved test patient.', ''],
  ['WAN removed, LAN retained', 'The facility URL still opens with valid HTTPS; no external dependency blocks the core workflow.', ''],
  ['Registration on Device A', 'Create an approved synthetic patient; operation succeeds without WAN.', ''],
  ['Cross-device visibility', 'Device B receives/sees the synthetic record through the facility edge.', ''],
  ['Clinical workflow', 'Complete triage, consultation, laboratory, pharmacy and transfer steps appropriate to the facility.', ''],
  ['Browser refresh/restart', 'Prepared pages reopen; time-limited offline session behavior matches policy.', ''],
  ['WAN restored', 'No duplicate data; pending upstream work remains visible/controlled. Do not expect national synchronization.', ''],
  ['Backup', 'Manual/next scheduled backup verifies database counts and checkpoint files.', ''],
], [2450, 5250, 1660]));
b.push(h('13.1 Go-live acceptance', 2));
b.push(p('The clinical lead, facility administrator, security owner and TamamHealth implementation lead sign the commissioning record. Any failed certificate, backup, tenant-boundary, login, data-sharing or recovery test is a no-go.'));
b.push(pageBreak());

b.push(h('14. How offline operation works', 1));
b.push(table(['Event', 'System behavior', 'Operator action'], [
  ['External internet fails', 'Local DNS, HTTPS gateway, application, CouchDB and prepared browser storage remain on the LAN.', 'Continue approved workflows; record outage time.'],
  ['A device briefly loses LAN', 'Prepared application/data remain on that device; writes queue locally where supported.', 'Restore LAN; verify queued work replicates before switching devices.'],
  ['Facility edge is unavailable', 'Prepared devices may retain local capability, but multi-device sharing and fresh sign-in can be limited.', 'Follow edge outage runbook; do not create parallel untracked records.'],
  ['WAN returns', 'Facility operation continues. Current code does not provide a runnable country receiver for automatic national convergence.', 'Use the approved interim reporting/export process.'],
], [2400, 4200, 2760]));
b.push(h('14.1 Offline session boundary', 2));
b.push(p('Offline access is not anonymous access. A user must have authenticated successfully on the device, the cached session must still be valid, the route must be in the prepared pack, and the device must meet local custody rules. Log out before transferring a device. Lost devices are treated as security incidents even when disk encryption is enabled.'));

b.push(h('15. Backup, restore and continuity', 1));
b.push(p('The included backup job runs nightly at 02:15 UTC, dumps every TamamHealth tenant database plus required CouchDB system databases, verifies row counts/checkpoints and retains fourteen days locally. This is only the first recovery copy.'));
b.push(h('15.1 Required three-copy practice', 2));
[
  'Primary encrypted CouchDB data on the facility edge.',
  'Verified encrypted local backup on separate storage/media.',
  'Encrypted off-host or offsite copy with access independent of the edge server.',
].forEach(x => b.push(bullet(x)));
b.push(h('15.2 Restore drill', 2));
b.push(step('Select a recent verified backup and record its checksum, release ID and database inventory.', 'restore'));
b.push(step('Restore into an isolated test node running the matching approved release; never overwrite the live database during a drill.', 'restore'));
b.push(step('Verify organization/facility boundaries, users, patient counts, attachments, recent clinical records and design documents.', 'restore'));
b.push(step('Run an application smoke test and measure recovery time and data-loss window.', 'restore'));
b.push(step('Destroy the temporary restored data securely after evidence is approved.', 'restore'));
b.push(p('Run a restore drill before go-live, after material storage/schema changes and at least quarterly. A backup that has never been restored is not accepted recovery evidence.'));

b.push(h('16. Operations, maintenance and upgrades', 1));
b.push(table(['Cadence', 'Control'], [
  ['Daily', 'Health status, free disk, backup success, UPS/network alarms and failed authentication review.'],
  ['Weekly', 'Encrypted off-host backup confirmation, certificate/device exceptions, registry credential review and unresolved sync queue review.'],
  ['Monthly', 'OS/container security updates, fleet inventory, database growth, account/role review and incident trend.'],
  ['Quarterly', 'Restore drill, WAN-outage exercise, privileged-access review and certificate-expiry forecast.'],
  ['Per release', 'Approve digest, verify signature/SBOM/tests, back up, deploy in maintenance window, re-prepare device packs and execute smoke tests.'],
], [1800, 7560]));
b.push(h('16.1 Upgrade and rollback', 2));
[
  'Never run an unreviewed or mutable image tag.',
  'Take and verify a backup immediately before upgrade.',
  'Preserve the previous image digest and configuration bundle.',
  'Upgrade one pilot facility first and observe through the agreed soak period.',
  'Rollback on tenant-boundary failure, data corruption, failed core workflow, certificate failure, sustained health failure or unacceptable replication lag.',
  'A rollback does not automatically reverse a database migration. Use the release-specific migration/restore plan.',
].forEach(x => b.push(bullet(x)));
b.push(pageBreak());

b.push(h('17. Multi-facility operating model', 1));
b.push(p('Each facility is an independently commissioned security and data boundary. It receives a unique hostname, globally unique identifiers, unique secrets, scoped registry credential, release record, backup evidence and named operational owners. Never copy a live environment file from one facility to another.'));
b.push(h('17.1 Interim national data choices', 2));
b.push(table(['Need', 'Interim choice', 'Trade-off'], [
  ['Central cross-facility access now', 'Use one controlled in-country central server and browser offline packs.', 'Facilities lose LAN-based multi-device sharing when their WAN path to the central server is unavailable.'],
  ['Strong site resilience now', 'Use independent facility edges.', 'Cross-site aggregation requires an approved export/reporting process until federation is complete.'],
  ['Both site resilience and automatic national convergence', 'Complete the country-node receiver, identity/conflict governance, security review, operations and failure testing.', 'Not available as an audited production capability today.'],
], [2500, 3580, 3280]));
b.push(h('17.2 Federation release gates', 2));
[
  'Runnable, authenticated country-node receiver with tenant/facility authorization.',
  'Globally unique identity strategy and documented duplicate/conflict policy.',
  'End-to-end encryption, key rotation, replay protection, rate limits and audit records.',
  'Backpressure, retry/dead-letter behavior, observability and support runbooks.',
  'Bidirectional delete/correction policy and patient-safety review.',
  'Prolonged partition, clock-skew, duplicate and disaster-recovery tests.',
].forEach(x => b.push(bullet(x)));

b.push(h('18. Incident quick guide', 1));
b.push(table(['Incident', 'Immediate response'], [
  ['WAN outage', 'Keep LAN services powered; confirm local DNS and HTTPS; continue approved workflows; do not promise upstream synchronization.'],
  ['LAN outage', 'Restore router/AP/switch power and addressing. Keep staff on their enrolled device until replication is verified.'],
  ['Edge server down', 'Check UPS, storage and container health. Escalate before rebuilding; preserve disks and logs.'],
  ['Certificate warning', 'Stop use on that device. Verify hostname, time and root fingerprint; reinstall trust through the approved process.'],
  ['Lost/stolen device', 'Report security incident, disable user/session where reachable, use device management remote action and assess cached PHI exposure.'],
  ['Disk nearly full', 'Stop nonessential attachment ingestion, preserve backups, expand approved encrypted storage; never delete CouchDB files manually.'],
  ['Suspected source/image theft', 'Revoke registry credentials, preserve audit logs, identify pulled digests, rotate affected secrets and invoke legal/security response.'],
], [2500, 6860]));

b.push(h('Appendix A. Configuration boundary reference', 1));
b.push(table(['Boundary', 'Required setting/control', 'Failure mode'], [
  ['Deployment mode', 'NEXT_PUBLIC_OFFLINE_DEPLOYMENT_MODE=facility-edge', 'Wrong readiness policy and device behavior.'],
  ['Same-origin gateway', 'NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED=true and /api/couch URL', 'Direct database exposure or failed replication.'],
  ['Tenant databases', 'NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED=true', 'Shared-database boundary incompatible with facility profile.'],
  ['Relationship authorization', 'OFFLINE_GATEWAY_RELATIONSHIP_AUTHORIZATION=true', 'Gateway authorization does not meet audited profile.'],
  ['Host/device encryption', 'PHI_AT_REST_STRATEGY=disk-encryption plus real OS control', 'Boot refusal or plaintext storage exposure.'],
  ['Persistent browser storage', 'NEXT_PUBLIC_OFFLINE_REQUIRE_PERSISTENT_STORAGE=true', 'Browser may evict prepared offline content.'],
  ['Patient route limit', 'Explicitly approved numeric limit', 'Excessive local PHI footprint or insufficient pack.'],
  ['Secrets', 'Unique strong JWT/CouchDB/gateway/webhook/bootstrap values', 'Boot refusal, forgery or cross-site compromise.'],
  ['Release', 'Private image pinned by digest and verified', 'Uncontrolled code, mutable deployment or source disclosure.'],
], [2300, 4000, 3060]));

b.push(h('Appendix B. Facility commissioning record', 1));
b.push(table(['Record', 'Value/evidence'], [
  ['Organization and facility IDs', ''], ['Hostname and LAN IP', ''], ['Server asset/serial and disk-encryption evidence', ''],
  ['Release version, platform digest and signature result', ''], ['Registry credential scope/expiry', ''],
  ['Caddy root fingerprint and enrolled-device count', ''], ['Backup checksum and restore-drill result', ''],
  ['WAN-offline test date and evidence location', ''], ['Clinical lead approval/name/date', ''], ['Security owner approval/name/date', ''],
  ['TamamHealth implementation approval/name/date', ''],
], [4100, 5260]));

b.push(h('Appendix C. Audited repository evidence', 1));
b.push(table(['Evidence', 'Purpose'], [
  ['docker-compose.facility-edge.yml', 'Facility LAN gateway and offline boundary override.'],
  ['facility-edge.env.example', 'Facility identity, gateway secrets and disk-encryption attestation template.'],
  ['Caddyfile.facility-edge', 'Trusted HTTPS reverse proxy on the facility LAN.'],
  ['platform/src/lib/offline-deployment-config.ts', 'Centralized deployment-mode boundary validation.'],
  ['platform/src/app/api/system/offline-capabilities/route.ts', 'Live server-side readiness/capability reporting to Settings.'],
  ['platform/docs/adr/0004-facility-edge-offline-profile.md', 'Architecture decision and limitations.'],
  ['scripts/dump-couchdb.sh', 'Verified local CouchDB backup and retention.'],
  ['country-node/README.md', 'Explicit evidence that the national receiver is not runnable.'],
  ['LICENSE', 'Proprietary license terms; runtime license enforcement must be implemented separately.'],
], [4300, 5060]));

b.push(h('Appendix D. Final release checklist', 1));
[
  'No source code, Git metadata, source maps or build secrets are in the facility bundle.',
  'All images are private, signed, scanned and pinned by digest.',
  'All secrets are unique to the facility and protected with least privilege.',
  'Disk encryption, certificate trust, UPS, DNS and backups have independent evidence.',
  'Tenant-boundary and WAN-offline acceptance tests passed on at least two devices.',
  'Country-node federation is described accurately as unavailable until its release gates pass.',
  'The facility and TamamHealth have signed the commissioning record.',
].forEach(x => b.push(bullet(x)));
b.push(p([txt('Final rule: ', { bold: true, color: C.darkRed }), txt('If the facility cannot protect the host, registry credential, certificate trust and encrypted patient data, do not deploy the edge node there. Use a TamamHealth-controlled hosting model until those controls exist.', { color: C.darkRed })], { before: 80, after: 0 }));

const doc = new Document({
  creator: 'TamamHealth Health Technologies', title: 'TamamHealth Multi-Facility Installation and Offline Rollout Guide',
  description: 'Audited facility-edge deployment, source protection, commissioning and operations guide.',
  styles: {
    default: { document: { run: { font: 'Arial', size: 20, color: C.navy }, paragraph: { spacing: { line: 276, after: 120 } } } },
    paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { font: 'Arial', size: 42, bold: true, color: C.navy }, paragraph: { alignment: AlignmentType.CENTER } },
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Arial', size: 30, bold: true, color: C.navy }, paragraph: { outlineLevel: 0, keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: C.blue } } } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Arial', size: 24, bold: true, color: C.blue }, paragraph: { outlineLevel: 1, keepNext: true } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Arial', size: 21, bold: true, color: C.orange }, paragraph: { outlineLevel: 2, keepNext: true } },
    ],
  },
  numbering: { config: [
    { reference: 'bullets', levels: [
      { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 220 } } } },
      { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 760, hanging: 220 } } } },
    ] },
    ...['steps','hostSteps','firstRun','restore'].map(reference => ({ reference, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 480, hanging: 260 } } } }] })),
  ] },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1080, right: 1273, bottom: 1080, left: 1273, header: 500, footer: 500 } } },
    headers: { default: header }, footers: { default: footer }, children: b,
  }],
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(OUT, buffer);
  process.stdout.write(`${OUT}\n`);
});

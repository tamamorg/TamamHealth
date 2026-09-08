// Read-only preflight. This checks configuration, not live infrastructure or
// clinical approval. Run in the deployment's environment; never print secrets.
import nextEnv from '@next/env';
import configModule from '../src/lib/config-validation.ts';

nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const { validateProductionConfig, productionConfigWarnings } = configModule;
const errors = validateProductionConfig(process.env);
const warnings = productionConfigWarnings(process.env);
const major = Number(process.versions.node.split('.')[0]);
if (major < 20 || major >= 25) errors.push('Use a supported Node runtime (>=20 <25).');
if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'false') {
  errors.push('A clinical release requires NEXT_PUBLIC_DEMO_MODE=false explicitly.');
}
const ready = errors.length === 0 && warnings.length === 0;
console.log(JSON.stringify({
  configurationReady: ready,
  errors,
  warnings,
  remainingEvidence: [
    'Staging end-to-end tests with durable CouchDB and deployed tenant validators',
    'Cross-facility access denial and encrypted restricted-note audit tests',
    'Offline/reconnect conflict handling and power-loss recovery tests',
    'Encrypted backup restore drill with measured recovery time and data loss',
    'Clinical owner approval, device encryption verification, monitoring and rollback drill',
  ],
}, null, 2));
if (!ready) process.exitCode = 1;

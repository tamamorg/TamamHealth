import offlineConfigModule from '../src/lib/offline-deployment-config.ts';

const { facilityEdgeConfigurationProblems, readOfflineDeploymentConfig } = offlineConfigModule;

const config = readOfflineDeploymentConfig(process.env);
const problems = facilityEdgeConfigurationProblems(process.env);

process.stdout.write(`${JSON.stringify({ ...config, valid: problems.length === 0, problems }, null, 2)}\n`);
if (problems.length > 0) process.exitCode = 1;

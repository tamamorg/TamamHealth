#!/usr/bin/env node
// =============================================================================
// TamamHealth Platform — Setup Script
// =============================================================================
// Cross-platform (Windows, macOS, Linux) first-time setup.
//
// Usage:
//   node scripts/setup.mjs
// =============================================================================

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

function log(msg) { console.log(msg); }
function info(msg) { log(`${CYAN}[info]${RESET} ${msg}`); }
function success(msg) { log(`${GREEN}[done]${RESET} ${msg}`); }
function warn(msg) { log(`${YELLOW}[warn]${RESET} ${msg}`); }
function heading(msg) { log(`\n${BOLD}${msg}${RESET}`); }

// ---------------------------------------------------------------------------
// Readline helper
// ---------------------------------------------------------------------------
const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question, defaultValue) {
  const suffix = defaultValue ? ` ${DIM}(${defaultValue})${RESET}` : '';
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function close() { rl.close(); }

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  log('');
  log(`${BOLD}${GREEN}  TamamHealth Platform Setup${RESET}`);
  log(`${DIM}  Digital Health Records for South Sudan${RESET}`);
  log('');

  // ---- Step 1: Check Node version ----
  heading('1. Checking prerequisites');

  const nodeVersion = process.versions.node;
  const [major] = nodeVersion.split('.').map(Number);
  if (major < 20 || major >= 25) {
    log(`  Node.js ${nodeVersion} detected — requires >= 20.0.0 and < 25.0.0`);
    log('  Please upgrade Node.js: https://nodejs.org');
    close();
    process.exit(1);
  }
  success(`Node.js ${nodeVersion}`);

  // ---- Step 2: Create .env.local ----
  heading('2. Environment configuration');

  const envPath = join(ROOT, '.env.local');
  const envExamplePath = join(ROOT, '.env.example');

  if (existsSync(envPath)) {
    info('.env.local already exists — skipping.');
  } else if (!existsSync(envExamplePath)) {
    warn('.env.example not found — cannot create .env.local');
  } else {
    let envContent = readFileSync(envExamplePath, 'utf-8');

    // Generate every secret a standalone local install needs. The template
    // deliberately contains placeholders/blank values so copied examples can
    // never become shared credentials across installations.
    const jwtSecret = randomBytes(48).toString('base64');
    const phiEncryptionKey = randomBytes(32).toString('base64');
    const orgDataKeySecret = randomBytes(48).toString('base64');
    envContent = envContent.replace(
      'JWT_SECRET=change-me-to-a-random-secret',
      `JWT_SECRET=${jwtSecret}`
    );
    envContent = envContent.replace(
      'PHI_ENCRYPTION_KEY=',
      `PHI_ENCRYPTION_KEY=${phiEncryptionKey}`
    );
    envContent = envContent.replace(
      'ORG_DATA_KEY_SECRET=',
      `ORG_DATA_KEY_SECRET=${orgDataKeySecret}`
    );

    log('');
    info('Configuring your environment...');
    log('');

    const orgName = await ask('Organization name', 'My Organization');
    envContent = envContent.replace(
      'NEXT_PUBLIC_ORG_NAME=My Organization',
      `NEXT_PUBLIC_ORG_NAME=${orgName}`
    );

    const mode = await ask('Demo mode? (loads sample data for testing) [yes/no]', 'yes');
    const isDemo = mode.toLowerCase().startsWith('y');
    envContent = envContent.replace(
      'NEXT_PUBLIC_DEMO_MODE=true',
      `NEXT_PUBLIC_DEMO_MODE=${isDemo}`
    );

    if (!isDemo) {
      log('');
      info('Production setup — configure your admin account:');
      const adminName = await ask('Admin full name', 'System Administrator');
      const adminPass = await ask(
        'Admin password (leave blank to auto-generate; saved to .seed-credentials.json)',
        '',
      );
      const orgEmail = await ask('Organization email', 'support.tamam@gmail.com');
      const orgCountry = await ask('Country', 'South Sudan');

      envContent = envContent.replace(
        'NEXT_PUBLIC_ADMIN_NAME=System Administrator',
        `NEXT_PUBLIC_ADMIN_NAME=${adminName}`,
      );
      // ADMIN_INITIAL_PASSWORD is server-only by design (commented out in
      // .env.example). Uncomment + fill it only if the operator typed one.
      if (adminPass) {
        envContent = envContent.replace(
          '# ADMIN_INITIAL_PASSWORD=',
          `ADMIN_INITIAL_PASSWORD=${adminPass}`,
        );
      }
      envContent = envContent.replace(
        'NEXT_PUBLIC_ORG_EMAIL=support.tamam@gmail.com',
        `NEXT_PUBLIC_ORG_EMAIL=${orgEmail}`,
      );
      envContent = envContent.replace(
        'NEXT_PUBLIC_ORG_COUNTRY=South Sudan',
        `NEXT_PUBLIC_ORG_COUNTRY=${orgCountry}`,
      );
    }

    const wantDb = await ask('Set up PostgreSQL connection? [yes/no]', 'no');
    if (wantDb.toLowerCase().startsWith('y')) {
      const dbUrl = await ask('DATABASE_URL', 'postgresql://tamamhealth:password@localhost:5432/safeguard_junub');
      envContent = envContent.replace(
        '# DATABASE_URL=postgresql://tamamhealth:password@localhost:5432/safeguard_junub',
        `DATABASE_URL=${dbUrl}`
      );
      envContent = envContent.replace(
        '# DATABASE_DIRECT_URL=postgresql://tamamhealth:password@localhost:5432/safeguard_junub',
        `DATABASE_DIRECT_URL=${dbUrl}`
      );
    }

    writeFileSync(envPath, envContent, 'utf-8');
    success('Created .env.local with unique JWT and data-encryption secrets');
  }

  // ---- Step 3: Install dependencies ----
  heading('3. Installing dependencies');

  if (existsSync(join(ROOT, 'node_modules', 'next'))) {
    info('node_modules already exists — skipping install.');
    info('Run "npm install" manually to update.');
  } else {
    info('Running npm install (this may take a minute)...');
    try {
      execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
      success('Dependencies installed');
    } catch {
      warn('npm install failed — try running it manually.');
    }
  }

  // ---- Step 4: Database setup guidance ----
  heading('4. Database setup (optional)');

  const envFile = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
  const hasDb = /^DATABASE_URL=.+$/m.test(envFile);

  log(`  ${DIM}The app works fully offline with browser-based PouchDB.${RESET}`);
  log(`  ${DIM}PostgreSQL is only needed for national analytics & government dashboards.${RESET}`);
  log('');

  if (hasDb) {
    info('DATABASE_URL is configured. To initialize the schema:');
    log(`  ${CYAN}npm run db:migrate${RESET}`);
    log(`  ${DIM}(Migrations also run automatically at app startup.)${RESET}`);
  } else {
    info('No PostgreSQL configured. To add it later:');
    log(`  ${DIM}1. Create a database: createdb safeguard_junub${RESET}`);
    log(`  ${DIM}2. Set DATABASE_URL in .env.local${RESET}`);
    log(`  ${DIM}3. Run migrations:    npm run db:migrate${RESET}`);
  }

  // ---- Step 5: Summary ----
  heading('5. Ready!');
  log('');
  log(`  Start the server:`);
  log(`  ${BOLD}${GREEN}npm run dev${RESET}`);
  log('');
  log(`  Then open ${CYAN}http://localhost:3000${RESET}`);
  log('');

  if (envFile.includes('NEXT_PUBLIC_DEMO_MODE=true') || !existsSync(envPath)) {
    log(`  ${BOLD}Demo credentials:${RESET}`);
    log(`  ${DIM}A random password is generated for every demo user on first${RESET}`);
    log(`  ${DIM}server boot and written to:${RESET}`);
    log(`  ${CYAN}    platform/.seed-credentials.json${RESET} ${DIM}(gitignored, mode 0600)${RESET}`);
    log(`  ${DIM}You can also fetch them at runtime via:${RESET}`);
    log(`  ${CYAN}    curl http://localhost:3000/api/demo-credentials${RESET}`);
    log(`  ${DIM}or click any role chip on the login page (auto-fills the form).${RESET}`);
    log('');
  }

  log(`  ${DIM}Other commands:${RESET}`);
  log(`  ${DIM}  npm run build    Build for production${RESET}`);
  log(`  ${DIM}  npm test         Run test suite${RESET}`);
  log(`  ${DIM}  npm run lint     Run linter${RESET}`);
  log('');

  close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

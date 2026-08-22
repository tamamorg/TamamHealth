/**
 * @jest-environment node
 *
 * CODEOWNERS routes review. This checks it still routes to something.
 *
 * ## Why this exists
 *
 * When the identity domain moved into `src/modules/` (ADR 0003), five entries
 * in the security-sensitive block — `lib/auth.ts`, `lib/auth-token.ts`,
 * `lib/csrf.ts`, `lib/api-auth.ts`, `lib/token-blacklist.ts` — stopped matching
 * anything. GitHub does not warn about that. The file still listed them, the
 * block still carried its comment about keeping auth changes under security
 * review, and every one of those rules had silently stopped applying.
 *
 * A pattern that matches nothing is worse than no pattern: it reads as
 * coverage and provides none. Nothing in CI could see it, because CODEOWNERS
 * is not code and never gets compiled, linted or run.
 *
 * ## What it asserts
 *
 *   1. Every path pattern resolves to something that exists.
 *   2. The files that actually hold credentials are matched by a rule MORE
 *      specific than the catch-all or the blanket `/platform/` entry — which
 *      is the property the security block exists to provide, stated directly
 *      rather than inferred from the file's shape.
 */
import fs from 'node:fs';
import path from 'node:path';

// Jest runs from `platform/`; CODEOWNERS lives at the repo root.
const REPO_ROOT = path.resolve(process.cwd(), '..');
const CODEOWNERS = path.join(REPO_ROOT, '.github/CODEOWNERS');

interface Rule { pattern: string; owners: string[]; line: number }

function readRules(): Rule[] {
  return fs.readFileSync(CODEOWNERS, 'utf8')
    .split('\n')
    .map((text, i) => ({ text: text.trim(), line: i + 1 }))
    .filter(({ text }) => text && !text.startsWith('#'))
    .map(({ text, line }) => {
      const [pattern, ...owners] = text.split(/\s+/);
      return { pattern, owners, line };
    });
}

/**
 * Does this pattern name anything in the repo?
 *
 * Only the forms this file actually uses are handled — a leading-slash path,
 * with or without a trailing slash. Inventing glob support for syntax nobody
 * has written would be testing an imaginary file.
 */
function resolves(pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern.includes('*')) return true;
  const rel = pattern.replace(/^\//, '').replace(/\/$/, '');
  return fs.existsSync(path.join(REPO_ROOT, rel));
}

/** GitHub's rule: the LAST matching pattern wins. */
function ruleFor(repoRelativeFile: string, rules: Rule[]): Rule | undefined {
  let match: Rule | undefined;
  for (const rule of rules) {
    if (rule.pattern === '*') { match = rule; continue; }
    const rel = rule.pattern.replace(/^\//, '');
    const isDir = rel.endsWith('/');
    if (isDir ? repoRelativeFile.startsWith(rel) : repoRelativeFile === rel) match = rule;
  }
  return match;
}

describe('CODEOWNERS', () => {
  const rules = readRules();

  it('is not empty', () => {
    expect(rules.length).toBeGreaterThan(10);
  });

  it('names only paths that exist', () => {
    const dead = rules.filter(r => !resolves(r.pattern))
      .map(r => `line ${r.line}: ${r.pattern}`);
    expect(dead).toEqual([]);
  });

  it('gives every rule an owner', () => {
    const ownerless = rules.filter(r => r.owners.length === 0 || !r.owners.every(o => o.startsWith('@')))
      .map(r => `line ${r.line}: ${r.pattern}`);
    expect(ownerless).toEqual([]);
  });
});

describe('credential-bearing code stays under security review', () => {
  const rules = readRules();

  /**
   * The files a reviewer would want to be told about. Named individually
   * rather than derived, because the point is to state which code is
   * security-sensitive — that is a judgement, not something a glob knows.
   */
  const SENSITIVE = [
    'platform/src/proxy.ts',
    'platform/src/modules/identity/core/api-auth.ts',
    'platform/src/modules/identity/core/auth.ts',
    'platform/src/modules/identity/core/auth-token.ts',
    'platform/src/modules/identity/core/csrf.ts',
    'platform/src/modules/identity/core/session.ts',
    'platform/src/modules/identity/core/token-blacklist.ts',
    'platform/src/modules/identity/core/server-users.ts',
    'platform/src/modules/identity/policy/password-policy.ts',
    'platform/src/modules/identity/provisioning/user-invite.ts',
    'platform/src/lib/field-encryption.ts',
    'platform/src/lib/config-validation.ts',
  ];

  it.each(SENSITIVE)('%s exists', file => {
    // A stale entry in the list above would make the routing assertion below
    // pass for a file nobody can edit, which is the same failure one level up.
    expect(fs.existsSync(path.join(REPO_ROOT, file))).toBe(true);
  });

  it.each(SENSITIVE)('%s routes somewhere more specific than the catch-all', file => {
    const rule = ruleFor(file, rules);
    expect(rule).toBeDefined();
    // `*` and `/platform/` both "match" — and neither means anyone reviewed the
    // auth change specifically, which is the whole purpose of the block.
    expect(rule!.pattern).not.toBe('*');
    expect(rule!.pattern).not.toBe('/platform/');
  });
});

/**
 * The production image copies only the files `npm run setup:couchdb:validators`
 * loads (platform/Dockerfile), and the deploy runs that step inside the image
 * after every release. A policy module that gains an import outside that set
 * breaks the deploy at "install validators" — which nothing caught until
 * write-permissions.ts started importing appointment-status.ts. Walk the
 * installer's runtime import graph and require every file to be copied.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
const copied = [...dockerfile.matchAll(/^COPY --from=builder \/app\/(\S+) /gm)].map(m => m[1].replace(/\/$/, ''));

const isCopied = (rel: string) => copied.some(c => rel === c || rel.startsWith(`${c}/`));

function resolve(fromFile: string, spec: string): string {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.mjs`, `${base}.js`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`cannot resolve ${spec} from ${fromFile}`);
}

/** Runtime imports only: `import type` is erased by tsx and needs no file. */
function runtimeImports(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*(import|export)\s+(?!type\s)[^;]*?from\s+['"]([^'"]+)['"]/gm)) out.push(m[2]);
  for (const m of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

it('copies every module the validator installer loads into the image', () => {
  const start = path.join(ROOT, 'scripts/install-validate-doc-updates.mjs');
  const seen = new Set<string>();
  const missing: string[] = [];
  const queue = [start];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const rel = path.relative(ROOT, file);
    if (!isCopied(rel)) missing.push(rel);
    for (const spec of runtimeImports(file)) {
      if (spec.startsWith('@/')) {
        missing.push(`${rel} imports ${spec} (path aliases are not resolvable in the image)`);
        continue;
      }
      if (!spec.startsWith('.')) continue; // packages ship in node_modules
      queue.push(resolve(file, spec));
    }
  }
  expect(missing).toEqual([]);
  expect(seen.size).toBeGreaterThan(3);
});

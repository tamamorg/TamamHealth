/**
 * @jest-environment node
 *
 * The identity module's boundaries, asserted rather than assumed.
 *
 * Two of these caught real defects while the module was being extracted, which
 * is the argument for keeping them: neither is visible to `tsc`, and both fail
 * far from their cause.
 *
 *   1. A client component importing the server barrel pulled `node:fs` into the
 *      browser bundle. The type-check was perfectly happy; the production build
 *      died with "the chunking context does not support external modules".
 *   2. Re-exporting services from the barrel turned every `await import()` into
 *      an eager one, so a route that wanted `getAuthPayload` loaded PouchDB at
 *      module-init — and a test that mocked the service found its factory
 *      running before its own `const` had initialised.
 *
 * See docs/adr/0003-domain-modules.md.
 */
import fs from 'node:fs';
import path from 'node:path';

const MODULE_ROOT = path.join(process.cwd(), 'src/modules/identity');

/** Every file the given entrypoint can reach through STATIC imports. */
function staticGraph(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    // Static value imports only, which is what "reaches the bundle" means:
    //
    //   - `import type { X } from '…'` is erased by the compiler and pulls
    //     nothing. Counting it reported `node:crypto` against the client
    //     surface for a type that does not exist at runtime.
    //   - `await import('…')` is deferred on purpose, and treating it as an
    //     edge would defeat the whole reason services are a separate
    //     entrypoint.
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)(\s+type)?\b[^'"\n]*?from\s+['"]([^'"]+)['"]/g)) {
      if (m[1]) continue;
      const spec = m[2];
      let resolved: string | null = null;
      if (spec.startsWith('.')) resolved = path.join(path.dirname(file), spec);
      else if (spec.startsWith('@/')) resolved = path.join(process.cwd(), 'src', spec.slice(2));
      if (!resolved) continue;
      for (const candidate of [`${resolved}.ts`, `${resolved}.tsx`, path.join(resolved, 'index.ts')]) {
        if (fs.existsSync(candidate)) { queue.push(candidate); break; }
      }
    }
  }
  return [...seen];
}

describe('the client surface stays usable in a browser', () => {
  const graph = staticGraph(path.join(MODULE_ROOT, 'client.ts'));

  it('reaches no Node built-in', () => {
    // `node:fs` arriving here is not a lint opinion — it is a build failure on
    // the root page, which is how this was found.
    const offenders = graph
      .map(f => ({ f, hits: [...fs.readFileSync(f, 'utf8').matchAll(/from\s+['"](node:[a-z/]+)['"]/g)].map(m => m[1]) }))
      .filter(x => x.hits.length);
    expect(offenders.map(o => `${path.relative(process.cwd(), o.f)} → ${o.hits.join(', ')}`)).toEqual([]);
  });

  it('reaches no database', () => {
    // PouchDB in a barrel is the same class of problem one layer down: it
    // loads, it just brings the whole data layer with it.
    const offenders = graph.filter(f => /from\s+['"]@\/lib\/db['"]/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map(f => path.relative(process.cwd(), f))).toEqual([]);
  });
});

describe('the server surface stays cheap to import', () => {
  const graph = staticGraph(path.join(MODULE_ROOT, 'index.ts'));

  it('does not statically pull the services layer', () => {
    // Every route in the app asks this barrel "who is calling?". If services
    // ride along, that question loads the write layer.
    const services = graph.filter(f => f.includes('/modules/identity/services/'));
    expect(services.map(f => path.basename(f))).toEqual([]);
  });

  it('does not statically pull the module\'s React components', () => {
    const components = graph.filter(f => f.includes('/modules/identity/components/'));
    expect(components.map(f => path.basename(f))).toEqual([]);
  });
});

describe('the module keeps its own edges', () => {
  const files = fs.readdirSync(MODULE_ROOT, { recursive: true, encoding: 'utf8' })
    .filter(f => f.endsWith('.ts') || f.endsWith('.tsx'))
    .map(f => path.join(MODULE_ROOT, f));

  it('never imports its own barrel', () => {
    // A module importing its own index is a cycle waiting to become an
    // initialisation order bug.
    const offenders = files.filter(f => {
      if (f.endsWith('index.ts') || f.endsWith('client.ts')) return false;
      return /from\s+['"]@\/modules\/identity['"]|from\s+['"]@\/modules\/identity\/client['"]/
        .test(fs.readFileSync(f, 'utf8'));
    });
    expect(offenders.map(f => path.relative(MODULE_ROOT, f))).toEqual([]);
  });

  it('exposes exactly the entrypoints the lint rules allow', () => {
    expect(fs.existsSync(path.join(MODULE_ROOT, 'index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(MODULE_ROOT, 'client.ts'))).toBe(true);
  });
});

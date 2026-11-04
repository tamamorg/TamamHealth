/**
 * The management modules wear the patient chart's frame through one scoped
 * stylesheet (app/management-frame.css), switched on by
 * `data-surface="management"` on <main>. These tests pin the two halves:
 * which routes are management surfaces, and that the stylesheet can only
 * ever reach those routes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isManagementSurface } from '@/lib/navigation/management-surface';

const SRC = path.join(process.cwd(), 'src');
const SCOPE = 'body main[data-surface="management"]';

describe('isManagementSurface', () => {
  it.each([
    '/admin', '/admin/users/42', '/admin/organizations/org-1', '/manage',
    '/org-admin/branding', '/facility-management', '/facility-management/queue',
    '/government', '/government/equity', '/dashboard/state', '/dashboard/hr',
    '/hr/leave', '/equipment', '/blood-bank', '/reports', '/surveillance',
    '/epidemic-intelligence', '/mch-analytics', '/data-quality', '/dhis2-export',
  ])('treats %s as a management surface', (route) => {
    expect(isManagementSurface(route)).toBe(true);
  });

  it.each([
    '/dashboard', '/patients', '/patients/pat-1', '/appointments', '/lab',
    '/pharmacy', '/triage/pat-1', '/wards', '/messages', '/settings', '/billing',
    '/payments',
  ])('leaves clinical and shared route %s alone', (route) => {
    expect(isManagementSurface(route)).toBe(false);
  });

  it("treats /dashboard as management only for a role whose home there is a management dashboard", () => {
    expect(isManagementSurface('/dashboard', 'medical_superintendent')).toBe(true);
    expect(isManagementSurface('/dashboard', 'doctor')).toBe(false);
    expect(isManagementSurface('/dashboard', 'nurse')).toBe(false);
    expect(isManagementSurface('/dashboard')).toBe(false);
    expect(isManagementSurface('/dashboard/lab', 'medical_superintendent')).toBe(false);
  });

  it('treats every page as management for the ministry and county roles, except Settings and Messages', () => {
    for (const role of ['government', 'county_health_director']) {
      expect(isManagementSurface('/births', role)).toBe(true);
      expect(isManagementSurface('/immunizations', role)).toBe(true);
      expect(isManagementSurface('/settings', role)).toBe(false);
      expect(isManagementSurface('/messages', role)).toBe(false);
    }
    expect(isManagementSurface('/births', 'nurse')).toBe(false);
  });

  it('matches whole path segments only', () => {
    expect(isManagementSurface('/administration')).toBe(false);
    expect(isManagementSurface('/hrx')).toBe(false);
    expect(isManagementSurface('/dashboard/statex')).toBe(false);
  });

  it('is false with no path', () => {
    expect(isManagementSurface(null)).toBe(false);
    expect(isManagementSurface(undefined)).toBe(false);
    expect(isManagementSurface('')).toBe(false);
  });
});

describe('management-frame.css', () => {
  const css = fs.readFileSync(path.join(SRC, 'app/management-frame.css'), 'utf8');

  it('is loaded by the root layout', () => {
    const layout = fs.readFileSync(path.join(SRC, 'app/layout.tsx'), 'utf8');
    expect(layout).toMatch(/import\s+["']\.\/management-frame\.css["']/);
  });

  it('is switched on by the dashboard layout', () => {
    const layout = fs.readFileSync(path.join(SRC, 'app/(dashboard)/layout.tsx'), 'utf8');
    expect(layout).toContain('isManagementSurface(pathname, currentUser?.role)');
    expect(layout).toContain("data-surface={managementSurface ? 'management' : undefined}");
  });

  it('scopes every selector to the management surface, so the chart and the clinical queues are untouched', () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const preludes = [...body.matchAll(/([^{}]+)\{/g)]
      .map((m) => m[1].trim())
      .filter((p) => p && !p.startsWith('@'));
    expect(preludes.length).toBeGreaterThan(50);

    const unscoped: string[] = [];
    for (const prelude of preludes) {
      // Split the selector list on top-level commas only (not inside :is()).
      let depth = 0;
      let part = '';
      const parts: string[] = [];
      for (const ch of prelude) {
        if (ch === '(') depth += 1;
        if (ch === ')') depth -= 1;
        if (ch === ',' && depth === 0) { parts.push(part); part = ''; continue; }
        part += ch;
      }
      parts.push(part);
      for (const selector of parts.map((s) => s.trim())) {
        if (!selector.startsWith(SCOPE)) unscoped.push(selector);
      }
    }
    expect(unscoped).toEqual([]);
  });
});

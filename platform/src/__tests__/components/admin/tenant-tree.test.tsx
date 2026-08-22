import { renderToStaticMarkup } from 'react-dom/server';
import { OrgFacilities, FacilityUserList, ORG_GRID_TEMPLATE } from '@/components/admin/TenantTree';
import type { HospitalDoc, UserDoc } from '@/lib/db-types';

/**
 * The tenant tree on /admin draws three depths — organization, facility,
 * account — and its whole point is that they share ONE column template. The
 * accounts depth only appears when a user carries a facility, so on a database
 * whose accounts are all platform-level (a fresh seed, most dev machines) it is
 * invisible: it shipped once with three mismatched column systems partly
 * because the deepest one was never on screen to look at.
 */

const facility = (over: Partial<HospitalDoc> = {}): HospitalDoc => ({
  _id: 'hosp-1',
  type: 'hospital',
  name: 'Mercy General Hospital',
  facilityType: 'state_hospital',
  town: 'Juba',
  state: 'Central Equatoria',
  syncStatus: 'online',
  isActive: true,
  createdAt: '2026-01-05T00:00:00.000Z',
  updatedAt: '2026-01-05T00:00:00.000Z',
  ...over,
} as unknown as HospitalDoc);

const account = (over: Partial<UserDoc> = {}): UserDoc => ({
  _id: 'user-1',
  type: 'user',
  name: 'Grace Aluel',
  username: 'grace.aluel',
  role: 'nurse',
  isActive: true,
  hospitalId: 'hosp-1',
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  ...over,
} as unknown as UserDoc);

/** Every `grid-template-columns` the markup sets, in document order. */
function templates(html: string): string[] {
  return [...html.matchAll(/grid-template-columns:([^;"]+)/g)].map(m => m[1].trim());
}

const norm = (t: string) => t.replace(/\s+/g, ' ').replace(/,\s*/g, ',').trim();

describe('the tenant tree draws every depth on one column template', () => {
  it('puts a facility row on the same template as the organization above it', () => {
    const html = renderToStaticMarkup(
      <OrgFacilities
        facilities={[facility()]}
        usersByFacility={new Map([['hosp-1', [account()]]])}
        loading={false}
        onOpen={() => {}}
      />,
    );
    const used = templates(html);
    expect(used.length).toBeGreaterThan(0);
    for (const t of used) expect(norm(t)).toBe(norm(ORG_GRID_TEMPLATE));
  });

  it('puts an account row on it too — the depth that only shows when a user has a facility', () => {
    const html = renderToStaticMarkup(
      <FacilityUserList id="facusers-hosp-1" users={[account()]} facilityId="hosp-1" />,
    );
    for (const t of templates(html)) expect(norm(t)).toBe(norm(ORG_GRID_TEMPLATE));
    expect(html).toContain('Grace Aluel');
    expect(html).toContain('@grace.aluel');
    // Attachment is the reason this row exists: works here vs covers from
    // elsewhere is the staffing question an operator opened it to answer.
    expect(html).toContain('Home site');
  });

  it('marks a user reached through facilityIds as covering, not resident', () => {
    const html = renderToStaticMarkup(
      <FacilityUserList
        id="facusers-hosp-1"
        users={[account({ _id: 'user-2', name: 'Peter Deng', username: 'peter.deng', hospitalId: 'hosp-9' })]}
        facilityId="hosp-1"
      />,
    );
    expect(html).toContain('Covering');
    expect(html).not.toContain('Home site');
  });

  it('sorts the facility’s own staff above the people covering it', () => {
    const html = renderToStaticMarkup(
      <FacilityUserList
        id="facusers-hosp-1"
        users={[
          account({ _id: 'user-2', name: 'Aaron Covering', username: 'aaron.c', hospitalId: 'hosp-9' }),
          account({ _id: 'user-3', name: 'Zoe Resident', username: 'zoe.r', hospitalId: 'hosp-1' }),
        ]}
        facilityId="hosp-1"
      />,
    );
    expect(html.indexOf('zoe.r')).toBeLessThan(html.indexOf('aaron.c'));
  });

  it('keeps the empty state rather than collapsing the facility to nothing', () => {
    const html = renderToStaticMarkup(
      <FacilityUserList id="facusers-hosp-1" users={[]} facilityId="hosp-1" />,
    );
    expect(html).toContain('No accounts are attached to this facility yet.');
  });

  it('renders no header of its own — the list above owns the only one', () => {
    const html = renderToStaticMarkup(
      <OrgFacilities
        facilities={[facility()]}
        usersByFacility={new Map([['hosp-1', [account()]]])}
        loading={false}
        onOpen={() => {}}
      />,
    );
    expect(html).not.toContain('sadb-tenant-grid--head');
    expect(html).not.toContain('sadb-facusers-head');
  });

  it('leaves a parent-only measure blank instead of inventing a column for it', () => {
    const html = renderToStaticMarkup(
      <FacilityUserList id="facusers-hosp-1" users={[account()]} facilityId="hosp-1" />,
    );
    // Patients and Facilities are organization measures; an account has
    // neither, and the cells are held open so the columns stay in step.
    expect(html.match(/sadb-subrow-blank/g)?.length).toBe(2);
  });
});

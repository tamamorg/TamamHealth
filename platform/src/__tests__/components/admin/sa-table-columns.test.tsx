import { renderToStaticMarkup } from 'react-dom/server';
import { SaTable, type SaColumn } from '@/components/admin/sa-ui';
import TableCols from '@/components/TableCols';

/**
 * Column widths are the whole reason these tables use `table-layout: fixed`.
 * Auto layout hands every spare pixel to whichever column holds the longest
 * string, which is how the audit log ended up with a 435px gap in front of
 * Detail and an Org column of em-dashes taking a full share of a 1440px screen.
 */

const widths = (html: string) =>
  [...html.matchAll(/<col style="width:([\d.]+)%/g)].map(m => Number(m[1]));

const row = <tr><td>x</td></tr>;

describe('SaTable column widths', () => {
  it('splits the table evenly when no column asks for more', () => {
    const html = renderToStaticMarkup(
      <SaTable columns={['When', 'User', 'Action', 'Result']}>{row}</SaTable>,
    );
    const w = widths(html);
    expect(w).toHaveLength(4);
    for (const each of w) expect(each).toBeCloseTo(25, 1);
  });

  it('treats w as a weight, not a size — 2 takes twice the room of 1', () => {
    const columns: SaColumn[] = [
      { label: 'Detail', w: 2 }, { label: 'Result', w: 1 }, { label: 'Risk', w: 1 },
    ];
    const [detail, result, risk] = widths(renderToStaticMarkup(<SaTable columns={columns}>{row}</SaTable>));
    expect(detail).toBeCloseTo(result * 2, 1);
    expect(result).toBeCloseTo(risk, 3);
  });

  it('always spends exactly the table — no column is left unallocated', () => {
    const columns: SaColumn[] = [
      { label: 'When', w: 0.8 }, { label: 'User', w: 1.1 }, { label: 'Org', w: 1 },
      { label: 'Action', w: 1.5 }, { label: 'Detail', w: 2.4 },
      { label: 'Result', w: 0.9 }, { label: 'Risk', w: 0.8 },
    ];
    const w = widths(renderToStaticMarkup(<SaTable columns={columns}>{row}</SaTable>));
    expect(w).toHaveLength(7);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 1);
  });

  it('gives one <col> per column, so no column falls back to auto sizing', () => {
    const html = renderToStaticMarkup(
      <SaTable columns={['A', 'B', 'C', 'D', 'E']}>{row}</SaTable>,
    );
    expect(widths(html)).toHaveLength(5);
    expect((html.match(/<th>/g) || []).length).toBe(5);
  });

  it('still renders a plain string column', () => {
    const html = renderToStaticMarkup(
      <SaTable columns={['When', { label: 'Detail', w: 3 }]}>{row}</SaTable>,
    );
    expect(html).toContain('<th>When</th>');
    expect(html).toContain('<th>Detail</th>');
  });
});

describe('TableCols', () => {
  it('resolves weights to percentages that spend the whole table', () => {
    const w = widths(renderToStaticMarkup(<TableCols widths={[1.9, 1.1, 0.8, 0.9, 0.9, 1, 1, 0.9, 0.8]} />));
    expect(w).toHaveLength(9);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 1);
    // Widest column first: the medication name, against eight measures.
    expect(Math.max(...w)).toBe(w[0]);
  });
});

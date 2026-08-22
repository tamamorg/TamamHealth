'use client';

/**
 * Column widths for a `table-layout: fixed` table.
 *
 * Fixed layout is what stops a wide screen pooling all its slack in whichever
 * column happens to hold the longest string — the audit log had a 435px gap in
 * front of Detail and an Org column of em-dashes taking a full share. But fixed
 * layout with no `<colgroup>` gives every column an equal share, which is wrong
 * the moment one holds a patient name and the next holds a status chip.
 *
 * So: pass weights, not sizes. `[2, 1, 1]` means the first column takes twice
 * the room of each of the others, resolved to percentages so the table stays
 * fluid between its `minWidth` and the viewport.
 *
 *   <table className="data-table" style={{ minWidth: 720, tableLayout: 'fixed' }}>
 *     <TableCols widths={[1.8, 1.2, 1, 0.8]} />
 */
export default function TableCols({ widths }: { widths: number[] }) {
  const total = widths.reduce((sum, w) => sum + w, 0) || widths.length;
  return (
    <colgroup>
      {widths.map((w, i) => (
        <col key={i} style={{ width: `${((w / total) * 100).toFixed(3)}%` }} />
      ))}
    </colgroup>
  );
}

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import RichGrid, { A11Y_CSS, type ColumnDef } from './RichGrid';

interface Row {
  id: string;
  title: string;
}

describe('RichGrid overflow geometry', () => {
  it('lets explicit track minima widen both header and body row hit boxes', () => {
    const columns: ColumnDef<Row>[] = [
      {
        key: 'title',
        header: 'Title',
        width: 1,
        render: ({ row }) => row.title,
      },
      {
        key: 'actions',
        header: 'Actions',
        width: 'minmax(360px, 1.8fr)',
        render: () => <button type="button">Send</button>,
      },
    ];

    const markup = renderToStaticMarkup(
      <RichGrid
        columns={columns}
        rows={[{ id: 'row-1', title: 'First row' }]}
        getRowId={(row) => row.id}
      />,
    );
    const rowTags = markup.match(/<div role="row"[^>]*>/g) ?? [];

    expect(rowTags).toHaveLength(2);
    expect(rowTags.every((tag) => tag.includes('min-width:min-content'))).toBe(true);
  });
});

/**
 * WI-39292 — a live audit of Studio > Inventory found the shared grid exposing
 * 51 role="row" elements with no grid/table/treegrid ancestor, 50 row
 * checkboxes all named "Select row", and a focusable root with
 * `outline: none`.
 *
 * These assert the RELATIONSHIPS a screen reader actually consumes, not the
 * source text that produces them — a guard pinned to spelling pins the defect
 * in place, which is exactly what happened to this repo's deploy guards.
 */
describe('RichGrid accessibility (WI-39292)', () => {
  const columns: ColumnDef<Row>[] = [
    { key: 'title', header: 'Title', width: 1, render: ({ row }) => row.title },
    { key: 'qty', header: 'Qty', width: 1, sortKey: 'qty', render: () => '1' },
  ];
  const rows: Row[] = [
    { id: 'row-1', title: 'First row' },
    { id: 'row-2', title: 'Second row' },
    { id: 'row-3', title: 'Third row' },
  ];

  const render = (selectable = false) => renderToStaticMarkup(
    <RichGrid columns={columns} rows={rows} getRowId={(row) => row.id} selectable={selectable} />,
  );

  it('puts every row inside a grid, so no row is orphaned', () => {
    const markup = render();
    const gridIndex = markup.indexOf('role="grid"');

    // The grid exists...
    expect(gridIndex).toBeGreaterThan(-1);
    // ...and every row opens AFTER it, i.e. rows are inside the grid rather
    // than floating beside it. This is the exact defect that was reported.
    const rowIndexes = [...markup.matchAll(/role="row"/g)].map((m) => m.index ?? -1);
    expect(rowIndexes.length).toBe(rows.length + 1); // + header
    expect(rowIndexes.every((index) => index > gridIndex)).toBe(true);
  });

  it('gives the rows actual cells, not bare divs', () => {
    const markup = render();
    // One gridcell per body row per column. Without role="presentation" on the
    // row's inner layout wrapper these would not be the row's children at all,
    // so a grid ancestor alone would still be an invalid tree.
    expect([...markup.matchAll(/role="gridcell"/g)]).toHaveLength(rows.length * columns.length);
    expect([...markup.matchAll(/role="columnheader"/g)]).toHaveLength(columns.length);
    expect(markup).toContain('role="presentation"');
  });

  it('conveys sortability without leaving a bare button inside the grid', () => {
    // A column is only sortable when it has BOTH a sortKey and an onSortChange
    // handler (`sortable = !!col.sortKey && !!onSortChange`), so this case has
    // to supply the handler — without it every header takes the plain <div>
    // branch and the button path is never rendered.
    const markup = renderToStaticMarkup(
      <RichGrid
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        onSortChange={() => {}}
      />,
    );
    // Still a real <button> so click/Enter/Space keep working, but announced as
    // a column header with an explicit sort state.
    expect(markup).toMatch(/<button[^>]*role="columnheader"[^>]*aria-sort="none"/);
  });

  it('gives every row checkbox a DISTINCT accessible name', () => {
    const markup = render(true);
    const names = [...markup.matchAll(/aria-label="(Select row [^"]*)"/g)].map((m) => m[1]);

    expect(names).toHaveLength(rows.length);
    // The reported defect was 50 controls sharing one name — uniqueness is the
    // property under test, so assert the SET size, not the strings.
    expect(new Set(names).size).toBe(rows.length);
  });

  it('declares row and column counts so position is announceable', () => {
    const markup = render();
    expect(markup).toContain(`aria-rowcount="${rows.length + 1}"`);
    expect(markup).toContain(`aria-colcount="${columns.length}"`);
  });

  it('ships a focus-visible rule for the focusable root, unconditionally', () => {
    // Injected separately from the print-mirror sheet BECAUSE that one only
    // injects when printMirrorEnabled — folding them together would give some
    // grids a focus ring and others none.
    expect(A11Y_CSS).toContain('[data-rg-screen-grid]:focus-visible');
    expect(A11Y_CSS).toMatch(/outline:\s*2px solid/);
    // The mouse-focus suppression must live in the SHEET too, so it and the
    // keyboard ring are resolved by the same cascade.
    expect(A11Y_CSS).toMatch(/\[data-rg-screen-grid\]:focus\s*\{[^}]*outline:\s*none/);
  });

  it('does NOT suppress the outline inline, which would defeat the ring', () => {
    // THE REGRESSION THIS EXISTS FOR: the root used to carry
    // `outline: 'none'` in its inline style object. An inline style beats any
    // stylesheet rule short of !important, so the :focus-visible rule matched
    // and still computed to outline-style:none — the ring was present in the
    // CSS and invisible on screen. Measured live before the fix:
    //   { active: true, matchesFocusVisible: true, outlineStyle: "none" }
    // Asserting the rule EXISTS (above) passed the whole time; only this
    // assertion would have caught it.
    const markup = render();
    const rootTag = markup.slice(0, markup.indexOf('>') + 1);

    expect(rootTag).toContain('data-rg-screen-grid');
    expect(rootTag).not.toMatch(/outline:\s*none/);
  });
});

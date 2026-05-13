import { describe, expect, it } from 'vitest';
import type { ColumnDef } from './RichGrid';
import {
  buildCopyPayloads,
  cellTextFor,
  escapeHtml,
  escapeTsvCell,
  headerTextFor,
} from './copy-payloads';

type Row = { id: string; name: string; status: 'live' | 'stale'; count: number };

const cols: ColumnDef<Row>[] = [
  { key: 'name', header: 'Name', width: 2, toCopyText: (r) => r.name, render: () => null },
  {
    key: 'status',
    header: 'Status',
    headerText: 'Status (label)',
    width: 1,
    toCopyText: (r) => r.status,
    render: () => null,
  },
  { key: 'count', header: 'Count', width: 1, toCopyText: (r) => String(r.count), render: () => null },
  // No toCopyText — should emit empty string for this column on every row.
  { key: 'actions', header: 'Actions', width: 1, render: () => null },
];

const rows: Row[] = [
  { id: 'a', name: 'Alpha', status: 'live', count: 1 },
  { id: 'b', name: 'Beta', status: 'stale', count: 99 },
];

describe('headerTextFor', () => {
  it('uses headerText override when present', () => {
    expect(headerTextFor(cols[1])).toBe('Status (label)');
  });

  it('falls back to header when header is a string', () => {
    expect(headerTextFor(cols[0])).toBe('Name');
  });

  it('falls back to column key when header is JSX', () => {
    const c: ColumnDef<Row> = {
      key: 'icon-name',
      header: { type: 'span', props: { children: 'JSX' }, key: null } as any,
      width: 1,
      render: () => null,
    };
    expect(headerTextFor(c)).toBe('icon-name');
  });

  it('stringifies a numeric header', () => {
    const c: ColumnDef<Row> = { key: 'n', header: 42 as any, width: 1, render: () => null };
    expect(headerTextFor(c)).toBe('42');
  });
});

describe('cellTextFor', () => {
  it('returns toCopyText() when present', () => {
    expect(cellTextFor(cols[0], rows[0])).toBe('Alpha');
  });

  it('returns empty string for columns without toCopyText', () => {
    expect(cellTextFor(cols[3], rows[0])).toBe('');
  });
});

describe('escapeHtml', () => {
  it('escapes the five XML entities', () => {
    expect(escapeHtml(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f');
  });

  it('passes plain text through unchanged', () => {
    expect(escapeHtml('Plain Name 99')).toBe('Plain Name 99');
  });
});

describe('escapeTsvCell', () => {
  it('replaces tabs with single space', () => {
    expect(escapeTsvCell('a\tb')).toBe('a b');
  });

  it('replaces newlines with single space', () => {
    expect(escapeTsvCell('one\ntwo\r\nthree\rfour')).toBe('one two three four');
  });

  it('collapses runs of whitespace-breaking chars to one space', () => {
    expect(escapeTsvCell('x\t\t\ny')).toBe('x y');
  });
});

describe('buildCopyPayloads', () => {
  it('emits a TSV header row + one TSV row per data row', () => {
    const { tsv } = buildCopyPayloads(cols, rows);
    const lines = tsv.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('Name\tStatus (label)\tCount\tActions');
    expect(lines[1]).toBe('Alpha\tlive\t1\t');
    expect(lines[2]).toBe('Beta\tstale\t99\t');
  });

  it('emits a real <table> in the HTML payload', () => {
    const { html } = buildCopyPayloads(cols, rows);
    expect(html).toMatch(/^<table>/);
    expect(html).toMatch(/<\/table>$/);
    expect(html).toContain('<thead><tr>');
    expect(html).toContain('<th>Name</th>');
    expect(html).toContain('<th>Status (label)</th>');
    expect(html).toContain('<td>Alpha</td>');
    expect(html).toContain('<td>99</td>');
  });

  it('escapes HTML-special characters in cell values', () => {
    const dangerous: Row[] = [{ id: 'd', name: '<script>&"\'', status: 'live', count: 0 }];
    const { html } = buildCopyPayloads(cols, dangerous);
    expect(html).toContain('&lt;script&gt;&amp;&quot;&#39;');
    expect(html).not.toContain('<script>');
  });

  it('handles empty row set (header row only)', () => {
    const { tsv, html } = buildCopyPayloads(cols, []);
    expect(tsv).toBe('Name\tStatus (label)\tCount\tActions');
    expect(html).toContain('<thead>');
    expect(html).toContain('<tbody></tbody>');
  });

  it('preserves row order', () => {
    const reversed = [...rows].reverse();
    const { tsv } = buildCopyPayloads(cols, reversed);
    const lines = tsv.split('\n');
    expect(lines[1]).toContain('Beta');
    expect(lines[2]).toContain('Alpha');
  });
});

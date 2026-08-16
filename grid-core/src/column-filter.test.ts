import { describe, expect, it } from 'vitest';
import type { ColumnDef } from './RichGrid';
import {
  applyColumnFilters,
  decodeColumnFilters,
  deriveEnumOptions,
  encodeColumnFilters,
  filterChipLabel,
  type ColumnFilterState,
  type FilterableColumn,
} from './column-filter';

// A row shape exercising every filter type incl. nullable cells.
type Row = {
  id: string;
  plan: string | null; // text
  kind: 'bug' | 'change' | 'chore' | null; // enum
  prio: number | null; // number
  open: boolean | null; // boolean
};

// Use real ColumnDef<Row> so we prove ColumnDef is assignable to
// FilterableColumn<Row> (the engine accepts it directly).
const cols: ColumnDef<Row>[] = [
  {
    key: 'plan',
    header: 'Plan',
    width: 2,
    filter: { type: 'text', accessor: (r) => r.plan },
    render: () => null,
  },
  {
    key: 'kind',
    header: 'Kind',
    width: 1,
    filter: {
      type: 'enum',
      accessor: (r) => r.kind,
      multi: true,
      options: [
        { value: 'bug', label: 'Bug' },
        { value: 'change', label: 'Change' },
        { value: 'chore' }, // no label → falls back to value
      ],
    },
    render: () => null,
  },
  {
    key: 'prio',
    header: 'Prio',
    width: 1,
    filter: { type: 'number', accessor: (r) => r.prio },
    render: () => null,
  },
  {
    key: 'open',
    header: 'State',
    width: 1,
    filter: { type: 'boolean', accessor: (r) => r.open },
    render: () => null,
  },
  // No filter spec — must be ignored by every engine function.
  { key: 'actions', header: 'Actions', width: 1, render: () => null },
];

const rows: Row[] = [
  { id: 'a', plan: 'auth-rework', kind: 'bug', prio: 1, open: true },
  { id: 'b', plan: 'Auth login', kind: 'change', prio: 2, open: false },
  { id: 'c', plan: 'billing', kind: 'bug', prio: 3, open: true },
  { id: 'd', plan: null, kind: null, prio: null, open: null },
  { id: 'e', plan: 'Chore cleanup', kind: 'chore', prio: 5, open: false },
];

const ids = (rs: Row[]) => rs.map((r) => r.id);

// ─── applyColumnFilters: text ────────────────────────────────────────────────

describe('applyColumnFilters — text', () => {
  it('case-insensitive substring match', () => {
    const out = applyColumnFilters(rows, { plan: 'auth' }, cols);
    expect(ids(out)).toEqual(['a', 'b']);
  });

  it('empty string is inactive (returns all rows)', () => {
    const out = applyColumnFilters(rows, { plan: '' }, cols);
    expect(ids(out)).toEqual(ids(rows));
  });

  it('null accessor value fails an active text filter', () => {
    const out = applyColumnFilters(rows, { plan: 'a' }, cols);
    expect(out.find((r) => r.id === 'd')).toBeUndefined();
  });
});

// ─── applyColumnFilters: enum ────────────────────────────────────────────────

describe('applyColumnFilters — enum', () => {
  it('membership in the selected set', () => {
    const out = applyColumnFilters(rows, { kind: ['bug'] }, cols);
    expect(ids(out)).toEqual(['a', 'c']);
  });

  it('multi-value selection ORs across values', () => {
    const out = applyColumnFilters(rows, { kind: ['bug', 'chore'] }, cols);
    expect(ids(out)).toEqual(['a', 'c', 'e']);
  });

  it('empty array is inactive', () => {
    const out = applyColumnFilters(rows, { kind: [] }, cols);
    expect(ids(out)).toEqual(ids(rows));
  });

  it('null accessor value fails an active enum filter', () => {
    const out = applyColumnFilters(rows, { kind: ['bug', 'change', 'chore'] }, cols);
    expect(out.find((r) => r.id === 'd')).toBeUndefined();
  });
});

// ─── applyColumnFilters: number ──────────────────────────────────────────────

describe('applyColumnFilters — number', () => {
  it('inclusive min..max range', () => {
    const out = applyColumnFilters(rows, { prio: { min: 2, max: 3 } }, cols);
    expect(ids(out)).toEqual(['b', 'c']);
  });

  it('open-ended min only (>= 3)', () => {
    const out = applyColumnFilters(rows, { prio: { min: 3 } }, cols);
    expect(ids(out)).toEqual(['c', 'e']);
  });

  it('open-ended max only (<= 1)', () => {
    const out = applyColumnFilters(rows, { prio: { max: 1 } }, cols);
    expect(ids(out)).toEqual(['a']);
  });

  it('both bounds empty is inactive', () => {
    const out = applyColumnFilters(rows, { prio: {} }, cols);
    expect(ids(out)).toEqual(ids(rows));
  });

  it('null accessor value fails an active number filter', () => {
    const out = applyColumnFilters(rows, { prio: { min: 0 } }, cols);
    expect(out.find((r) => r.id === 'd')).toBeUndefined();
  });
});

// ─── applyColumnFilters: boolean ─────────────────────────────────────────────

describe('applyColumnFilters — boolean', () => {
  it('strict equality (true)', () => {
    const out = applyColumnFilters(rows, { open: true }, cols);
    expect(ids(out)).toEqual(['a', 'c']);
  });

  it('strict equality (false)', () => {
    const out = applyColumnFilters(rows, { open: false }, cols);
    expect(ids(out)).toEqual(['b', 'e']);
  });

  it('null accessor value fails an active boolean filter', () => {
    const out = applyColumnFilters(rows, { open: true }, cols);
    expect(out.find((r) => r.id === 'd')).toBeUndefined();
  });
});

// ─── applyColumnFilters: composition + edge cases ────────────────────────────

describe('applyColumnFilters — composition & edges', () => {
  it('ANDs multiple active filters', () => {
    const out = applyColumnFilters(rows, { kind: ['bug'], open: true }, cols);
    expect(ids(out)).toEqual(['a', 'c']);
  });

  it('null / undefined state returns rows untouched', () => {
    expect(applyColumnFilters(rows, null, cols)).toEqual(rows);
    expect(applyColumnFilters(rows, undefined, cols)).toEqual(rows);
  });

  it('ignores state keys with no matching filterable column', () => {
    const out = applyColumnFilters(rows, { nope: 'x', actions: 'y' } as ColumnFilterState, cols);
    expect(ids(out)).toEqual(ids(rows));
  });

  it('does not mutate the input rows array', () => {
    const snapshot = [...rows];
    applyColumnFilters(rows, { kind: ['bug'] }, cols);
    expect(rows).toEqual(snapshot);
  });

  it('with active filters returns a fresh (non-aliased) array', () => {
    const out = applyColumnFilters(rows, { kind: ['bug'] }, cols);
    expect(out).not.toBe(rows);
    expect(ids(out)).toEqual(['a', 'c']);
  });

  it('fast-paths an all-inactive state without re-filtering', () => {
    // Mirrors applySort's `if (!state) return rows` short-circuit: when no
    // filter is active we hand back the input reference (no wasted alloc).
    const out = applyColumnFilters(rows, {}, cols);
    expect(out).toBe(rows);
  });
});

// ─── deriveEnumOptions ───────────────────────────────────────────────────────

describe('deriveEnumOptions', () => {
  it('keeps explicit option order + labels, attaches live counts', () => {
    const opts = deriveEnumOptions(rows, cols[1]);
    expect(opts).toEqual([
      { value: 'bug', label: 'Bug', count: 2 },
      { value: 'change', label: 'Change', count: 1 },
      { value: 'chore', count: 1 },
    ]);
  });

  it('allows count 0 for an option absent from the rows', () => {
    const col: FilterableColumn<Row> = {
      key: 'kind',
      header: 'Kind',
      filter: {
        type: 'enum',
        accessor: (r) => r.kind,
        options: [
          { value: 'bug', label: 'Bug' },
          { value: 'epic', label: 'Epic' }, // never appears
        ],
      },
    };
    expect(deriveEnumOptions(rows, col)).toEqual([
      { value: 'bug', label: 'Bug', count: 2 },
      { value: 'epic', label: 'Epic', count: 0 },
    ]);
  });

  it('without explicit options: distinct sorted values with counts', () => {
    const col: FilterableColumn<Row> = {
      key: 'kind',
      header: 'Kind',
      filter: { type: 'enum', accessor: (r) => r.kind },
    };
    expect(deriveEnumOptions(rows, col)).toEqual([
      { value: 'bug', count: 2 },
      { value: 'change', count: 1 },
      { value: 'chore', count: 1 },
    ]);
  });

  it('skips null accessor values when discovering options', () => {
    const col: FilterableColumn<Row> = {
      key: 'kind',
      header: 'Kind',
      filter: { type: 'enum', accessor: (r) => r.kind },
    };
    const out = deriveEnumOptions(rows, col);
    expect(out.find((o) => o.value == null)).toBeUndefined();
  });

  it('returns [] for non-enum columns', () => {
    expect(deriveEnumOptions(rows, cols[0])).toEqual([]); // text
    expect(deriveEnumOptions(rows, cols[4])).toEqual([]); // no filter
  });
});

// ─── URL codec round-trip ────────────────────────────────────────────────────

describe('encode/decode round-trip', () => {
  const roundTrip = (state: ColumnFilterState) =>
    decodeColumnFilters(encodeColumnFilters(state), cols);

  it('empty state → empty string → empty state', () => {
    expect(encodeColumnFilters({})).toBe('');
    expect(decodeColumnFilters('', cols)).toEqual({});
    expect(roundTrip({})).toEqual({});
  });

  it('text round-trips', () => {
    const state: ColumnFilterState = { plan: 'auth' };
    expect(roundTrip(state)).toEqual(state);
  });

  it('text with codec delimiter chars survives the round-trip', () => {
    const tricky = 'a~b,c:d%e';
    const state: ColumnFilterState = { plan: tricky };
    const encoded = encodeColumnFilters(state);
    // raw delimiters must not leak into the encoded payload
    expect(encoded).not.toContain('~b');
    expect(encoded).not.toContain(',c');
    expect(roundTrip(state)).toEqual(state);
  });

  it('enum round-trips (single + multi)', () => {
    expect(roundTrip({ kind: ['bug'] })).toEqual({ kind: ['bug'] });
    expect(roundTrip({ kind: ['bug', 'chore'] })).toEqual({ kind: ['bug', 'chore'] });
  });

  it('number round-trips for all open-ended shapes', () => {
    expect(roundTrip({ prio: { min: 1, max: 3 } })).toEqual({ prio: { min: 1, max: 3 } });
    expect(roundTrip({ prio: { max: 5 } })).toEqual({ prio: { max: 5 } });
    expect(roundTrip({ prio: { min: 2 } })).toEqual({ prio: { min: 2 } });
  });

  it('number encodes in the documented min..max form', () => {
    expect(encodeColumnFilters({ prio: { min: 1, max: 3 } })).toBe('prio:1..3');
    expect(encodeColumnFilters({ prio: { max: 5 } })).toBe('prio:..5');
    expect(encodeColumnFilters({ prio: { min: 2 } })).toBe('prio:2..');
  });

  it('boolean round-trips (true + false)', () => {
    expect(roundTrip({ open: true })).toEqual({ open: true });
    expect(roundTrip({ open: false })).toEqual({ open: false });
    expect(encodeColumnFilters({ open: true })).toBe('open:true');
    expect(encodeColumnFilters({ open: false })).toBe('open:false');
  });

  it('round-trips a full mixed state', () => {
    const state: ColumnFilterState = {
      plan: 'auth',
      kind: ['bug', 'change'],
      prio: { min: 1, max: 3 },
      open: true,
    };
    expect(roundTrip(state)).toEqual(state);
  });

  it('drops inactive clauses on encode', () => {
    const encoded = encodeColumnFilters({ plan: '', kind: [], prio: {}, open: true });
    expect(encoded).toBe('open:true');
  });

  it('decode drops unknown / non-filterable keys', () => {
    expect(decodeColumnFilters('nope:x~actions:y~plan:ok', cols)).toEqual({ plan: 'ok' });
  });

  it('decode tolerates malformed clauses', () => {
    // missing ":", empty clause, bad number, bad boolean — all dropped,
    // good clauses survive
    const decoded = decodeColumnFilters('garbage~~prio:abc..def~open:maybe~plan:fine', cols);
    expect(decoded).toEqual({ plan: 'fine' });
  });

  it('decode handles empty / nullish input', () => {
    expect(decodeColumnFilters(null, cols)).toEqual({});
    expect(decodeColumnFilters(undefined, cols)).toEqual({});
    expect(decodeColumnFilters('', cols)).toEqual({});
  });
});

// ─── filterChipLabel ─────────────────────────────────────────────────────────

describe('filterChipLabel', () => {
  it('text chip', () => {
    expect(filterChipLabel(cols[0], 'auth')).toBe('Plan: auth');
  });

  it('enum chip uses option labels, joined', () => {
    expect(filterChipLabel(cols[1], ['bug', 'change'])).toBe('Kind: Bug, Change');
  });

  it('enum chip falls back to raw value when no label', () => {
    expect(filterChipLabel(cols[1], ['chore'])).toBe('Kind: chore');
  });

  it('number chip — closed range', () => {
    expect(filterChipLabel(cols[2], { min: 1, max: 3 })).toBe('Prio: 1–3');
  });

  it('number chip — open-ended', () => {
    expect(filterChipLabel(cols[2], { min: 2 })).toBe('Prio: ≥2');
    expect(filterChipLabel(cols[2], { max: 5 })).toBe('Prio: ≤5');
  });

  it('boolean chip', () => {
    expect(filterChipLabel(cols[3], true)).toBe('State: true');
    expect(filterChipLabel(cols[3], false)).toBe('State: false');
  });

  it('returns empty string for inactive values', () => {
    expect(filterChipLabel(cols[0], '')).toBe('');
    expect(filterChipLabel(cols[1], [])).toBe('');
    expect(filterChipLabel(cols[2], {})).toBe('');
  });

  it('returns empty string for a column with no filter spec', () => {
    expect(filterChipLabel(cols[4], 'x')).toBe('');
  });
});

// ─── label fallback for icon-only columns (empty / non-string header) ─────────

describe('column label fallback', () => {
  it('falls back to headerText when header is an empty string', () => {
    const col: FilterableColumn<Row> = {
      key: 'live',
      header: '',
      headerText: 'Live',
      filter: { type: 'boolean', accessor: (r) => r.open },
    };
    expect(filterChipLabel(col, true)).toBe('Live: true');
  });

  it('falls back to key when both header and headerText are empty / absent', () => {
    const col: FilterableColumn<Row> = {
      key: 'live',
      header: '',
      filter: { type: 'boolean', accessor: (r) => r.open },
    };
    expect(filterChipLabel(col, true)).toBe('live: true');
  });

  it('prefers a non-empty header over headerText', () => {
    const col: FilterableColumn<Row> = {
      key: 'live',
      header: 'Alive',
      headerText: 'Live',
      filter: { type: 'boolean', accessor: (r) => r.open },
    };
    expect(filterChipLabel(col, true)).toBe('Alive: true');
  });
});

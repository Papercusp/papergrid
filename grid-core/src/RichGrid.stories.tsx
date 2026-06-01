import React, { useRef } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import RichGrid, { type ColumnDef } from './RichGrid';

interface Row {
  id: string;
  name: string;
  status: string;
  count: number;
}

const STATUS_CYCLE = ['todo', 'in_progress', 'validating', 'passed', 'failing'];
const COUNTS = [0, 1, 2, 3, 0, 1, 4, 0, 2, 1, 3, 0, 1, 2, 0, 5, 1, 2, 0, 3];
const ROWS: Row[] = Array.from({ length: 20 }, (_, i) => ({
  id: String(i + 1),
  name: `Feature F-${String(i + 1).padStart(3, '0')}`,
  status: STATUS_CYCLE[i % 5],
  count: COUNTS[i],
}));

const COLUMNS: ColumnDef<Row>[] = [
  {
    key: 'name',
    header: 'Name',
    width: 3,
    render: (ctx) => <span style={{ fontFamily: 'monospace' }}>{ctx.row.name}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    width: 1,
    sortKey: 'status',
    render: (ctx) => (
      <span style={{
        padding: '1px 6px',
        borderRadius: 3,
        fontSize: 10,
        background: ctx.row.status === 'passed' ? '#1a3a1a' : ctx.row.status === 'failing' ? '#3a1a1a' : '#1a2236',
        color: ctx.row.status === 'passed' ? '#4caf50' : ctx.row.status === 'failing' ? '#f44336' : '#8a96ad',
      }}>
        {ctx.row.status}
      </span>
    ),
  },
  {
    key: 'count',
    header: 'Attempts',
    width: 1,
    align: 'right',
    render: (ctx) => String(ctx.row.count),
  },
];

const meta: Meta<typeof RichGrid> = {
  component: RichGrid,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ height: '400px', background: '#0c0e16', display: 'flex', flexDirection: 'column' }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof RichGrid>;

export const Default: Story = {
  args: {
    columns: COLUMNS,
    rows: ROWS,
    getRowId: (r) => r.id,
  },
};

export const Empty: Story = {
  args: {
    columns: COLUMNS,
    rows: [],
    getRowId: (r) => r.id,
    empty: <span style={{ color: '#8a96ad' }}>No features found.</span>,
  },
};

export const Selectable: Story = {
  args: {
    columns: COLUMNS,
    rows: ROWS.slice(0, 8),
    getRowId: (r) => r.id,
    selectable: true,
  },
};

export const WithSortState: Story = {
  args: {
    columns: COLUMNS,
    rows: [...ROWS].sort((a, b) => a.status.localeCompare(b.status)),
    getRowId: (r) => r.id,
    sortState: { column: 'status', dir: 'asc' },
  },
};

export const ResizableColumns: Story = {
  args: {
    columns: COLUMNS,
    rows: ROWS.slice(0, 8),
    getRowId: (r) => r.id,
    resizableColumns: true,
  },
};

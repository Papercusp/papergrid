import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import RichGrid, { type ColumnDef } from './RichGrid';

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

import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { ColumnRow } from './ColumnRow';
import type { ColumnView } from './model-view';

const column = (over: Partial<ColumnView> = {}): ColumnView => ({
  id: 'c',
  name: 'email',
  type: 'text',
  primaryKey: false,
  notNull: false,
  unique: false,
  default: null,
  references: [],
  ...over,
});

const row = (c: ColumnView) =>
  render(
    <ul>
      <ColumnRow column={c} />
    </ul>,
  );

describe('ColumnRow', () => {
  test('shows the name and type, and nothing else for a plain column', () => {
    row(column());
    expect(screen.getByText('email')).toBeInTheDocument();
    expect(screen.getByText('text')).toBeInTheDocument();
    for (const badge of ['PK', 'NN', 'UQ'])
      expect(screen.queryByText(badge)).not.toBeInTheDocument();
    expect(screen.queryByTitle('Default')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Foreign key')).not.toBeInTheDocument();
  });

  test('shows a badge for each of primary key, NOT NULL and unique', () => {
    row(column({ primaryKey: true, notNull: true, unique: true }));
    for (const badge of ['PK', 'NN', 'UQ'])
      expect(screen.getByText(badge)).toBeInTheDocument();
  });

  test('shows only the badges that apply', () => {
    row(column({ notNull: true }));
    expect(screen.getByText('NN')).toBeInTheDocument();
    expect(screen.queryByText('PK')).not.toBeInTheDocument();
    expect(screen.queryByText('UQ')).not.toBeInTheDocument();
  });

  test('shows the default as a chip', () => {
    row(column({ default: 'now()' }));
    expect(screen.getByTitle('Default')).toHaveTextContent('= now()');
  });

  test('a default that is an empty-looking value is still shown, and no default is not', () => {
    row(column({ default: "''::text" }));
    expect(screen.getByTitle('Default')).toHaveTextContent("= ''::text");
  });

  test('shows where each foreign key points', () => {
    row(column({ references: ['orgs.id', 'billing.accounts.id'] }));
    expect(
      screen.getAllByTitle('Foreign key').map((e) => e.textContent),
    ).toEqual(['→ orgs.id', '→ billing.accounts.id']);
  });
});

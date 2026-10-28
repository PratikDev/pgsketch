import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, expect, test } from 'vitest';
import { ColumnRow } from './ColumnRow';
import type { ColumnView } from './model-view';
import type { ObjectState } from './object-state';

const column = (over: Partial<ColumnView> = {}): ColumnView => ({
  id: 'c',
  name: 'email',
  type: 'text',
  primaryKey: false,
  notNull: false,
  identity: false,
  unique: false,
  default: null,
  references: [],
  state: { status: null, error: null, readOnly: null },
  ...over,
});

const row = (c: ColumnView) =>
  render(
    <ReactFlowProvider>
      <ul>
        <ColumnRow column={c} />
      </ul>
    </ReactFlowProvider>,
  );

describe('ColumnRow', () => {
  test('shows the name and type, and nothing else for a plain column', () => {
    row(column());
    expect(screen.getByText('email')).toBeInTheDocument();
    expect(screen.getByText('text')).toBeInTheDocument();
    for (const badge of ['PK', 'NN', 'UQ'])
      expect(screen.getByText(badge)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTitle(/^Default/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/^Foreign key/)).not.toBeInTheDocument();
  });

  test('shows each of primary key, NOT NULL and unique as on when it applies', () => {
    row(column({ primaryKey: true, notNull: true, unique: true }));
    for (const badge of ['PK', 'NN', 'UQ'])
      expect(screen.getByText(badge)).toHaveAttribute('aria-pressed', 'true');
  });

  test('shows only the badges that apply as on', () => {
    row(column({ notNull: true }));
    expect(screen.getByText('NN')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('PK')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('UQ')).toHaveAttribute('aria-pressed', 'false');
  });

  test('shows the default as a chip', () => {
    row(column({ default: 'now()' }));
    expect(screen.getByTitle(/^Default/)).toHaveTextContent('= now()');
  });

  test('a default that is an empty-looking value is still shown, and no default is not', () => {
    row(column({ default: "''::text" }));
    expect(screen.getByTitle(/^Default/)).toHaveTextContent("= ''::text");
  });

  test('shows where each foreign key points', () => {
    row(column({ references: ['orgs.id', 'billing.accounts.id'] }));
    expect(
      screen.getAllByTitle(/^Foreign key/).map((e) => e.textContent),
    ).toEqual(['→ orgs.id', '→ billing.accounts.id']);
  });

  describe('status', () => {
    const rowWith = (state: Partial<ObjectState>) => {
      row(
        column({
          state: { status: null, error: null, readOnly: null, ...state },
        }),
      );
      return screen.getByRole('listitem');
    };

    test('an unchanged column has no status style', () => {
      const li = rowWith({});
      expect(li).not.toHaveAttribute('data-status');
      expect(li).not.toHaveAttribute('title');
      expect(li).not.toHaveAttribute('aria-invalid');
      expect(li.className).not.toMatch(/border-l|outline|opacity/);
    });

    test('added: a green edge and tint', () => {
      const li = rowWith({ status: { status: 'added', old: {} } });
      expect(li).toHaveAttribute('data-status', 'added');
      expect(li).toHaveClass('border-l-added', 'bg-added-tint');
    });

    test('modified: amber, and the hover says what it was', () => {
      const li = rowWith({
        status: { status: 'modified', old: { type: 'varchar(100)' } },
      });
      expect(li).toHaveAttribute('data-status', 'modified');
      expect(li).toHaveClass('border-l-modified', 'bg-modified-tint');
      expect(li).toHaveAttribute('title', 'Was: type varchar(100)');
    });

    test('removed: red, struck through and faded', () => {
      const li = rowWith({ status: { status: 'removed', old: {} } });
      expect(li).toHaveAttribute('data-status', 'removed');
      expect(li).toHaveClass(
        'border-l-destructive',
        'line-through',
        'opacity-60',
      );
    });

    test('error: a red outline, and the message on hover', () => {
      const li = rowWith({ error: 'Column "id" is used twice' });
      expect(li).toHaveClass('outline-destructive');
      expect(li).toHaveAttribute('aria-invalid', 'true');
      expect(li).toHaveAttribute('title', 'Column "id" is used twice');
    });

    test('read-only: grey with a lock, and the reason on hover', () => {
      const li = rowWith({ readOnly: 'generated-column' });
      expect(li).toHaveClass('bg-muted');
      expect(screen.getByLabelText('Read-only')).toBeInTheDocument();
      expect(li).toHaveAttribute('title', 'Read-only: generated column');
    });

    test('an edit that is also read-only or in error shows all of it', () => {
      const li = rowWith({
        status: { status: 'modified', old: { notNull: false } },
        error: 'bad',
        readOnly: 'partition',
      });
      expect(li).toHaveClass('border-l-modified', 'outline-destructive');
      expect(li.getAttribute('title')).toBe(
        'bad\nRead-only: partition\nWas: nullable',
      );
    });
  });
});

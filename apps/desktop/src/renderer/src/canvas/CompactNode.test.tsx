import { render, screen } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { describe, expect, test } from 'vitest';
import { fixtureModel } from '@/test-model';
import {
  COMPACT_ZOOM,
  CompactNode,
  isCompactZoom,
  type CompactNodeType,
} from './CompactNode';
import { tableViews } from './model-view';

const show = (name: string) => {
  const data = tableViews(fixtureModel).find((t) => t.name === name)!;
  render(
    <ReactFlowProvider>
      <CompactNode {...({ data } as NodeProps<CompactNodeType>)} />
    </ReactFlowProvider>,
  );
};

describe('CompactNode', () => {
  test('shows the table name and how many columns it has, and no rows', () => {
    show('invoices');
    const node = screen.getByRole('region', { name: 'billing.invoices' });
    expect(node).toHaveTextContent('billing.invoices');
    expect(node).toHaveTextContent('3 columns');
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.queryByText('user_id')).not.toBeInTheDocument();
  });

  test('says "1 column" for one, and "0 columns" for none', () => {
    const base = tableViews(fixtureModel)[0]!;
    for (const [columns, text] of [
      [base.columns.slice(0, 1), '1 column'],
      [[], '0 columns'],
    ] as const) {
      const { unmount } = render(
        <ReactFlowProvider>
          <CompactNode
            {...({
              data: { ...base, columns: [...columns] },
            } as NodeProps<CompactNodeType>)}
          />
        </ReactFlowProvider>,
      );
      expect(screen.getByText(text)).toBeInTheDocument();
      unmount();
    }
  });
});

describe('the zoom at which tables turn compact', () => {
  test('is below 70%, and not at it', () => {
    expect(COMPACT_ZOOM).toBe(0.7);
    expect(isCompactZoom(0.69)).toBe(true);
    expect(isCompactZoom(0.1)).toBe(true);
    expect(isCompactZoom(0.7)).toBe(false);
    expect(isCompactZoom(1)).toBe(false);
    expect(isCompactZoom(2)).toBe(false);
  });
});

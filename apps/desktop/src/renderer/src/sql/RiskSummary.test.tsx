import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Risk } from '@pgsketch/core';
import { describe, expect, test } from 'vitest';
import { RiskSummary } from './RiskSummary';

const risks: Risk[] = [
  { level: 'destructive', message: 'Drops column "total", and its data' },
  {
    level: 'may-fail',
    message: 'Setting NOT NULL on "email" fails if any row is null',
  },
  {
    level: 'may-fail',
    message: 'Adding a unique constraint on "slug" fails on duplicates',
  },
  { level: 'locks', message: 'Creating an index on "events" locks writes' },
];

describe('RiskSummary', () => {
  test('counts the risks by kind, in a fixed order', () => {
    render(<RiskSummary risks={risks} />);
    expect(
      within(screen.getByRole('list', { name: 'Risks' }))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['1 destructive', '2 may fail', '1 locks or slow']);
  });

  test('says so when there are none', () => {
    render(<RiskSummary risks={[]} />);
    expect(screen.getByText('No risks found.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('a count opens into what it is about, and shuts again; each by itself', async () => {
    render(<RiskSummary risks={risks} />);
    expect(screen.queryByText(/Drops column/)).not.toBeInTheDocument();
    const may = screen.getByRole('button', { name: '2 may fail' });
    expect(may).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(may);
    expect(may).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('list', { name: 'Risks: may fail' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Setting NOT NULL on "email" fails if any row is null',
      'Adding a unique constraint on "slug" fails on duplicates',
    ]);
    // the others stay shut
    expect(screen.queryByText(/Drops column/)).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: '1 destructive' }),
    );
    expect(screen.getByText(/Drops column "total"/)).toBeInTheDocument();
    expect(
      screen.getByRole('list', { name: 'Risks: may fail' }),
    ).toBeInTheDocument();

    await userEvent.click(may);
    expect(
      screen.queryByRole('list', { name: 'Risks: may fail' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Drops column "total"/)).toBeInTheDocument();
  });
});

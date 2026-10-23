import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import App from '@/App';

test('renders the placeholder App', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: 'pgsketch' })).toBeInTheDocument();
});

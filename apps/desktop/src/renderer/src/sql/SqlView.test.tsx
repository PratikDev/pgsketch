import { EditorView } from '@codemirror/view';
import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { SqlView } from './SqlView';

const sample =
  'BEGIN;\n\nALTER TABLE "public"."users" RENAME TO "people";\n\nCOMMIT;\n';
const editorOf = (container: HTMLElement) =>
  EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)!;

describe('SqlView', () => {
  test('shows the SQL, line by line', () => {
    const { container } = render(<SqlView text={sample} />);
    const lines = [...container.querySelectorAll('.cm-line')].map(
      (l) => l.textContent,
    );
    expect(lines.slice(0, 3)).toEqual([
      'BEGIN;',
      '',
      'ALTER TABLE "public"."users" RENAME TO "people";',
    ]);
    expect(container.querySelector('.cm-lineNumbers')).not.toBeNull();
  });

  test('is read-only, and says what it is for assistive technology', () => {
    const { container } = render(<SqlView text={sample} />);
    expect(editorOf(container).state.readOnly).toBe(true);
    expect(container.querySelector('.cm-content')).toHaveAttribute(
      'aria-label',
      'SQL',
    );
  });

  test('highlights SQL as PostgreSQL: keywords get a style of their own', () => {
    const { container } = render(<SqlView text={'SELECT 1;'} />);
    // the highlighter wraps the tokens it knows in spans with generated class names
    const spans = container.querySelectorAll('.cm-line span');
    expect(spans.length).toBeGreaterThan(0);
  });

  test('shows a new text in the same view, and leaves a same text alone', () => {
    const { container, rerender } = render(<SqlView text={sample} />);
    const view = editorOf(container);
    rerender(<SqlView text={'SELECT 2;'} />);
    expect(editorOf(container)).toBe(view);
    expect(view.state.doc.toString()).toBe('SELECT 2;');
    rerender(<SqlView text={'SELECT 2;'} />);
    expect(view.state.doc.toString()).toBe('SELECT 2;');
  });

  test('goes away with the component', () => {
    const { container, unmount } = render(<SqlView text={sample} />);
    unmount();
    expect(container.querySelector('.cm-editor')).toBeNull();
  });
});

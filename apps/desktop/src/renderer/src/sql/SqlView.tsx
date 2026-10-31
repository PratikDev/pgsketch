import { sql, PostgreSQL } from '@codemirror/lang-sql';
import {
  defaultHighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { useEffect, useRef } from 'react';

const theme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    backgroundColor: 'var(--card)',
    color: 'var(--card-foreground)',
  },
  '.cm-scroller': { fontFamily: 'ui-monospace, monospace' },
  '.cm-gutters': {
    backgroundColor: 'var(--muted)',
    color: 'var(--muted-foreground)',
    border: 'none',
  },
  '&.cm-focused': { outline: 'none' },
});

/** SQL to read, with PostgreSQL highlighting and line numbers. It can be selected and copied, not changed. */
export function SqlView({ text }: { text: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: text,
        extensions: [
          sql({ dialect: PostgreSQL }),
          syntaxHighlighting(defaultHighlightStyle),
          lineNumbers(),
          EditorState.readOnly.of(true),
          EditorView.contentAttributes.of({ 'aria-label': 'SQL' }),
          theme,
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // the view is made once; a new text replaces what is in it, below
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === text) return;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: text },
    });
  }, [text]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}

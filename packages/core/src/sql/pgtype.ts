import type { PgType } from '../model/types';
import { quoteIdent } from './quote';

// `format_type` spells these out; the model uses the short names the type picker offers.
const SHORT_NAMES: Record<string, string> = {
  'character varying': 'varchar',
  character: 'bpchar',
  'timestamp without time zone': 'timestamp',
  'timestamp with time zone': 'timestamptz',
  'time without time zone': 'time',
  'time with time zone': 'timetz',
  'bit varying': 'varbit',
};

// A built-in name is emitted unquoted, so it must be plain lowercase words (or the "char" type).
const BUILTIN_NAME = /^(?:"char"|[a-z][a-z0-9_]*(?: [a-z][a-z0-9_]*)*)$/;
const BUILTIN =
  /^([a-z"][a-z0-9_" ]*?)(?:\((\d+(?:,\d+)*)\))?((?: with(?:out)? time zone)?)$/;
const PARAMS = /^\((\d+(?:,\d+)*)\)$/;

function readIdent(text: string, start: number): [string, number] {
  if (text[start] !== '"') {
    const word = /^[^".([\s]+/.exec(text.slice(start))?.[0];
    if (!word) throw new Error(`Cannot parse type: ${text}`);
    return [word, start + word.length];
  }
  let name = '';
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] !== '"') name += text[i];
    else if (text[i + 1] === '"') name += text[++i];
    else return [name, i + 1];
  }
  throw new Error(`Cannot parse type: ${text}`);
}

const toParams = (list: string | undefined) =>
  list ? { params: list.split(',').map(Number) } : {};

/**
 * Parses `format_type` output. Type modifiers that aren't integers (PostGIS `geometry(Point,4326)`)
 * can't be represented in `PgType`, so they throw; callers should treat that column as read-only.
 */
export function parsePgType(text: string): PgType {
  const isArray = text.endsWith('[]');
  const body = text.trim().replace(/(\[\])+$/, '');
  const [first, end] = readIdent(body, 0);

  if (body[end] === '.') {
    const [name, afterName] = readIdent(body, end + 1);
    const tail = body.slice(afterName);
    const params = tail === '' ? undefined : PARAMS.exec(tail)?.[1];
    if (tail !== '' && !params) throw new Error(`Cannot parse type: ${text}`);
    return { name, schema: first, ...toParams(params), isArray };
  }

  const m = BUILTIN.exec(body);
  if (!m) throw new Error(`Cannot parse type: ${text}`);
  const full = `${m[1]}${m[3]}`;
  return { name: SHORT_NAMES[full] ?? full, ...toParams(m[2]), isArray };
}

export function renderPgType(type: PgType): string {
  if (type.schema === undefined && !BUILTIN_NAME.test(type.name)) {
    throw new Error(`Invalid built-in type name: ${type.name}`);
  }
  if (type.params?.some((p) => !Number.isInteger(p) || p < 0)) {
    throw new Error(`Invalid type parameters: ${type.params.join(',')}`);
  }
  const name =
    type.schema === undefined
      ? type.name
      : `${quoteIdent(type.schema)}.${quoteIdent(type.name)}`;
  const params = type.params?.length ? `(${type.params.join(',')})` : '';
  return `${name}${params}${type.isArray ? '[]' : ''}`;
}

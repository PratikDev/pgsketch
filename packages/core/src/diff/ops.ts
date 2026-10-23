import type { ValidationError } from '../model/errors';
import type {
  Column,
  Constraint,
  DefaultValue,
  Id,
  Index,
  PgType,
  Schema,
  Table,
} from '../model/types';

export type CommentTarget =
  { kind: 'table'; tableId: Id } | { kind: 'column'; columnId: Id };

/** One change to make to the database. There is nothing here for enums, schema renames, table moves or identity toggles: the editor can't produce them. */
export type ChangeOp =
  | { kind: 'createSchema'; schema: Schema }
  | { kind: 'createTable'; table: Table; columns: Column[]; pk?: Constraint }
  | { kind: 'renameTable'; tableId: Id; from: string; to: string }
  | { kind: 'dropTable'; table: Table }
  | { kind: 'addColumn'; column: Column } // may include identity on new columns
  | { kind: 'renameColumn'; columnId: Id; from: string; to: string }
  | { kind: 'alterColumnType'; columnId: Id; from: PgType; to: PgType }
  | { kind: 'setNotNull' | 'dropNotNull'; columnId: Id }
  | { kind: 'setDefault'; columnId: Id; to: DefaultValue }
  | { kind: 'dropDefault'; columnId: Id }
  | { kind: 'dropColumn'; column: Column }
  | { kind: 'addConstraint'; constraint: Constraint }
  | { kind: 'renameConstraint'; constraintId: Id; from: string; to: string }
  | { kind: 'dropConstraint'; constraint: Constraint }
  | { kind: 'addIndex'; index: Index }
  | { kind: 'renameIndex'; indexId: Id; from: string; to: string }
  | { kind: 'dropIndex'; index: Index }
  | { kind: 'setComment'; target: CommentTarget; to: string | null };

/** What one part of the diff found: the changes, and edits that must block generation. */
export interface DiffPart {
  ops: ChangeOp[];
  errors: ValidationError[];
}

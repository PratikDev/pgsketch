export type Id = string;

/** Why an object is read-only: shown in the UI on hover and never modified or recreated. */
export type ReadOnlyReason =
  // tables
  | 'partitioned-table'
  | 'partition'
  // columns
  | 'generated-column'
  | 'nextval-default'
  | 'not-null-not-valid'
  | 'not-null-no-inherit'
  // constraints
  | 'deferrable'
  | 'not-valid'
  | 'no-inherit'
  | 'match-full'
  | 'exclusion'
  // indexes
  | 'partial-index'
  | 'expression-index'
  | 'non-btree-index'
  | 'desc-index'
  | 'include-index'
  | 'opclass-index'
  | 'storage-options-index'
  | 'nulls-not-distinct-index';

export interface PgType {
  name: string;
  schema?: string;
  params?: number[];
  isArray: boolean;
}

/** `expression` is always the database-normalized SQL text. */
export type DefaultValue =
  | { kind: 'preset'; preset: string; expression: string }
  | { kind: 'constant'; expression: string }
  | { kind: 'expression'; expression: string };

export interface Schema {
  id: Id;
  name: string;
}

export interface Table {
  id: Id;
  schemaId: Id;
  name: string;
  comment: string | null;
  readOnly?: ReadOnlyReason;
}

export interface Column {
  id: Id;
  tableId: Id;
  name: string;
  position: number;
  type: PgType;
  notNull: boolean;
  default: DefaultValue | null;
  identity: 'always' | 'byDefault' | null;
  comment: string | null;
  readOnly?: ReadOnlyReason;
}

export type FkAction =
  'no action' | 'restrict' | 'cascade' | 'set null' | 'set default';

interface ConstraintBase {
  id: Id;
  tableId: Id;
  name: string;
  /** Created in the editor, so its name is recomputed until the migration is applied. */
  autoName?: boolean;
  /** Local columns; for checks, the columns the expression references. */
  columnIds: Id[];
  readOnly?: ReadOnlyReason;
  /** `pg_get_constraintdef` text, kept for read-only constraints. */
  definition?: string;
}

export type Constraint =
  | (ConstraintBase & { kind: 'pk' })
  | (ConstraintBase & { kind: 'unique' })
  | (ConstraintBase & { kind: 'check'; expression: string })
  | (ConstraintBase & {
      kind: 'fk';
      refTableId: Id;
      refColumnIds: Id[];
      onDelete: FkAction;
      onUpdate: FkAction;
    })
  | (ConstraintBase & { kind: 'exclusion' });

export interface Index {
  id: Id;
  tableId: Id;
  name: string;
  autoName?: boolean;
  unique: boolean;
  /** Key columns in order; for read-only indexes, the columns the index references. */
  columnIds: Id[];
  readOnly?: ReadOnlyReason;
  /** `pg_get_indexdef` text, kept for read-only indexes. */
  definition?: string;
}

export interface EnumType {
  id: Id;
  schemaId: Id;
  name: string;
  labels: string[];
}

export type UnmodeledKind =
  | 'view'
  | 'materialized-view'
  | 'foreign-table'
  | 'sequence'
  | 'trigger'
  | 'function'
  | 'policy';

export interface UnmodeledObject {
  id: Id;
  kind: UnmodeledKind;
  /** Null for triggers and policies, which belong to a table. */
  schemaId: Id | null;
  name: string;
  tableIds: Id[];
  columnIds: Id[];
}

export interface SchemaModel {
  schemas: Record<Id, Schema>;
  tables: Record<Id, Table>;
  columns: Record<Id, Column>;
  constraints: Record<Id, Constraint>;
  indexes: Record<Id, Index>;
  enums: Record<Id, EnumType>;
  unmodeled: Record<Id, UnmodeledObject>;
}

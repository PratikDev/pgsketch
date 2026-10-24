import type { Id } from './types';

export type ValidationCode =
  | 'name-empty'
  | 'name-too-long'
  | 'name-duplicate'
  | 'missing-schema'
  | 'missing-column'
  | 'missing-ref-table'
  | 'multiple-primary-keys'
  | 'pk-nullable'
  | 'identity-nullable'
  | 'identity-default'
  | 'fk-column-count'
  | 'fk-no-target'
  | 'fk-type-mismatch'
  | 'invalid-type-params'
  // found while diffing: edits the editor should never produce
  | 'schema-changed'
  | 'table-schema-changed'
  | 'column-identity-changed'
  | 'read-only-dependency'
  | 'read-only-changed';

/** `objectId` is the object the error is shown on. */
export interface ValidationError {
  code: ValidationCode;
  objectId: Id;
  message: string;
}

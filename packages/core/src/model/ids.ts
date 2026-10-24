import type { Id, UnmodeledKind } from './types';

export type Oid = number | string;

// Core runs in both the renderer and Node, so it uses the global rather than `node:crypto`.
declare const crypto: { randomUUID(): string };

export const schemaId = (oid: Oid): Id => `s:${oid}`;
export const tableId = (oid: Oid): Id => `t:${oid}`;
export const columnId = (tableOid: Oid, attnum: number): Id =>
  `c:${tableOid}:${attnum}`;
export const constraintId = (oid: Oid): Id => `k:${oid}`;
export const indexId = (oid: Oid): Id => `i:${oid}`;
export const enumId = (oid: Oid): Id => `e:${oid}`;
// Prefixed with the kind because the OIDs come from different catalogs (pg_proc, pg_trigger, ...).
export const unmodeledId = (kind: UnmodeledKind, oid: Oid): Id =>
  `u:${kind}:${oid}`;

/** IDs for objects created in the editor, never derived from the database. */
export const newId = (): Id => crypto.randomUUID();

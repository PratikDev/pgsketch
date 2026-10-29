import type { Id } from '@pgsketch/core';
import type { StateCreator } from 'zustand';
import type { SchemaStore } from '.';
import { firstFree } from './helpers';

export interface SchemasSlice {
  /** A schema that the migration creates, named `new_schema`, `new_schema_2`, … Returns its id. */
  addSchema: () => Id;
  /** Renames a schema that the migration creates; one in the database keeps its name. */
  renameSchema: (schemaId: Id, name: string) => string | null;
  /** Removes a schema that the migration creates, if no table is in it. */
  removeSchema: (schemaId: Id) => string | null;
  /**
   * Moves a table to another schema. Only a table the migration creates can move: a table in the
   * database stays where it is, so for that one this says why not.
   */
  setTableSchema: (tableId: Id, schemaId: Id) => string | null;
}

export const createSchemasSlice: StateCreator<
  SchemaStore,
  [],
  [],
  SchemasSlice
> = (_, get) => ({
  addSchema: () => {
    const id = crypto.randomUUID();
    get().edit((d) => {
      d.schemas[id] = {
        id,
        name: firstFree(
          'new_schema',
          Object.values(d.schemas).map((s) => s.name),
        ),
      };
    });
    return id;
  },

  renameSchema: (schemaId, name) => {
    const { baseline, desired, edit } = get();
    const schema = desired.schemas[schemaId];
    if (!schema) return null;
    if (baseline.schemas[schemaId])
      return `Can't rename schema "${schema.name}": it is already in the database, and only new schemas can be renamed`;
    edit((d) => {
      const pending = d.schemas[schemaId];
      if (pending) pending.name = name;
    });
    return null;
  },

  removeSchema: (schemaId) => {
    const { baseline, desired, edit } = get();
    const schema = desired.schemas[schemaId];
    if (!schema) return null;
    if (baseline.schemas[schemaId])
      return `Can't delete schema "${schema.name}": it is already in the database, and only new schemas can be deleted`;
    const inside = Object.values(desired.tables)
      .filter((t) => t.schemaId === schemaId)
      .map((t) => `"${t.name}"`);
    if (inside.length > 0)
      return `Can't delete schema "${schema.name}": table ${inside.join(', ')} ${inside.length === 1 ? 'is' : 'are'} in it`;
    edit((d) => void delete d.schemas[schemaId]);
    return null;
  },

  setTableSchema: (tableId, schemaId) => {
    const { baseline, desired, edit } = get();
    const table = desired.tables[tableId];
    if (!table || !desired.schemas[schemaId]) return null;
    if (baseline.tables[tableId])
      return `Can't move table "${table.name}" to another schema: it is already in the database, and only new tables can move`;
    edit((d) => {
      const pending = d.tables[tableId];
      if (pending) pending.schemaId = schemaId;
    });
    return null;
  },
});

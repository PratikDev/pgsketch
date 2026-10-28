import type { SchemaModel } from '@pgsketch/core';
import { fixtureModel as coreFixture } from '../../../../../packages/core/test/fixtures/model';

/** The model every core test starts from: two schemas, a cross-schema FK, a view and one object of each read-only kind. */
export const fixtureModel: SchemaModel = coreFixture;

import fc from 'fast-check';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  applyIntents,
  editIntentsArb,
  schemaDraftArb,
  schemaSql,
} from './arbitraries';
import { startPostgres, type TestPostgres } from './pg';
import { roundTrip } from './roundtrip';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startPostgres();
});

afterAll(async () => {
  await pg?.stop();
});

const RUNS = Number(process.env.PGSKETCH_PROPERTY_RUNS ?? 200);
// a failure prints its seed and path; set both to run just that case again
const replay = process.env.PGSKETCH_PROPERTY_SEED
  ? {
      seed: Number(process.env.PGSKETCH_PROPERTY_SEED),
      path: process.env.PGSKETCH_PROPERTY_PATH,
    }
  : {};

test(
  `every generated edit round-trips (${RUNS} runs)`,
  async () => {
    await fc.assert(
      fc.asyncProperty(
        schemaDraftArb,
        editIntentsArb,
        async (draft, intents) => {
          const { difference, migration } = await roundTrip(
            pg,
            schemaSql(draft),
            (desired, baseline) => applyIntents(desired, intents, baseline),
          );
          expect(difference, migration.text).toBeNull();
        },
      ),
      { numRuns: RUNS, ...replay },
    );
  },
  // about half a second a run, and shrinking a failure takes many more
  Math.max(RUNS * 2_000, 120_000),
);

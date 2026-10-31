import { expect, type Page } from '@playwright/test';
import { startE2eServer } from './server';

/** The scale React Flow draws the canvas at, from the transform on its viewport. */
export const zoomOf = async (window: Page) =>
  Number(
    /scale\(([\d.]+)\)/.exec(
      (await window.locator('.react-flow__viewport').getAttribute('style')) ??
        '',
    )?.[1],
  );

/** Zooms with the canvas controls until the tables are (or are not) compact; the fit on load can land either side of 70%. */
export async function zoomUntil(window: Page, compact: boolean) {
  const button = window.getByRole('button', {
    name: compact ? 'zoom out' : 'zoom in',
  });
  while ((await zoomOf(window)) < 0.7 !== compact) {
    await button.click();
    await window.waitForTimeout(350);
  }
}

/** Where the canvas has a table, which unlike its place on screen does not depend on the zoom. */
export const spot = (window: Page, table: string) =>
  window
    .locator('.react-flow__node', {
      has: window.getByRole('region', { name: table }),
    })
    .evaluate((node) => node.style.transform);

/** The row of a column in a table, at a zoom where tables are not compact. */
export const rowOf = (window: Page, table: string, column: string) =>
  window
    .getByRole('region', { name: table })
    .getByRole('listitem')
    .filter({ has: window.getByRole('button', { name: column, exact: true }) });

/**
 * Brings a table into view at a readable zoom. Zooming in with the controls goes towards the
 * middle and can push a table off screen, so this fits all the tables in the view first and then
 * clicks the table's compact node, which zooms to exactly that table.
 */
export async function showTable(window: Page, table: string) {
  await window.getByRole('button', { name: 'fit view' }).click();
  await window.waitForTimeout(400);
  if ((await zoomOf(window)) < 0.7)
    await window.getByRole('region', { name: table }).click();
  await expect.poll(() => zoomOf(window)).toBeGreaterThanOrEqual(0.7);
  await expect(
    window.getByRole('region', { name: table }).getByRole('listitem').first(),
  ).toBeVisible();
}

/** A server of its own with one table to edit, for the tests that change the database from outside. */
export async function startScratchServer(columns = 'a text, b text') {
  const extra = await startE2eServer();
  await extra.admin.query(
    `CREATE TABLE public.scratch (id integer PRIMARY KEY, ${columns})`,
  );
  return extra;
}

export const changes = (window: Page, n: number) =>
  window.getByText(n === 1 ? '1 change' : `${n} changes`, { exact: true });

export const toastWith = (window: Page, text: string) =>
  window.locator('[data-sonner-toast]').filter({ hasText: text });

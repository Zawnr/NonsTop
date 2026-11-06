// Blocks move and indent from the block menu, on the laptop (hover) and on touch screens (tap).
import { expect, test, type Page } from '@playwright/test';
import { createPage, login, unique } from './helpers.ts';

const isPhone = () => test.info().project.name === 'android';

/** Opens the block menu of the block with this text. A tap shows the side menu on touch screens. */
async function openBlockMenu(page: Page, text: string) {
  const block = page.getByTestId('editor').getByText(text, { exact: true });
  if (isPhone()) await block.tap();
  else await block.hover();
  const handle = page.getByRole('button', { name: 'Open block menu' });
  if (isPhone()) await handle.tap();
  else await handle.click();
  await expect(page.getByRole('menuitem', { name: 'Naikkan' })).toBeVisible();
}

async function pick(page: Page, item: string) {
  const entry = page.getByRole('menuitem', { name: item });
  if (isPhone()) await entry.tap();
  else await entry.click();
}

/** Top-level block texts in order, and the texts nested one level below a block. */
const topLevel = (page: Page) =>
  page.getByTestId('editor').locator('.bn-block-group:not(.bn-block-group .bn-block-group) > .bn-block-outer > .bn-block > .bn-block-content').allInnerTexts();
const childrenOf = (page: Page, text: string) =>
  page
    .getByTestId('editor')
    .locator('.bn-block', { has: page.locator(':scope > .bn-block-content', { hasText: text }) })
    .locator(':scope > .bn-block-group > .bn-block-outer > .bn-block > .bn-block-content')
    .allInnerTexts();

test('block menu: move up and down, indent and outdent', async ({ page }) => {
  await login(page);
  await createPage(page, unique('Urut'));
  await page.getByTestId('editor').locator('[contenteditable="true"]').click();
  const [a, b, c] = ['Alfa satu', 'Beta dua', 'Gama tiga'];
  for (const t of [a, b, c]) {
    await page.keyboard.insertText(t);
    if (t !== c) await page.keyboard.press('Enter');
  }
  await expect.poll(() => topLevel(page)).toEqual([a, b, c]);

  await openBlockMenu(page, c);
  await pick(page, 'Naikkan');
  await expect.poll(() => topLevel(page)).toEqual([a, c, b]);

  await openBlockMenu(page, b);
  await pick(page, 'Masuk (indent)');
  await expect.poll(() => childrenOf(page, c)).toEqual([b]);
  await expect.poll(() => topLevel(page)).toEqual([a, c]);

  await openBlockMenu(page, b);
  await pick(page, 'Keluar (outdent)');
  await expect.poll(() => topLevel(page)).toEqual([a, c, b]);

  await openBlockMenu(page, a);
  await pick(page, 'Turunkan');
  await expect.poll(() => topLevel(page)).toEqual([c, a, b]);

  // The order is stored: it survives a reload.
  await page.waitForTimeout(600);
  await page.reload();
  await expect.poll(() => topLevel(page)).toEqual([c, a, b]);
});

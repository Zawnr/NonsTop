// Shared steps for database tests.
import { expect, type Locator, type Page } from '@playwright/test';
import { openNav, opensNewPage, setTitle } from './helpers.ts';

/** Creates a full-page database from the sidebar and gives it a title. Returns its page id. */
export async function createDatabase(page: Page, title: string): Promise<string> {
  const id = await opensNewPage(page, async () => {
    await openNav(page);
    await page.getByRole('complementary').getByRole('button', { name: '+ Database baru' }).click();
  });
  await setTitle(page, title);
  return id;
}

export const table = (page: Page) => page.getByRole('table').first();

/** Adds a property through the "+" column header. */
export async function addProperty(page: Page, type: string, name: string, target?: string) {
  await table(page).getByRole('button', { name: 'Properti baru' }).click();
  const pop = page.getByRole('dialog', { name: 'Properti baru' });
  await pop.getByRole('button', { name: type, exact: true }).click();
  await pop.getByLabel(/Nama properti/).fill(name);
  if (target) await pop.getByLabel('Database tujuan').selectOption({ label: target });
  await pop.getByRole('button', { name: 'Tambah' }).click();
  await expect(table(page).getByRole('columnheader', { name, exact: true })).toBeVisible();
}

/** Adds a row from the table: "+ Baris baru" adds it in place with its title open for typing.
 *  Returns the row's page id, read from its open link. */
export async function addRow(page: Page, title: string): Promise<string> {
  const before = page.url();
  await page.getByRole('button', { name: '+ Baris baru' }).click();
  const input = table(page).getByRole('textbox', { name: 'Judul baris Tanpa judul' });
  await expect(input).toBeFocused();
  await input.fill(title);
  await input.press('Enter');
  await expect(table(page).getByRole('button', { name: `Judul baris ${title}` })).toBeVisible();
  await expect(page).toHaveURL(before);
  await table(page).getByRole('button', { name: `Buka ${title}`, exact: true }).click();
  await expect(page).toHaveURL(/\/p\//);
  await expect(page.getByLabel('Judul halaman')).toHaveValue(title);
  const id = page.url().split('/p/')[1]!;
  await page.goBack();
  await expect(page).toHaveURL(before);
  return id;
}

/** The cell button of a property in a row. */
export const cell = (scope: Page | Locator, prop: string, row: string) => scope.getByRole('button', { name: `${prop}: ${row}`, exact: true });

export async function fillCell(page: Page, prop: string, row: string, text: string) {
  await cell(page, prop, row).click();
  const input = page.getByRole('textbox', { name: `${prop}: ${row}`, exact: true });
  await input.fill(text);
  await input.press('Enter');
}

export async function pickOption(page: Page, prop: string, row: string, option: string, create = false) {
  await cell(page, prop, row).click();
  const pop = page.getByRole('dialog', { name: `${prop}: ${row}` });
  if (create) {
    await pop.getByLabel('Cari opsi').fill(option);
    await pop.getByLabel('Cari opsi').press('Enter');
  } else {
    await pop.getByRole('option', { name: option }).click();
  }
  await expect(pop.getByRole('option', { name: option })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
}


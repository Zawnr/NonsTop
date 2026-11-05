import { expect, test, type Page } from '@playwright/test';
import { addProperty, addRow, cell, createDatabase, fillCell, pickOption, table } from './database-helpers.ts';
import { createPage, login, openNav, opensNewPage, unique } from './helpers.ts';

const isPhone = () => test.info().project.name === 'android';

async function addView(page: Page, type: 'Tabel' | 'Board' | 'List') {
  await page.getByRole('button', { name: 'View baru' }).click();
  await page.getByRole('dialog', { name: 'View baru' }).getByRole('button', { name: new RegExp(type) }).click();
}

/** Titles of the table rows, in display order. */
const rowTitles = (page: Page) => table(page).locator('button[aria-label^="Judul baris"]').allInnerTexts();

test('board: cards move between status columns by drag or menu, and new cards join their column', async ({ page }) => {
  await login(page);
  await createDatabase(page, unique('Board'));
  await addProperty(page, 'Status', 'Status');
  const a = unique('Kartu A');
  const b = unique('Kartu B');
  await addRow(page, a);
  await addRow(page, b);
  await addView(page, 'Board');

  const board = page.getByRole('list', { name: 'Board menurut Status' });
  const col = (name: string) => board.getByRole('listitem', { name: `Kolom ${name}` });
  const card = (title: string) => board.getByRole('group', { name: `Kartu ${title}` });
  await expect(col('Tanpa Status').getByRole('group')).toHaveCount(2);
  await expect(col('Belum mulai')).toBeVisible();

  // The menu works everywhere, which matters on small touch screens.
  await card(a).getByRole('button', { name: `Pindah ${a}` }).click();
  await page.getByRole('dialog', { name: `Pindah ${a}` }).getByRole('button', { name: 'Dikerjakan' }).click();
  await expect(col('Dikerjakan').getByRole('group', { name: `Kartu ${a}` })).toBeVisible();

  if (isPhone()) {
    await card(b).getByRole('button', { name: `Pindah ${b}` }).click();
    await page.getByRole('dialog', { name: `Pindah ${b}` }).getByRole('button', { name: 'Selesai' }).click();
  } else {
    const from = (await card(b).boundingBox())!;
    const to = (await col('Selesai').boundingBox())!;
    await page.mouse.move(from.x + 3, from.y + 3);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y + 10, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height - 10, { steps: 10 });
    await page.mouse.up();
  }
  await expect(col('Selesai').getByRole('group', { name: `Kartu ${b}` })).toBeVisible();

  // A card added in a column gets that column's status and opens its title for typing.
  await col('Belum mulai').getByRole('button', { name: 'Kartu baru di Belum mulai' }).click();
  const title = board.getByRole('textbox', { name: 'Judul kartu Tanpa judul' });
  await expect(title).toBeFocused();
  const c = unique('Kartu C');
  await title.fill(c);
  await title.press('Enter');
  await expect(col('Belum mulai').getByRole('group', { name: `Kartu ${c}` })).toBeVisible();

  // The table view shows the same values.
  await page.getByRole('tab', { name: /Tabel/ }).click();
  await expect(cell(page, 'Status', a)).toHaveText('Dikerjakan');
  await expect(cell(page, 'Status', b)).toHaveText('Selesai');
  await expect(cell(page, 'Status', c)).toHaveText('Belum mulai');
});

test('views: each view keeps its own filters, sorts, groups and visible properties', async ({ page }) => {
  await login(page);
  await createDatabase(page, unique('Saring'));
  await addProperty(page, 'Angka', 'Poin');
  await addProperty(page, 'Status', 'Status');
  const [x1, x2, x3] = [unique('Satu'), unique('Dua'), unique('Tiga')];
  for (const [row, n] of [[x1, '5'], [x2, '1'], [x3, '9']] as const) {
    await addRow(page, row);
    await fillCell(page, 'Poin', row, n);
  }
  await pickOption(page, 'Status', x2, 'Selesai');

  // Filter: Poin > 2.
  await page.getByRole('button', { name: /^Filter/ }).click();
  let pop = page.getByRole('dialog', { name: 'Filter' });
  await pop.getByRole('button', { name: '+ Tambah filter' }).click();
  await pop.getByLabel('Properti filter 1').selectOption({ label: 'Poin' });
  await pop.getByLabel('Operator filter 1').selectOption({ label: '>' });
  await pop.getByLabel('Nilai filter 1').fill('2');
  await pop.getByLabel('Nilai filter 1').press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.getByText('2 dari 3 baris')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filter (1)' })).toBeVisible();

  // Sort: Poin descending.
  await page.getByRole('button', { name: /^Urutkan/ }).click();
  pop = page.getByRole('dialog', { name: 'Urutkan' });
  await pop.getByRole('button', { name: '+ Tambah urutan' }).click();
  await pop.getByLabel('Properti urutan 1').selectOption({ label: 'Poin' });
  await pop.getByLabel('Arah urutan 1').selectOption('desc');
  await page.keyboard.press('Escape');
  await expect.poll(() => rowTitles(page)).toEqual([x3, x1]);

  // Hide a property in this view only.
  await page.getByRole('button', { name: /^Properti($| \()/ }).click();
  await page.getByRole('dialog', { name: 'Properti tampil' }).getByRole('checkbox', { name: 'Catatan' }).uncheck();
  await page.keyboard.press('Escape');
  await expect(table(page).getByRole('columnheader', { name: 'Catatan' })).toHaveCount(0);

  // A second view starts clean, then groups by status.
  await addView(page, 'Tabel');
  await expect(page.getByText('3 baris', { exact: true })).toBeVisible();
  await expect(table(page).getByRole('columnheader', { name: 'Catatan' })).toBeVisible();
  await page.getByRole('button', { name: /^Grup/ }).click();
  await page.getByRole('dialog', { name: 'Grup' }).getByLabel('Kelompokkan menurut').selectOption({ label: 'Status' });
  await page.keyboard.press('Escape');
  await expect(table(page).locator('.group-row')).toHaveText([/Tanpa Status\s*2/, /Belum mulai\s*0/, /Dikerjakan\s*0/, /Selesai\s*1/]);

  // Kept after reload.
  await page.waitForTimeout(400);
  await page.reload();
  await page.getByRole('tab', { name: /Tabel/ }).first().click();
  await expect(page.getByText('2 dari 3 baris')).toBeVisible();
  await expect.poll(() => rowTitles(page)).toEqual([x3, x1]);
});

test('row templates: the default template fills new rows with its title, values and content', async ({ page }) => {
  await login(page);
  await createDatabase(page, unique('Tiket'));
  await addProperty(page, 'Select', 'Jenis');

  await page.getByRole('button', { name: 'Template baris' }).click();
  await opensNewPage(page, () => page.getByRole('dialog', { name: 'Template baris' }).getByRole('button', { name: '+ Template baru' }).click());
  await expect(page.getByText(/Template baris untuk/)).toBeVisible();
  const tpl = unique('Laporan bug');
  await page.getByLabel('Judul halaman').fill(tpl);
  await page.getByLabel('Judul halaman').press('Enter');
  await pickOption(page, 'Jenis', tpl, 'Bug', true);
  const editor = page.getByTestId('editor');
  await editor.locator('[contenteditable="true"]').click();
  await page.keyboard.type('Langkah reproduksi');
  await page.getByRole('button', { name: 'Jadikan default' }).click();
  await expect(page.getByText(/\(default\)/)).toBeVisible();
  await page.waitForTimeout(400);
  await page.goBack();

  await expect(page.getByText('0 baris')).toBeVisible(); // the template is not a row
  await page.getByRole('button', { name: '+ Baris baru' }).click();
  const input = table(page).getByRole('textbox', { name: `Judul baris ${tpl}` });
  await expect(input).toBeFocused();
  await input.press('Escape');
  await expect(cell(page, 'Jenis', tpl)).toHaveText('Bug');
  await expect(page.getByText('1 baris', { exact: true })).toBeVisible();
  await table(page).getByRole('button', { name: `Buka ${tpl}`, exact: true }).click();
  await expect(page.getByTestId('editor')).toContainText('Langkah reproduksi');
  await expect(page.getByText(/Template baris untuk/)).toHaveCount(0);
});

test('page templates: built-in on an empty page, own templates from the sidebar', async ({ page }) => {
  await login(page);
  const title = unique('Liburan');
  await createPage(page, title);
  const choices = page.getByRole('region', { name: 'Mulai dari template' });
  await choices.getByRole('button', { name: /Rencana trip/ }).click();
  const editor = page.getByTestId('editor');
  await expect(editor.getByRole('heading', { name: 'Rute' })).toBeVisible();
  await expect(editor).toContainText('Pesan penginapan');
  await expect(choices).toHaveCount(0);
  await expect(page.getByLabel('Judul halaman')).toHaveValue(title);

  // Turn it into a template: it leaves the tree for the Template section.
  await page.getByRole('button', { name: 'Jadikan template' }).click();
  await openNav(page);
  const side = page.getByRole('complementary');
  await expect(side.getByRole('list', { name: 'Template' }).getByRole('link', { name: new RegExp(title) })).toBeVisible();
  await expect(side.getByRole('tree').getByRole('link', { name: title, exact: true })).toHaveCount(0);

  await side.getByRole('button', { name: 'Dari template…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Halaman dari template' });
  const before = page.url();
  await dialog.getByRole('button', { name: new RegExp(title) }).click();
  await expect(page).not.toHaveURL(before);
  await expect(page.getByLabel('Judul halaman')).toHaveValue(title);
  await expect(page.getByTestId('editor').getByRole('heading', { name: 'Rute' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Jadikan template' })).toBeVisible();
});

test('duplicate: a database page with or without rows, and an inline database', async ({ page }) => {
  await login(page);
  const name = unique('Dup');
  await createDatabase(page, name);
  await addProperty(page, 'Status', 'Status');
  const row = unique('Isi');
  await addRow(page, row);
  await pickOption(page, 'Status', row, 'Selesai');

  await page.getByRole('button', { name: 'Duplikat', exact: true }).click();
  let before = page.url();
  await page.getByRole('dialog', { name: 'Duplikat' }).getByRole('button', { name: 'Duplikat dengan isi' }).click();
  await expect(page).not.toHaveURL(before);
  await expect(page.getByLabel('Judul halaman')).toHaveValue(`${name} (salinan)`);
  await expect(cell(page, 'Status', row)).toHaveText('Selesai');

  await page.getByRole('button', { name: 'Duplikat', exact: true }).click();
  before = page.url();
  await page.getByRole('dialog', { name: 'Duplikat' }).getByRole('button', { name: 'Duplikat struktur saja' }).click();
  await expect(page).not.toHaveURL(before);
  await expect(page.getByLabel('Judul halaman')).toHaveValue(`${name} (salinan) (salinan)`);
  await expect(page.getByText('Belum ada baris.')).toBeVisible();
  await expect(table(page).getByRole('columnheader', { name: 'Status' })).toBeVisible();

  // Inline: the copy appears as a second database block on the same page.
  await createPage(page, unique('Host'));
  const editor = page.getByTestId('editor');
  await editor.locator('[contenteditable="true"]').click();
  await page.keyboard.type('/database');
  await page.getByRole('option', { name: /^Database/ }).click();
  await expect(editor.locator('.inline-db')).toHaveCount(1);
  await editor.getByRole('button', { name: 'Menu database Database tanpa judul' }).click();
  await page.getByRole('dialog', { name: /Menu database/ }).getByRole('button', { name: 'Duplikat struktur saja' }).click();
  await expect(editor.locator('.inline-db')).toHaveCount(2);
  await expect(editor.locator('.inline-db table')).toHaveCount(2);
});

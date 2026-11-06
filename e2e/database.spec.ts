import { expect, test, type Page } from '@playwright/test';
import { addProperty, addRow, cell, createDatabase, fillCell, pickOption, table } from './database-helpers.ts';
import { gotoStable, login, openNav, opensNewPage, pageAction, setTitle, syncNow, treeLink, unique } from './helpers.ts';

test('database: every property type is edited in the table, kept after reload and synced', async ({ page, browser }) => {
  await login(page);
  const title = unique('Tugas');
  const dbId = await createDatabase(page, title);
  await addProperty(page, 'Angka', 'Poin');
  await addProperty(page, 'Select', 'Prioritas');
  await addProperty(page, 'Multi-select', 'Label');
  await addProperty(page, 'Status', 'Status');
  await addProperty(page, 'Tanggal', 'Tenggat');
  await addProperty(page, 'Checkbox', 'Penting');
  await addProperty(page, 'URL', 'Tautan');

  const row = unique('Tulis laporan');
  const rowId = await addRow(page, row);

  await fillCell(page, 'Catatan', row, 'draf pertama');
  await fillCell(page, 'Poin', row, '2,5');
  await pickOption(page, 'Prioritas', row, 'Tinggi', true);
  await pickOption(page, 'Label', row, 'Kerja', true);
  await pickOption(page, 'Label', row, 'Rumah', true);
  await pickOption(page, 'Status', row, 'Dikerjakan');
  await cell(page, 'Tenggat', row).click();
  const datePop = page.getByRole('dialog', { name: `Tenggat: ${row}` });
  await datePop.getByLabel('Tanggal mulai').fill('2026-11-10');
  await datePop.getByRole('button', { name: '+ Tanggal akhir' }).click();
  await datePop.getByLabel('Tanggal akhir', { exact: true }).fill('2026-11-12');
  await datePop.getByRole('button', { name: 'Simpan' }).click();
  await page.getByRole('checkbox', { name: `Penting: ${row}` }).check();
  await fillCell(page, 'Tautan', row, 'example.com');

  const expectValues = async (p: Page) => {
    await expect(cell(p, 'Catatan', row)).toHaveText('draf pertama');
    await expect(cell(p, 'Poin', row)).toHaveText('2,5');
    await expect(cell(p, 'Prioritas', row)).toHaveText('Tinggi');
    await expect(cell(p, 'Label', row)).toHaveText('KerjaRumah');
    await expect(cell(p, 'Status', row)).toHaveText('Dikerjakan');
    await expect(cell(p, 'Tenggat', row)).toHaveText('10 Nov 2026 → 12 Nov 2026');
    await expect(p.getByRole('checkbox', { name: `Penting: ${row}` })).toBeChecked();
    await expect(cell(p, 'Tautan', row)).toHaveText('example.com');
    await expect(p.getByRole('link', { name: 'Buka tautan example.com' })).toHaveAttribute('href', 'https://example.com/');
  };
  await expectValues(page);

  await syncNow(page);
  await page.reload();
  await expectValues(page);

  // Rows are pages, but not part of the sidebar tree.
  await openNav(page);
  await expect(treeLink(page, row)).toHaveCount(0);

  const other = await browser.newContext();
  const phone = await other.newPage();
  await login(phone);
  await gotoStable(phone, `/p/${dbId}`);
  await expectValues(phone);

  // The row opens as a full page: properties on top, editor below (F-14).
  await gotoStable(phone, `/p/${rowId}`);
  const props = phone.getByRole('region', { name: 'Properti' });
  await expect(props.getByText(`Baris di ${title}`)).toBeVisible();
  await expect(cell(props, 'Status', row)).toHaveText('Dikerjakan');
  await expect(phone.getByTestId('editor')).toBeVisible();
  await other.close();
});

test('database: properties are renamed, reordered, hidden, deleted, and options get colors', async ({ page }) => {
  await login(page);
  await createDatabase(page, unique('Kelola'));
  await addProperty(page, 'Select', 'Jenis');
  await addProperty(page, 'Angka', 'Biaya');
  const row = unique('Baris');
  await addRow(page, row);
  await pickOption(page, 'Jenis', row, 'Ide', true);

  const headers = () => table(page).getByRole('columnheader').allInnerTexts();
  expect(await headers()).toEqual(['Judul', 'Catatan', 'Jenis', 'Biaya', '+']);

  // Rename and move left.
  await table(page).getByRole('button', { name: 'Biaya', exact: true }).click();
  // Renaming relabels the open menu, so match it under either name.
  let menu = page.getByRole('dialog', { name: /^Properti (Biaya|Harga)$/ });
  // On a touch screen the menu opens without raising the keyboard; a tap on the field does.
  if (test.info().project.name === 'android') await expect(menu.getByLabel('Nama properti')).not.toBeFocused();
  else await expect(menu.getByLabel('Nama properti')).toBeFocused();
  await menu.getByLabel('Nama properti').fill('Harga');
  await menu.getByLabel('Nama properti').press('Enter');
  await menu.getByRole('button', { name: '← Geser kiri' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(headers).toEqual(['Judul', 'Catatan', 'Harga', 'Jenis', '+']);

  // Option color.
  await table(page).getByRole('button', { name: 'Jenis', exact: true }).click();
  menu = page.getByRole('dialog', { name: 'Properti Jenis' });
  await menu.getByLabel('Warna Ide').selectOption('green');
  // "+ Opsi" moves focus straight to the new option's name, so a phone keyboard stays up.
  await menu.getByLabel('Nama opsi Ide').click();
  await menu.getByRole('button', { name: '+ Opsi' }).click();
  await expect(menu.getByLabel('Nama opsi Opsi 2')).toBeFocused();
  await page.keyboard.type('Tugas');
  await page.keyboard.press('Enter');
  await expect(menu.getByLabel('Nama opsi Tugas')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cell(page, 'Jenis', row).locator('.chip')).toHaveClass(/c-green/);

  // Hide, then show again from the footer.
  await table(page).getByRole('button', { name: 'Catatan', exact: true }).click();
  await page.getByRole('dialog', { name: 'Properti Catatan' }).getByRole('button', { name: 'Sembunyikan' }).click();
  await expect.poll(headers).toEqual(['Judul', 'Harga', 'Jenis', '+']);
  await page.getByRole('button', { name: '1 properti tersembunyi' }).click();
  await page.getByRole('dialog', { name: 'Properti tersembunyi' }).getByRole('button', { name: 'Tampilkan' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(headers).toEqual(['Judul', 'Catatan', 'Harga', 'Jenis', '+']);

  // Delete.
  page.once('dialog', (d) => void d.accept());
  await table(page).getByRole('button', { name: 'Harga', exact: true }).click();
  await page.getByRole('dialog', { name: 'Properti Harga' }).getByRole('button', { name: 'Hapus properti' }).click();
  await expect.poll(headers).toEqual(['Judul', 'Catatan', 'Jenis', '+']);
});

test('database: relations are two-way and editable from both sides', async ({ page }) => {
  await login(page);
  const epics = unique('Epic');
  const epicsId = await createDatabase(page, epics);
  const epic = unique('Epic A');
  await addRow(page, epic);

  const tasks = unique('Ticket');
  const tasksId = await createDatabase(page, tasks);
  await addProperty(page, 'Relation', 'Epic', epics);
  const t1 = unique('Ticket 1');
  const t2 = unique('Ticket 2');
  await addRow(page, t1);
  await addRow(page, t2);

  // Forward side: link ticket 1 to the epic.
  await cell(page, 'Epic', t1).click();
  let pop = page.getByRole('dialog', { name: `Epic: ${t1}` });
  await pop.getByRole('option', { name: epic }).click();
  await page.keyboard.press('Escape');
  await expect(cell(page, 'Epic', t1)).toHaveText(epic);

  // Reverse side shows it, and links ticket 2 from there.
  await gotoStable(page, `/p/${epicsId}`);
  await expect(cell(page, tasks, epic)).toHaveText(t1);
  await cell(page, tasks, epic).click();
  pop = page.getByRole('dialog', { name: `${tasks}: ${epic}` });
  await pop.getByRole('option', { name: t2 }).click();
  await pop.getByRole('option', { name: t1 }).click(); // unlink
  await page.keyboard.press('Escape');
  await expect(cell(page, tasks, epic)).toHaveText(t2);

  await gotoStable(page, `/p/${tasksId}`);
  await expect(cell(page, 'Epic', t1)).toHaveText('');
  await expect(cell(page, 'Epic', t2)).toHaveText(epic);
});

test('database: inline database inside a page, with a list view', async ({ page }) => {
  await login(page);
  const host = unique('Trip');
  await opensNewPage(page, async () => {
    await openNav(page);
    await page.getByRole('complementary').getByRole('button', { name: '+ Halaman baru' }).click();
  });
  await setTitle(page, host);

  const editor = page.getByTestId('editor');
  await editor.locator('[contenteditable="true"]').click();
  await page.keyboard.type('/database');
  await page.getByRole('option', { name: /^Database/ }).click();
  const db = editor.locator('.inline-db');
  await expect(db.getByRole('table')).toBeVisible();

  // No editor selection overlay on the table, and on phones the database lines up with the title
  // without making the page scroll sideways.
  await db.getByRole('table').click({ position: { x: 5, y: 5 } });
  const block = editor.locator(".bn-block-content[data-content-type='database'] > *");
  const overlay = await block.evaluate((el) => {
    el.parentElement!.classList.add('ProseMirror-selectednode');
    const content = getComputedStyle(el, '::after').content;
    el.parentElement!.classList.remove('ProseMirror-selectednode');
    return content;
  });
  expect(overlay).toBe('none');
  await page.screenshot({ path: `test-results/inline-db-${test.info().project.name}.png` });
  if (test.info().project.name === 'android') {
    const [box, title] = await Promise.all([db.boundingBox(), page.getByLabel('Judul halaman').boundingBox()]);
    expect(Math.abs(box!.x - title!.x)).toBeLessThan(4);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await db.getByRole('button', { name: 'Judul database' }).click();
  await db.getByRole('textbox', { name: 'Judul database' }).fill('Barang bawaan');
  await db.getByRole('textbox', { name: 'Judul database' }).press('Enter');
  await expect(db.getByRole('button', { name: 'Judul database' })).toHaveText('Barang bawaan');

  const row = unique('Jaket');
  await addRow(page, row);
  await fillCell(page, 'Catatan', row, 'yang tebal');

  // List view.
  await db.getByRole('button', { name: 'View baru' }).click();
  await page.getByRole('dialog', { name: 'View baru' }).getByRole('button', { name: '☰ List' }).click();
  const list = db.locator('.db-list');
  await expect(list.getByRole('link', { name: new RegExp(row) })).toContainText('yang tebal');

  // Kept after reload, list view still chosen.
  await page.waitForTimeout(400);
  await syncNow(page);
  await page.reload();
  await expect(editor.locator('.db-list').getByRole('link', { name: new RegExp(row) })).toBeVisible();
  await editor.getByRole('tab', { name: /Tabel/ }).click();
  await expect(cell(page, 'Catatan', row)).toHaveText('yang tebal');
});

test('database: numbers edit without thousands separators, and a trashed row keeps its values', async ({ page }) => {
  await login(page);
  await createDatabase(page, unique('Biaya'));
  await addProperty(page, 'Angka', 'Harga');
  const row = unique('Sewa');
  const rowId = await addRow(page, row);

  await fillCell(page, 'Harga', row, '1234');
  await expect(cell(page, 'Harga', row)).toHaveText('1.234');
  await cell(page, 'Harga', row).click();
  const input = page.getByRole('textbox', { name: `Harga: ${row}` });
  await expect(input).toHaveValue('1234');
  await input.fill('1235');
  await input.press('Enter');
  await expect(cell(page, 'Harga', row)).toHaveText('1.235');

  if (test.info().project.name === 'android') {
    // Phones delete a row from its page; the table keeps the title column free of the trash icon.
    await expect(page.getByRole('button', { name: `Hapus baris ${row}` })).toBeHidden();
    await table(page).getByRole('button', { name: `Buka ${row}`, exact: true }).click();
    await pageAction(page, 'Hapus');
    await expect(page).not.toHaveURL(/\/p\//);
  } else {
    await page.getByRole('button', { name: `Hapus baris ${row}` }).click();
    await expect(page.getByRole('button', { name: `Judul baris ${row}` })).toHaveCount(0);
  }
  await gotoStable(page, `/p/${rowId}`);
  await expect(page.getByText('Halaman ini ada di trash.')).toBeVisible();
  await expect(cell(page.getByRole('region', { name: 'Properti' }), 'Harga', row)).toHaveText('1.235');
});

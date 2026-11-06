// Done-when item of MVP 1: an offline edit on the phone shows on the laptop after reconnecting,
// with no data lost. One phone and one laptop context; the phone works offline through a reload.
import { devices, expect, test, type Page } from '@playwright/test';
import { addProperty, addRow, cell, createDatabase, pickOption, table } from './database-helpers.ts';
import { createPage, gotoStable, login, openNav, pageAction, setTitle, syncNow, unique, waitForServiceWorker } from './helpers.ts';

async function createProject(page: Page): Promise<string> {
  await openNav(page);
  await page.getByRole('complementary').getByRole('button', { name: 'Dari template…' }).click();
  const before = page.url();
  await page.getByRole('dialog', { name: 'Halaman dari template' }).getByRole('button', { name: /Proyek/ }).click();
  await expect(page).not.toHaveURL(before);
  const title = unique('Proyek');
  await setTitle(page, title);
  return title;
}

test('offline on the phone: titles, blocks, cells, rows, quick notes and tickets reach the laptop', async ({ browser }) => {
  test.skip(test.info().project.name !== 'laptop', 'drives its own phone and laptop contexts');
  test.setTimeout(120_000);
  const laptopCtx = await browser.newContext();
  const phoneCtx = await browser.newContext({ ...devices['Pixel 7'] });
  const laptop = await laptopCtx.newPage();
  const phone = await phoneCtx.newPage();

  // Laptop: a project, a page with text, and a database with one row.
  await login(laptop);
  const project = await createProject(laptop);
  const note = unique('Catatan');
  const noteId = await createPage(laptop, note);
  await laptop.getByTestId('editor').locator('[contenteditable="true"]').click();
  await laptop.keyboard.type('Baris dari laptop');
  const dbTitle = unique('Daftar');
  const dbId = await createDatabase(laptop, dbTitle);
  await addProperty(laptop, 'Status', 'Status');
  const r1 = unique('Satu');
  await addRow(laptop, r1);
  await syncNow(laptop);

  // Phone: load everything once while online, so the app and the data are cached.
  await login(phone);
  await waitForServiceWorker(phone);
  await syncNow(phone);
  await gotoStable(phone, `/p/${noteId}`);
  await expect(phone.getByTestId('editor')).toContainText('Baris dari laptop');

  // Offline on the phone, through a reload.
  await phoneCtx.setOffline(true);
  await setTitle(phone, `${note} HP`);
  // Caret at the end of the laptop's line (End does not move it on the emulated phone).
  const line = phone.getByTestId('editor').getByText('Baris dari laptop');
  await line.tap();
  await line.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await phone.keyboard.press('Enter');
  await phone.keyboard.type('Baris dari HP offline');
  await pageAction(phone, 'Jadikan ticket');
  const dialog = phone.getByRole('dialog', { name: 'Jadikan ticket' });
  await dialog.getByRole('button', { name: `${project} / Ticket` }).tap();
  await expect(dialog.getByRole('status')).toContainText('Ticket dibuat');
  await dialog.getByRole('button', { name: 'Tutup' }).tap();

  await gotoStable(phone, `/p/${dbId}`);
  await pickOption(phone, 'Status', r1, 'Selesai');
  const r2 = unique('Dua');
  await addRow(phone, r2);

  await gotoStable(phone, '/quick');
  await expect(phone).toHaveURL(/\/p\//);
  const quick = unique('Cepat');
  await phone.getByLabel('Judul halaman').fill(quick);
  await phone.getByLabel('Judul halaman').press('Enter');
  await phone.keyboard.type('isi catatan cepat');

  // The user switches to another app right after typing: the page is hidden, then killed. Hiding
  // must save what the editor still holds back (its save waits 300 ms after the last key).
  await phone.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await phone.waitForTimeout(100);
  await phone.reload();
  await expect(phone.getByLabel('Judul halaman')).toHaveValue(quick);
  await expect(phone.getByTestId('editor')).toContainText('isi catatan cepat');

  // Back online: the phone pushes, the laptop pulls.
  await phoneCtx.setOffline(false);
  await syncNow(phone);
  await syncNow(laptop);

  await gotoStable(laptop, `/p/${noteId}`);
  await expect(laptop.getByLabel('Judul halaman')).toHaveValue(`${note} HP`);
  await expect(laptop.getByTestId('editor')).toContainText('Baris dari laptop');
  await expect(laptop.getByTestId('editor')).toContainText('Baris dari HP offline');
  await expect(laptop.getByLabel('Link ticket')).toContainText(`${note} HP`);
  await expect(laptop.getByRole('status', { name: 'Ada versi lain' })).toHaveCount(0);

  await gotoStable(laptop, `/p/${dbId}`);
  await expect(cell(laptop, 'Status', r1)).toHaveText('Selesai');
  await expect(table(laptop).getByRole('button', { name: `Judul baris ${r2}` })).toBeVisible();

  await openNav(laptop);
  await laptop.getByRole('tree').getByRole('link', { name: 'Inbox', exact: true }).click();
  await expect(laptop.getByRole('region', { name: 'Sub-halaman' }).getByRole('link', { name: quick })).toBeVisible();

  await laptopCtx.close();
  await phoneCtx.close();
});

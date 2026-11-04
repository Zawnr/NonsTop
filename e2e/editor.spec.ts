import { expect, test, type Page } from '@playwright/test';
import { createPage, gotoStable, login, openNav, syncNow, unique, waitForServiceWorker } from './helpers.ts';

const editorOf = (page: Page) => page.getByTestId('editor').locator('[contenteditable="true"]');

/** Puts the caret at the end of a piece of text in the editor. */
async function caretAfter(page: Page, text: string) {
  const target = page.getByTestId('editor').getByText(text, { exact: true });
  const box = (await target.boundingBox())!;
  await target.click({ position: { x: box.width - 1, y: box.height / 2 } });
}

/** Picks a block type from the slash menu. */
async function slash(page: Page, query: string, option: string) {
  await page.keyboard.type(`/${query}`);
  await page.getByRole('option', { name: new RegExp(`^${option}`) }).first().click();
}

test('editor: slash menu block types are saved, survive reload and reach another device', async ({ page, browser }) => {
  await login(page);
  const id = await createPage(page, unique('Catatan editor'));
  const word = unique('isi');

  await editorOf(page).click();
  await page.keyboard.type(`Paragraf ${word}`);
  await page.keyboard.press('Enter');
  await slash(page, 'h1', 'Heading 1');
  await page.keyboard.type('Judul bagian');
  await page.keyboard.press('Enter');
  await slash(page, 'todo', 'Checklist');
  await page.keyboard.type('Tugas satu');
  await page.keyboard.press('Enter');
  await slash(page, 'callout', 'Callout');
  await page.keyboard.type('Catatan penting');

  const editor = page.getByTestId('editor');
  await expect(editor.locator('h1', { hasText: 'Judul bagian' })).toBeVisible();
  await expect(editor.getByRole('checkbox')).toHaveCount(1);
  await expect(editor.locator('.callout', { hasText: 'Catatan penting' })).toBeVisible();

  // Saved locally: wait for the debounce and the push, then reload.
  await page.waitForTimeout(500);
  await syncNow(page);
  await page.reload();
  await expect(editor).toContainText(`Paragraf ${word}`);
  await expect(editor.locator('h1', { hasText: 'Judul bagian' })).toBeVisible();
  await expect(editor.locator('.callout', { hasText: 'Catatan penting' })).toBeVisible();

  const other = await browser.newContext();
  const phone = await other.newPage();
  await login(phone);
  await gotoStable(phone, `/p/${id}`);
  await expect(phone.getByTestId('editor')).toContainText('Tugas satu');
  await expect(phone.getByTestId('editor').locator('h1', { hasText: 'Judul bagian' })).toBeVisible();
  await other.close();
});

test('editor: edits made offline are kept and synced later', async ({ page, context, browser }) => {
  await login(page);
  await waitForServiceWorker(page);
  await syncNow(page);
  const id = await createPage(page, unique('Offline editor'));
  await context.setOffline(true);
  const word = unique('offline');
  await editorOf(page).click();
  await page.keyboard.type(`Ditulis ${word}`);
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByTestId('editor')).toContainText(`Ditulis ${word}`);
  await context.setOffline(false);
  await syncNow(page);

  const other = await browser.newContext();
  const phone = await other.newPage();
  await login(phone);
  await gotoStable(phone, `/p/${id}`);
  await expect(phone.getByTestId('editor')).toContainText(`Ditulis ${word}`);
  await other.close();
});

test('search: finds a page by a word in its text and opens it', async ({ page }) => {
  await login(page);
  const title = unique('Resep');
  const word = `rempah${Date.now().toString(36)}`;
  const id = await createPage(page, title);
  await editorOf(page).click();
  await page.keyboard.type(`Pakai ${word} secukupnya`);
  await page.waitForTimeout(500);

  await openNav(page);
  await page.getByRole('button', { name: 'Cari…' }).click();
  await page.getByRole('searchbox', { name: 'Cari' }).fill(word);
  const result = page.getByRole('option').filter({ hasText: title });
  await expect(result).toContainText(`Pakai ${word} secukupnya`);

  await page.getByRole('searchbox', { name: 'Cari' }).fill('kata-yang-tidak-ada-xyz');
  await expect(page.getByText('Tidak ada hasil.')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Cari' }).fill(word);
  await result.click();
  await expect(page).toHaveURL(new RegExp(`/p/${id}$`));
});

test('editor: a block added on another device appears without moving the caret', async ({ browser }) => {
  const laptopCtx = await browser.newContext();
  const phoneCtx = await browser.newContext();
  const laptop = await laptopCtx.newPage();
  const phone = await phoneCtx.newPage();
  await login(laptop);
  await login(phone);

  const id = await createPage(laptop, unique('Bersama'));
  await editorOf(laptop).click();
  await laptop.keyboard.type('Halo');
  await laptop.waitForTimeout(500);
  await syncNow(laptop);

  // Put the laptop's caret in the middle of "Halo" ("Ha|lo"); the badge click took the focus.
  await caretAfter(laptop, 'Halo');
  await laptop.keyboard.press('ArrowLeft');
  await laptop.keyboard.press('ArrowLeft');

  await gotoStable(phone, `/p/${id}`);
  await expect(phone.getByTestId('editor')).toContainText('Halo');
  await caretAfter(phone, 'Halo');
  await phone.keyboard.press('Enter');
  await phone.keyboard.type('Dari HP');
  await phone.waitForTimeout(500);
  await syncNow(phone);

  // The laptop still has its caret inside "Halo" while the phone's block arrives.
  // Sync without clicking the badge, which would take the focus out of the editor.
  await laptop.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(laptop.getByTestId('editor')).toContainText('Dari HP');
  await laptop.keyboard.type('!');
  await expect(laptop.getByTestId('editor').locator('.bn-block-content').first()).toHaveText('Ha!lo');

  await laptopCtx.close();
  await phoneCtx.close();
});

test('update: a device that skipped blocks under an older app version pulls them after updating', async ({ page, browser }) => {
  await login(page);
  const id = await createPage(page, unique('Sebelum update'));
  const word = unique('lama');
  await editorOf(page).click();
  await page.keyboard.type(`Ditulis ${word}`);
  await page.waitForTimeout(500);
  await syncNow(page);

  const otherCtx = await browser.newContext();
  const phone = await otherCtx.newPage();
  await login(phone);
  await syncNow(phone);
  // Make the phone's local data look like it was synced by a version without blocks: the cursor is
  // past the block changes, but no blocks were stored.
  await phone.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('nonstop');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction(['block', 'meta'], 'readwrite');
          tx.objectStore('block').clear();
          tx.objectStore('meta').put({ key: 'knownEntities', value: 'conflict,page' });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await gotoStable(phone, `/p/${id}`);
  await syncNow(phone);
  await expect(phone.getByTestId('editor')).toContainText(`Ditulis ${word}`);
  await otherCtx.close();
});

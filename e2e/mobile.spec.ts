// N-02: mobile-first layout for quick notes and the board, laptop layout for writing.
import { expect, test } from '@playwright/test';
import { createPage, login, unique } from './helpers.ts';

const isPhone = () => test.info().project.name === 'android';

test('page actions: a row on the laptop, Favorit plus "Lainnya" on the phone', async ({ page }) => {
  await login(page);
  await createPage(page, unique('Aksi'));
  const main = page.getByRole('main');
  const more = main.getByRole('button', { name: '⋯ Lainnya' });
  if (isPhone()) {
    await expect(more).toBeVisible();
    await expect(main.getByRole('button', { name: '+ Sub-halaman' })).toBeHidden();
    // The editor starts in the top half of the screen.
    const box = (await page.getByTestId('editor').boundingBox())!;
    expect(box.y).toBeLessThan(page.viewportSize()!.height / 2);
    await more.click();
    const menu = page.getByRole('dialog', { name: 'Aksi halaman' });
    await expect(menu.locator('.pop-item')).toHaveText(['+ Sub-halaman', '+ Database', 'Pindahkan', 'Duplikat', 'Jadikan ticket', 'Jadikan template', 'Hapus']);
  } else {
    await expect(more).toBeHidden();
    await expect(main.getByRole('button', { name: '+ Sub-halaman' })).toBeVisible();
  }
});

test('quick note from the app: "+ Catatan" on the phone, Enter in the title moves on to the text', async ({ page }) => {
  await login(page);
  const button = page.getByRole('button', { name: '+ Catatan' });
  if (!isPhone()) {
    await expect(button).toBeHidden();
    return;
  }
  await createPage(page, unique('Mulai'));
  const before = page.url();
  await button.click();
  await expect(page).not.toHaveURL(before);
  await expect(page.getByRole('navigation', { name: 'Lokasi halaman' }).getByRole('link', { name: 'Inbox' })).toBeVisible();
  const title = page.getByLabel('Judul halaman');
  await expect(title).toBeFocused();
  await title.fill(unique('Belanja'));
  await title.press('Enter');
  await page.keyboard.type('Beli sayur');
  await expect(page.getByTestId('editor')).toContainText('Beli sayur');
});

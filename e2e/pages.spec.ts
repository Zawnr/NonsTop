import { expect, test } from '@playwright/test';
import { createPage, gotoStable, login, openNav, openSideLink, opensNewPage, setTitle, syncBadge, syncNow, treeLink, unique, waitForServiceWorker } from './helpers.ts';

test('pages: create, nest, rename, favorite, trash, restore, delete permanently', async ({ page }) => {
  await login(page);
  const parent = unique('Proyek');
  const child = unique('Catatan');
  await createPage(page, parent);

  await opensNewPage(page, () => page.getByRole('button', { name: '+ Sub-halaman' }).click());
  await setTitle(page, child);
  await expect(page.getByRole('navigation', { name: 'Lokasi halaman' })).toContainText(parent);

  // Rename and favorite the child.
  const renamed = `${child} v2`;
  await setTitle(page, renamed);
  await page.getByRole('button', { name: '☆ Favoritkan' }).click();
  await openNav(page);
  await expect(page.getByRole('list', { name: 'Favorit' })).toContainText(renamed);
  await expect(treeLink(page, renamed)).toBeVisible();

  // Trash the parent: the child goes with it.
  await treeLink(page, parent).click();
  await page.getByRole('button', { name: 'Hapus', exact: true }).click();
  await expect(treeLink(page, parent)).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Favorit' }).getByText(renamed)).toHaveCount(0);

  await openSideLink(page, 'Trash');
  const row = page.getByRole('listitem').filter({ hasText: parent });
  await expect(row).toContainText('1 sub-halaman');
  await row.getByRole('button', { name: 'Pulihkan' }).click();
  await openNav(page);
  await expect(treeLink(page, parent)).toBeVisible();

  // Permanent delete only from the trash.
  await treeLink(page, parent).click();
  await page.getByRole('button', { name: 'Hapus', exact: true }).click();
  await expect(treeLink(page, parent)).toHaveCount(0);
  await openSideLink(page, 'Trash');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('listitem').filter({ hasText: parent }).getByRole('button', { name: 'Hapus permanen' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: parent })).toHaveCount(0);
  await syncNow(page);
});

test('offline: create a page offline, reload offline, sync when back online', async ({ browser, page, context }) => {
  await login(page);
  await waitForServiceWorker(page);
  await syncNow(page);

  await context.setOffline(true);
  const title = unique('Offline');
  const id = await createPage(page, title);
  await expect(await syncBadge(page)).toContainText(/Offline|Menunggu/);

  await page.reload();
  await expect(page.getByLabel('Judul halaman')).toHaveValue(title);

  await context.setOffline(false);
  await syncNow(page);

  // A second device sees the page.
  const other = await browser.newContext();
  const phone = await other.newPage();
  await login(phone);
  await gotoStable(phone, `/p/${id}`);
  await expect(phone.getByLabel('Judul halaman')).toHaveValue(title);
  await other.close();
});

test('conflict: concurrent offline edits keep the other version and let the user pick it', async ({ browser }) => {
  const laptopCtx = await browser.newContext();
  const phoneCtx = await browser.newContext();
  const laptop = await laptopCtx.newPage();
  const phone = await phoneCtx.newPage();
  await login(laptop);
  await login(phone);

  const base = unique('Konflik');
  const id = await createPage(laptop, base);
  await syncNow(laptop);
  await gotoStable(phone, `/p/${id}`);
  await expect(phone.getByLabel('Judul halaman')).toHaveValue(base);

  await laptopCtx.setOffline(true);
  await phoneCtx.setOffline(true);
  await setTitle(laptop, `${base} laptop`);
  await laptop.waitForTimeout(20);
  await setTitle(phone, `${base} HP`);

  await phoneCtx.setOffline(false);
  await syncNow(phone);
  await laptopCtx.setOffline(false);
  await syncNow(laptop);

  // The later edit (phone) wins everywhere; the laptop version is offered, not lost.
  await expect(laptop.getByLabel('Judul halaman')).toHaveValue(`${base} HP`);
  const banner = laptop.getByRole('status', { name: 'Ada versi lain' });
  await expect(banner).toContainText(`${base} laptop`);
  await syncNow(phone);
  await expect(phone.getByRole('status', { name: 'Ada versi lain' })).toContainText(`${base} laptop`);

  await banner.getByRole('button', { name: 'Pakai versi ini' }).click();
  await expect(laptop.getByLabel('Judul halaman')).toHaveValue(`${base} laptop`);
  await expect(banner).toHaveCount(0);
  await syncNow(laptop);
  await syncNow(phone);
  await expect(phone.getByLabel('Judul halaman')).toHaveValue(`${base} laptop`);
  await expect(phone.getByRole('status', { name: 'Ada versi lain' })).toHaveCount(0);

  await laptopCtx.close();
  await phoneCtx.close();
});

test('tree: drag a page onto another to nest it, and before it to reorder', async ({ page, context, isMobile }) => {
  test.skip(isMobile, 'mouse drag; touch uses long-press and the move dialog');
  await login(page);
  await syncNow(page);
  // Other tests share the server. Offline, their pages cannot land between A and B or arrive mid-drag.
  await context.setOffline(true);
  const a = unique('Drag A');
  const b = unique('Drag B');
  await createPage(page, a);
  await createPage(page, b);

  const drag = async (from: string, to: string, where: 'inside' | 'before') => {
    // A long tree scrolls inside the sidebar. Centre the target so both rows are on screen.
    await treeLink(page, to).evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const source = await treeLink(page, from).boundingBox();
    const target = await page.getByRole('treeitem').filter({ has: page.getByRole('link', { name: to, exact: true }) }).boundingBox();
    const y = where === 'inside' ? target!.y + target!.height / 2 : target!.y + 3;
    await page.mouse.move(source!.x + 10, source!.y + source!.height / 2);
    await page.mouse.down();
    await page.mouse.move(source!.x + 10, source!.y + source!.height / 2 + 10, { steps: 3 });
    await page.mouse.move(target!.x + 40, y, { steps: 10 });
    // Under load the last move can land after the drop: settle on the target before releasing.
    await page.mouse.move(target!.x + 42, y, { steps: 2 });
    await expect(page.locator('.tree-row.drop-inside, .tree-row.drop-before')).toHaveCount(1);
    await page.mouse.up();
  };

  await drag(b, a, 'inside');
  await treeLink(page, b).click();
  await expect(page.getByRole('navigation', { name: 'Lokasi halaman' })).toContainText(a);

  // Move B back to the top level, directly before A.
  await drag(b, a, 'before');
  await expect(page.getByRole('navigation', { name: 'Lokasi halaman' })).not.toContainText(a);
  const items = await page.getByRole('tree').getByRole('link').allTextContents();
  expect(items.indexOf(b)).toBe(items.indexOf(a) - 1);
  await context.setOffline(false);
  await syncNow(page);
});

test('move dialog: move a page under another without dragging', async ({ page }) => {
  await login(page);
  const a = unique('Tujuan');
  const b = unique('Dipindah');
  await createPage(page, a);
  await createPage(page, b);
  await page.getByRole('button', { name: 'Pindahkan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: a }).click();
  await expect(page.getByRole('navigation', { name: 'Lokasi halaman' })).toContainText(a);
});

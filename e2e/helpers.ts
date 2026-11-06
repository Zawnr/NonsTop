import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'e2e-password-123';

export const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByTestId('sync-status').first()).toBeAttached();
}

/** On phones the sidebar is a drawer. Opens it when needed. */
export async function openNav(page: Page) {
  const menu = page.getByRole('button', { name: 'Buka menu' });
  if (await menu.isVisible()) await menu.click();
}

/** Creates a top-level page with a title and returns its id. */
export async function createPage(page: Page, title: string): Promise<string> {
  // In-app navigation only: a full page load right after an edit could cut off the IndexedDB write.
  const id = await opensNewPage(page, async () => {
    await openNav(page);
    await page.getByRole('complementary').getByRole('button', { name: '+ Halaman baru' }).click();
  });
  await setTitle(page, title);
  return id;
}

/** Runs an action that creates a page, and waits until that new page is open. Returns its id. */
export async function opensNewPage(page: Page, action: () => Promise<void>): Promise<string> {
  const before = page.url();
  await action();
  await expect(page).not.toHaveURL(before);
  await expect(page).toHaveURL(/\/p\//);
  await expect(page.getByLabel('Judul halaman')).toHaveValue('');
  return page.url().split('/p/')[1]!;
}

/** Sets the open page's title and waits until it is stored locally (the sidebar shows it). */
export async function setTitle(page: Page, title: string) {
  const input = page.getByLabel('Judul halaman');
  await input.fill(title);
  await input.press('Enter');
  await expect(treeLink(page, title).or(page.getByRole('list', { name: 'Favorit' }).getByText(title))).not.toHaveCount(0);
}

/** Opens a sidebar link (Trash, Pengaturan) without a full page load. */
export async function openSideLink(page: Page, name: string) {
  await openNav(page);
  await page.getByRole('complementary').getByRole('link', { name: new RegExp(`^${name}`) }).click();
}

/** Clicks the sync badge and waits until everything is synced. */
export async function syncNow(page: Page) {
  const badge = await syncBadge(page);
  await badge.click();
  await expect(badge).toHaveText('Tersinkron');
}

export function treeLink(page: Page, title: string) {
  return page.getByRole('tree').getByRole('link', { name: title, exact: true });
}

/** The sync status on screen: in the top bar on phones, in the sidebar on wide screens. */
export async function syncBadge(page: Page) {
  await expect(page.getByTestId('sync-status').first()).toBeAttached(); // both badges render together
  const mobile = page.getByRole('main').getByTestId('sync-status');
  return (await mobile.isVisible()) ? mobile : page.getByRole('complementary').getByTestId('sync-status');
}

/**
 * page.goto that retries once on net::ERR_NETWORK_CHANGED. Chromium raises it in every context
 * when another test's context toggles offline in the same browser process.
 */
export async function gotoStable(page: Page, url: string) {
  try {
    await page.goto(url);
  } catch (err) {
    if (!String(err).includes('ERR_NETWORK_CHANGED')) throw err;
    await page.goto(url);
  }
}

/**
 * Waits until the service worker is active and controls the page. A network change event from a
 * parallel test can abort the install; the browser then installs again on the next load.
 */
export async function waitForServiceWorker(page: Page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ready = await page.evaluate(
      () => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 5000))]),
    );
    if (ready) break;
    await page.reload();
  }
  await page.reload(); // let the active service worker control the page
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

/** Runs a page action. On phones the actions sit in the "⋯ Lainnya" menu (N-02). */
export async function pageAction(page: Page, name: string) {
  const more = page.getByRole('button', { name: '⋯ Lainnya' });
  if (await more.isVisible()) {
    await more.click();
    await page.getByRole('dialog', { name: 'Aksi halaman' }).getByRole('button', { name, exact: true }).click();
  } else {
    await page.getByRole('main').getByRole('button', { name, exact: true }).click();
  }
}

/** The names of the page actions on offer, wherever they are shown. */
export async function pageActionNames(page: Page): Promise<string[]> {
  const more = page.getByRole('button', { name: '⋯ Lainnya' });
  if (!(await more.isVisible())) return page.locator('.actions .inline-action').allInnerTexts();
  await more.click();
  const dialog = page.getByRole('dialog', { name: 'Aksi halaman' });
  const names = await dialog.locator('.pop-item').allInnerTexts();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  return names;
}

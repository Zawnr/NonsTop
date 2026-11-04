import { expect, test } from '@playwright/test';

const PASSWORD = 'e2e-password-123';

test('login: wrong password shows an error, right password opens the app', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByRole('alert')).toHaveText('Password salah.');

  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByRole('heading', { name: 'Fondasi siap' })).toBeVisible();

  // Session survives a reload.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Fondasi siap' })).toBeVisible();

  await page.getByRole('button', { name: 'Keluar' }).click();
  await expect(page.getByLabel('Password')).toBeVisible();
});

test('PWA: valid manifest and an active service worker', async ({ page, request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'NonsTop', display: 'standalone', start_url: '/' });
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  );

  await page.goto('/');
  // `ready` resolves once a worker is active, which may still be in the "activating" state.
  const state = await page.evaluate(async () => {
    const worker = (await navigator.serviceWorker.ready).active!;
    if (worker.state !== 'activated') {
      await new Promise<void>((resolve) => {
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated') resolve();
        });
      });
    }
    return worker.state;
  });
  expect(state).toBe('activated');
});

test('offline: the app shell still loads from cache', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // let the service worker control the page
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Server tidak terjangkau')).toBeVisible();
  await context.setOffline(false);
});

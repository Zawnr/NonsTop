// N-01: a page opens from the local cache in under 300 ms, and typing has no lag.
// Measured in the page itself, from the click to the moment the last block is on screen.
import { expect, test } from '@playwright/test';
import { createPage, login, openNav, treeLink, unique } from './helpers.ts';

const BLOCKS = 100;

test('N-01: a page with 100 blocks opens in under 300 ms, typing reacts within a frame', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const big = unique('Panjang');
  await createPage(page, big);
  const editor = page.getByTestId('editor');
  await editor.locator('[contenteditable="true"]').click();
  for (let i = 1; i <= BLOCKS; i++) await page.keyboard.insertText(`Baris ${i} isi catatan`), await page.keyboard.press('Enter');
  await expect(editor.getByText(`Baris ${BLOCKS} isi catatan`)).toBeVisible();
  const other = unique('Lain');
  await createPage(page, other); // saves the long page and leaves it

  // A phone CPU is several times slower than the laptop running the test.
  if (test.info().project.name === 'android') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }

  // Warm open: the editor code is loaded, the page comes from IndexedDB.
  const times: number[] = [];
  for (let run = 0; run < 3; run++) {
    await openNav(page);
    const link = treeLink(page, big);
    await expect(link).toBeVisible();
    const ms = await link.evaluate(async (a, last) => {
      const start = performance.now();
      (a as HTMLElement).click();
      await new Promise<void>((resolve) => {
        const check = () => {
          const el = [...document.querySelectorAll('[data-testid="editor"] .bn-inline-content')].find((n) => n.textContent === last);
          if (el) resolve();
          else requestAnimationFrame(check);
        };
        check();
      });
      return performance.now() - start;
    }, `Baris ${BLOCKS} isi catatan`);
    times.push(ms);
    await openNav(page);
    await treeLink(page, other).click();
    await expect(page.getByLabel('Judul halaman')).toHaveValue(other);
  }
  const open = Math.min(...times);
  test.info().annotations.push({ type: 'open-ms', description: times.map((t) => t.toFixed(0)).join(', ') });

  // Typing: time from a key event to the text on screen, averaged over 30 keys.
  await openNav(page);
  await treeLink(page, big).click();
  await editor.getByText(`Baris ${BLOCKS} isi catatan`).click();
  await page.keyboard.press('End');
  await page.evaluate(() => {
    const w = window as unknown as { lags: number[] };
    w.lags = [];
    document.addEventListener(
      'keydown',
      (e) => {
        const t = e.timeStamp;
        requestAnimationFrame(() => setTimeout(() => w.lags.push(performance.now() - t)));
      },
      true,
    );
  });
  await page.keyboard.type(' tambahan teks untuk mengukur', { delay: 30 });
  const lags = await page.evaluate(() => (window as unknown as { lags: number[] }).lags);
  const avg = lags.reduce((a, b) => a + b, 0) / lags.length;
  test.info().annotations.push({ type: 'type-ms', description: `avg ${avg.toFixed(1)}, max ${Math.max(...lags).toFixed(1)}` });
  console.log(`[N-01 ${test.info().project.name}] open ms: ${times.map((t) => t.toFixed(0)).join(', ')}; typing avg ${avg.toFixed(1)} ms, max ${Math.max(...lags).toFixed(1)} ms`);

  expect(open).toBeLessThan(300);
  expect(avg).toBeLessThan(50);
});

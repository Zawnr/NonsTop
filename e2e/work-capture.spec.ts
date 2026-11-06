import { expect, test, type Page } from '@playwright/test';
import { addProperty, addRow, cell, createDatabase, pickOption, table } from './database-helpers.ts';
import { createPage, gotoStable, login, openNav, pageAction, pageActionNames, setTitle, unique } from './helpers.ts';

const isPhone = () => test.info().project.name === 'android';

/** Creates a project from the "Proyek" template and gives it a unique title. */
async function createProject(page: Page): Promise<string> {
  await openNav(page);
  await page.getByRole('complementary').getByRole('button', { name: 'Dari template…' }).click();
  const before = page.url();
  await page.getByRole('dialog', { name: 'Halaman dari template' }).getByRole('button', { name: /Proyek/ }).click();
  await expect(page).not.toHaveURL(before);
  await expect(page.getByLabel('Judul halaman')).toHaveValue('Proyek');
  const title = unique('Proyek');
  await setTitle(page, title);
  return title;
}

async function pickTicketDatabase(page: Page, project: string) {
  const dialog = page.getByRole('dialog', { name: 'Jadikan ticket' });
  await dialog.getByRole('button', { name: `${project} / Ticket` }).click();
  await expect(dialog.getByRole('status')).toContainText('Ticket dibuat');
  await dialog.getByRole('button', { name: 'Tutup' }).click();
}

test('project template: Ticket and Epic, an idea page becomes a backlog ticket with links both ways', async ({ page }) => {
  await login(page);
  const project = await createProject(page);
  await expect(page.getByRole('region', { name: 'Sub-halaman' }).getByRole('link')).toHaveText(['Ticket', 'Epic']);

  const idea = unique('Ide');
  await createPage(page, idea);
  await pageAction(page, 'Jadikan ticket');
  await pickTicketDatabase(page, project);

  // The idea stays and links to its ticket; the ticket links back.
  await expect(page.getByLabel('Judul halaman')).toHaveValue(idea);
  const links = page.getByLabel('Link ticket');
  await expect(links).toContainText('Ticket:');
  await links.getByRole('link', { name: idea }).click();
  await expect(page.getByLabel('Judul halaman')).toHaveValue(idea);
  await expect(page.getByLabel('Link ticket')).toContainText('Dari:');
  await expect(cell(page, 'Status', idea)).toHaveText('Backlog');
  expect(await pageActionNames(page)).not.toContain('Jadikan ticket');

  // Backlog view lists open tickets only; the board groups them by status.
  await page.getByRole('navigation', { name: 'Lokasi halaman' }).getByRole('link', { name: 'Ticket' }).click();
  await expect(page.getByRole('tab', { name: /Backlog/ })).toHaveAttribute('aria-selected', 'true');
  await expect(table(page).getByRole('button', { name: `Judul baris ${idea}` })).toBeVisible();
  await pickOption(page, 'Status', idea, 'Doing');
  await page.getByRole('tab', { name: /Board/ }).click();
  const board = page.getByRole('list', { name: 'Board menurut Status' });
  await expect(board.getByRole('listitem', { name: 'Kolom Doing' }).getByRole('group', { name: `Kartu ${idea}` })).toBeVisible();
  // Done in the "Semua" view (in Backlog the row would leave the view under the open picker).
  await page.getByRole('tab', { name: /Semua/ }).click();
  await pickOption(page, 'Status', idea, 'Done');
  await page.getByRole('tab', { name: /Backlog/ }).click();
  await expect(table(page).getByRole('button', { name: `Judul baris ${idea}` })).toHaveCount(0);
});

test('checklist item becomes a ticket from the slash menu, and its link opens the ticket in the app', async ({ page }) => {
  await login(page);
  const project = await createProject(page);
  const host = unique('Rencana');
  await createPage(page, host);

  const editor = page.getByTestId('editor');
  await editor.locator('[contenteditable="true"]').click();
  await page.keyboard.type('/checklist');
  await page.getByRole('option', { name: /^Checklist/ }).click();
  const task = unique('Tugas');
  await page.keyboard.type(task);
  await page.keyboard.type('/ticket');
  await page.getByRole('option', { name: /Jadikan ticket/ }).click();
  await pickTicketDatabase(page, project);

  const link = editor.getByRole('link', { name: `→ ${task}` });
  await expect(link).toBeVisible();
  await expect(editor).not.toContainText('/ticket');
  await link.click();
  await expect(page).toHaveURL(/\/p\//);
  await expect(page.getByLabel('Judul halaman')).toHaveValue(task);
  await expect(page.getByLabel('Link ticket').getByRole('link', { name: host })).toBeVisible();
});

test('checklist item becomes a ticket from the block menu', async ({ page }) => {
  test.skip(isPhone(), 'the block menu needs a pointer; phones use the slash menu');
  await login(page);
  const project = await createProject(page);
  const host = unique('Daftar');
  await createPage(page, host);
  const editor = page.getByTestId('editor');
  await editor.locator('[contenteditable="true"]').click();
  await page.keyboard.type('/checklist');
  await page.getByRole('option', { name: /^Checklist/ }).click();
  const task = unique('Item');
  await page.keyboard.type(task);

  await editor.getByText(task).hover();
  await page.getByRole('button', { name: 'Open block menu' }).click();
  await page.getByRole('menuitem', { name: 'Jadikan ticket' }).click();
  await pickTicketDatabase(page, project);
  await expect(editor.getByRole('link', { name: `→ ${task}` })).toBeVisible();
});

test('quick note: the launcher shortcut opens a new note in the Inbox, ready to type', async ({ page }) => {
  await login(page);
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.shortcuts).toEqual([expect.objectContaining({ name: 'Catatan baru', url: '/quick' })]);

  await gotoStable(page, '/quick');
  await expect(page).toHaveURL(/\/p\//);
  const title = page.getByLabel('Judul halaman');
  await expect(title).toHaveValue('');
  await expect(title).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Lokasi halaman' }).getByRole('link', { name: 'Inbox' })).toBeVisible();
  const note = unique('Catatan');
  await title.fill(note);
  await title.press('Enter');

  // Back goes to where the user was, not to /quick (which would make another note).
  await page.goBack();
  await expect(page).not.toHaveURL(/\/quick$/);
});

test('reminder: a date gets a reminder time, shown on the cell', async ({ page }) => {
  await login(page);
  await createDatabase(page, unique('Tenggat'));
  await addProperty(page, 'Tanggal', 'Deadline');
  const row = unique('Laporan');
  await addRow(page, row);

  // Next year, so the date stays in the future whenever the test runs.
  const year = new Date().getFullYear() + 1;
  await cell(page, 'Deadline', row).click();
  const pop = page.getByRole('dialog', { name: `Deadline: ${row}` });
  await pop.getByLabel('Tanggal mulai').fill(`${year}-12-01`);
  await pop.getByRole('button', { name: '+ Pengingat' }).click();
  await pop.getByLabel('Jam pengingat').fill('07:45');
  // The editor says when the notification comes (or why it will not).
  await expect(pop.getByRole('status')).toContainText(/Notifikasi muncul dalam \d+ hari/);
  await pop.getByRole('button', { name: 'Simpan' }).click();
  await expect(cell(page, 'Deadline', row)).toHaveText(new RegExp(`^1 Des ${year} 🔔 07:45 · \\d+ hari( \\d+ jam)? lagi$`));

  await cell(page, 'Deadline', row).click();
  await page.getByRole('dialog', { name: `Deadline: ${row}` }).getByRole('button', { name: 'Hapus pengingat' }).click();
  await page.getByRole('dialog', { name: `Deadline: ${row}` }).getByRole('button', { name: 'Simpan' }).click();
  await expect(cell(page, 'Deadline', row)).toHaveText(`1 Des ${year}`);

  // A time long past today is not sent, and the editor says so.
  await cell(page, 'Deadline', row).click();
  const again = page.getByRole('dialog', { name: `Deadline: ${row}` });
  await again.getByLabel('Tanggal mulai').fill('2020-01-01');
  await again.getByRole('button', { name: '+ Pengingat' }).click();
  await expect(again.getByRole('status')).toContainText('tidak dikirim');
});

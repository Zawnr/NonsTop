// Slash menu (F-03) in Indonesian, limited to the supported block types.
import { getDefaultSlashMenuItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core';
import { getDefaultReactSlashMenuItems, type DefaultReactSuggestionItem } from '@blocknote/react';
import type { Editor } from './schema.tsx';

const LABELS: Record<string, { title: string; subtext: string; aliases: string[] }> = {
  paragraph: { title: 'Teks', subtext: 'Paragraf biasa', aliases: ['teks', 'paragraf', 'p'] },
  heading: { title: 'Heading 1', subtext: 'Judul bagian besar', aliases: ['h1', 'judul'] },
  heading_2: { title: 'Heading 2', subtext: 'Judul bagian sedang', aliases: ['h2', 'subjudul'] },
  heading_3: { title: 'Heading 3', subtext: 'Judul bagian kecil', aliases: ['h3'] },
  bullet_list: { title: 'Bullet list', subtext: 'Daftar dengan titik', aliases: ['ul', 'daftar', 'bullet'] },
  numbered_list: { title: 'Numbered list', subtext: 'Daftar bernomor', aliases: ['ol', 'nomor', 'angka'] },
  check_list: { title: 'Checklist', subtext: 'Daftar tugas yang bisa dicentang', aliases: ['todo', 'tugas', 'cek', 'centang'] },
  toggle_list: { title: 'Toggle', subtext: 'Isi yang bisa dibuka dan ditutup', aliases: ['toggle', 'lipat'] },
  quote: { title: 'Quote', subtext: 'Kutipan', aliases: ['kutipan', 'blockquote'] },
  code_block: { title: 'Code', subtext: 'Blok kode', aliases: ['kode', 'code', 'pre'] },
  divider: { title: 'Divider', subtext: 'Garis pemisah', aliases: ['garis', 'hr', 'pemisah'] },
};
const GROUP = 'Blok';

/**
 * `createDatabase` creates the database record and returns its id (F-10). `onTicket` turns the
 * checklist item under the cursor into a ticket (F-41); the item only shows in checklist items.
 * On phones this is the way in, since the block menu needs a pointer.
 */
export function slashMenuItems(editor: Editor, createDatabase: () => string, onTicket?: (blockId: string) => void): DefaultReactSuggestionItem[] {
  const core = getDefaultSlashMenuItems(editor);
  const react = getDefaultReactSlashMenuItems(editor); // same order as core, with icons
  const items: DefaultReactSuggestionItem[] = [];
  core.forEach((item, i) => {
    const label = LABELS[item.key];
    if (!label) return; // emoji and anything not in F-03
    items.push({ ...react[i]!, ...label, group: GROUP, badge: undefined });
  });
  const quoteAt = items.findIndex((i) => i.title === 'Quote');
  items.splice(quoteAt + 1, 0, {
    title: 'Callout',
    subtext: 'Catatan yang menonjol dengan ikon',
    aliases: ['callout', 'info', 'catatan', 'peringatan'],
    group: GROUP,
    icon: <span aria-hidden="true">💡</span>,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'callout' }),
  });
  items.push({
    title: 'Database',
    subtext: 'Tabel inline dengan properti dan baris',
    aliases: ['database', 'tabel', 'table', 'db'],
    group: GROUP,
    icon: <span aria-hidden="true">▦</span>,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'database', props: { databaseId: createDatabase() } }),
  });
  const current = editor.getTextCursorPosition().block;
  if (onTicket && current.type === 'checkListItem') {
    items.unshift({
      title: 'Jadikan ticket',
      subtext: 'Buat ticket dari tugas ini, dengan link balik',
      aliases: ['ticket', 'tiket', 'backlog'],
      group: 'Tugas',
      icon: <span aria-hidden="true">🎯</span>,
      onItemClick: () => onTicket(current.id),
    });
  }
  return items;
}

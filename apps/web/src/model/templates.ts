// Built-in page templates (F-30). Each one is a virtual page that is copied like a user template,
// so applying either kind goes through the same copy plan.
import type { Block, BlockType } from '@nonstop/shared';
import type { Stored } from '../data/db.ts';
import type { CopySource } from './copy.ts';
import { keyBetween } from './pages.ts';
import { projectSource } from './project.ts';

interface TemplateBlock {
  type: BlockType;
  text?: string;
  props?: Record<string, string | number | boolean>;
}

export interface BuiltinTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  blocks: TemplateBlock[];
  /** Title of a page created from the template. Empty = untitled. */
  title?: string;
  /** A template with sub-pages and databases supplies its whole copy source. */
  source?: () => { rootId: string; source: CopySource };
}

const h = (text: string): TemplateBlock => ({ type: 'heading', text, props: { level: 2 } });
const p = (text = ''): TemplateBlock => ({ type: 'paragraph', text });
const bullet = (text = ''): TemplateBlock => ({ type: 'bulletListItem', text });
const step = (text = ''): TemplateBlock => ({ type: 'numberedListItem', text });
const check = (text = ''): TemplateBlock => ({ type: 'checkListItem', text, props: { checked: false } });

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'builtin-idea-canvas',
    name: 'Kanvas ide',
    icon: '💡',
    description: 'Ide besar, pain point, flow, success metric',
    blocks: [
      h('Ide besar'),
      p('Satu kalimat: apa idenya dan untuk siapa.'),
      h('Pain point'),
      bullet('Masalah apa yang dirasakan sekarang?'),
      bullet(),
      h('Flow'),
      step('Langkah pertama pengguna'),
      step(),
      h('Success metric'),
      bullet('Angka yang menandakan ide ini berhasil'),
      bullet(),
    ],
  },
  {
    id: 'builtin-trip-plan',
    name: 'Rencana trip',
    icon: '🧳',
    description: 'Rute, checklist barang, todo',
    blocks: [
      h('Rute'),
      step('Berangkat dari'),
      step('Tujuan'),
      step('Pulang'),
      h('Checklist barang'),
      check('KTP atau paspor'),
      check('Charger dan power bank'),
      check('Pakaian'),
      check('Obat pribadi'),
      h('Todo'),
      check('Pesan tiket'),
      check('Pesan penginapan'),
      check('Cek cuaca'),
    ],
  },
  {
    id: 'builtin-project',
    name: 'Proyek',
    icon: '🎯',
    description: 'Database Ticket dan Epic, view Backlog dan Board',
    title: 'Proyek',
    blocks: [],
    source: projectSource,
  },
];

/** A built-in template as a copy source: one virtual page with its blocks. */
export function builtinSource(template: BuiltinTemplate): { rootId: string; source: CopySource } {
  if (template.source) return template.source();
  let key: string | null = null;
  const blocks: Stored<Block>[] = template.blocks.map((b, i) => ({
    id: `${template.id}-${i}`,
    _hlc: {},
    pageId: template.id,
    parentId: null,
    sortKey: (key = keyBetween(key, null)),
    type: b.type,
    props: b.props ?? {},
    content: b.text ? [{ type: 'text', text: b.text, styles: {} }] : [],
    deleted: false,
  }));
  return {
    rootId: template.id,
    source: {
      pages: [{ id: template.id, _hlc: {}, title: template.name, deleted: false, trashedAt: null, parentId: null }],
      blocks,
      databases: [],
      properties: [],
      views: [],
    },
  };
}

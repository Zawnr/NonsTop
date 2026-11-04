// Editor schema: the block types of F-03, plus a custom callout block.
import { BlockNoteSchema, createHeadingBlockSpec, defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs } from '@blocknote/core';
import { createReactBlockSpec } from '@blocknote/react';

const CALLOUT_ICONS = ['💡', '⚠️', '✅', '❗', '📌'] as const;

export const calloutBlock = createReactBlockSpec(
  {
    type: 'callout',
    propSchema: { icon: { default: '💡' } },
    content: 'inline',
  },
  {
    render: ({ block, editor, contentRef }) => {
      const next = () => {
        const i = CALLOUT_ICONS.indexOf(block.props.icon as (typeof CALLOUT_ICONS)[number]);
        editor.updateBlock(block, { props: { icon: CALLOUT_ICONS[(i + 1) % CALLOUT_ICONS.length] } });
      };
      return (
        <div className="callout">
          <button type="button" className="callout-icon" contentEditable={false} onClick={next} aria-label="Ganti ikon callout" disabled={!editor.isEditable}>
            {block.props.icon}
          </button>
          <div className="callout-text" ref={contentRef} />
        </div>
      );
    },
  },
);

const { paragraph, bulletListItem, numberedListItem, checkListItem, toggleListItem, quote, codeBlock, divider } = defaultBlockSpecs;

export const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph,
    heading: createHeadingBlockSpec({ levels: [1, 2, 3] }),
    bulletListItem,
    numberedListItem,
    checkListItem,
    toggleListItem,
    quote,
    callout: calloutBlock(),
    codeBlock,
    divider,
  },
  inlineContentSpecs: defaultInlineContentSpecs,
  styleSpecs: defaultStyleSpecs,
});

export type Editor = typeof schema.BlockNoteEditor;

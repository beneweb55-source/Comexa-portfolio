"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";

/**
 * Éditeur riche (Tiptap). Le contenu circule en JSON (pas de HTML) : c'est le format
 * stocké côté API, ce qui évite d'enregistrer du balisage non maîtrisé.
 */
export default function RichEditor({ initialContent, editable = true, onReady, placeholder = "Décrivez votre journée…" }) {
  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder })],
    content: initialContent ?? { type: "doc", content: [{ type: "paragraph" }] },
    editable,
    immediatelyRender: false,
    onCreate: ({ editor: created }) => onReady?.(created),
  });

  if (!editor) return <div className="min-h-[220px] rounded-2xl border border-[var(--comexa-border-soft)] bg-[var(--comexa-surface)]" aria-busy="true" />;

  return (
    <div className="rounded-2xl border border-[var(--comexa-border-soft)] bg-[var(--comexa-surface)]">
      {editable ? <Toolbar editor={editor} /> : null}
      <EditorContent
        editor={editor}
        className="cx-rich min-h-[220px] px-4 py-3 text-[15px] leading-relaxed text-[var(--comexa-ink)] [&_.ProseMirror]:min-h-[190px] [&_.ProseMirror]:outline-none [&_.ProseMirror_h2]:mt-3 [&_.ProseMirror_h2]:text-[18px] [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0 [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-[var(--comexa-ink-muted)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none"
      />
    </div>
  );
}

function Toolbar({ editor }) {
  const buttons = [
    { label: "Titre", title: "Titre", active: () => editor.isActive("heading", { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "G", title: "Gras", active: () => editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run(), className: "font-bold" },
    { label: "I", title: "Italique", active: () => editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run(), className: "italic" },
    { label: "•", title: "Liste à puces", active: () => editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: "1.", title: "Liste numérotée", active: () => editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() },
  ];
  return (
    <div role="toolbar" aria-label="Mise en forme" className="flex flex-wrap gap-1 border-b border-[var(--comexa-border-soft)] p-2">
      {buttons.map((b) => (
        <button
          key={b.title}
          type="button"
          title={b.title}
          aria-label={b.title}
          aria-pressed={b.active()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={b.run}
          className={`min-w-[34px] rounded-lg px-2 py-1 text-[13px] ${b.className ?? ""} ${b.active() ? "bg-[var(--comexa-ink)] text-white" : "text-[var(--comexa-ink-soft)] hover:bg-[var(--comexa-neutral-100)]"}`}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Undo,
  Redo,
  Link as LinkIcon,
  Image as ImageIcon,
  Table as TableIcon,
  X,
  Download,
  Sparkles,
  ChevronDown,
  RotateCcw,
  Send,
  Mic,
} from 'lucide-react';

interface DocumentEditorProps {
  title: string;
  content: string;
  onChange: (content: string) => void;
  onClose: () => void;
  onDownload: () => void;
  documentType: 'word' | 'excel' | 'ppt';
}

const fontFamilies = [
  { label: 'Inter', value: 'Inter, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
  { label: 'Playfair Display', value: '"Playfair Display", serif' },
];

const fontSizes = ['12', '14', '16', '18', '20', '24', '28', '32', '36', '48'];

export function DocumentEditor({
  title,
  content,
  onChange,
  onClose,
  onDownload,
  documentType,
}: DocumentEditorProps) {
  const [showAIRewrite, setShowAIRewrite] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [rewriteText, setRewriteText] = useState('');
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const aiPanelRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      TextStyle,
      FontFamily,
      Color,
      Highlight.configure({
        multicolor: true,
      }),
      Link.configure({
        openOnClick: false,
      }),
      Image,
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: convertMarkdownToHTML(content),
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-lg max-w-none focus:outline-none min-h-[800px] template-emily',
      },
    },
  });

  const handleTextSelection = useCallback(() => {
    if (!editor) return;
    
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return;
    }

    const text = selection.toString();
    if (text.trim().length < 2) return;

    // Save the range for later restoration
    savedRangeRef.current = selection.getRangeAt(0).cloneRange();
    
    // Get position for popover
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    setSelectedText(text);
    setRewriteText(text);
    setSelectionRect(rect);
    setShowAIRewrite(true);
  }, [editor]);

  const handleApplyRewrite = useCallback(() => {
    if (!editor || !savedRangeRef.current) return;

    // Restore the selection
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(savedRangeRef.current);
    }

    // Replace the selected text
    editor.chain().focus().deleteSelection().insertContent(rewriteText).run();
    
    setShowAIRewrite(false);
    setSelectedText('');
    setRewriteText('');
    savedRangeRef.current = null;
  }, [editor, rewriteText]);

  const handleCancelRewrite = useCallback(() => {
    setShowAIRewrite(false);
    setSelectedText('');
    setRewriteText('');
    savedRangeRef.current = null;
    window.getSelection()?.removeAllRanges();
  }, []);

  const handleRevert = useCallback(() => {
    setRewriteText(selectedText);
  }, [selectedText]);

  // Listen for mouseup to detect text selection
  useEffect(() => {
    const handleMouseUp = () => {
      setTimeout(handleTextSelection, 10);
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [handleTextSelection]);

  if (!editor) return null;

  return (
    <div className="document-editor-container flex h-full bg-gray-100 dark:bg-gray-900">
      {/* Workspace */}
      <div className="workspace flex-1 flex flex-col overflow-hidden">
        {/* Top Action Bar */}
        <div className="action-bar flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-800 border-b">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{title}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="default" size="sm" onClick={onDownload} className="gap-2">
              <Download className="h-4 w-4" />
              Descargar
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Sticky Toolbar */}
        <div className="toolbar sticky top-0 z-50 bg-white dark:bg-gray-800 border-b px-4 py-2">
          <div className="flex items-center gap-1 flex-wrap">
            {/* Undo/Redo */}
            <div className="flex items-center gap-0.5 pr-2 border-r">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!editor.can().undo()}
              >
                <Undo className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!editor.can().redo()}
              >
                <Redo className="h-4 w-4" />
              </Button>
            </div>

            {/* Text Style Dropdown */}
            <div className="flex items-center gap-1 px-2 border-r">
              <select
                className="text-xs border rounded px-2 py-1.5 bg-transparent min-w-[100px]"
                value={
                  editor.isActive('heading', { level: 1 })
                    ? 'h1'
                    : editor.isActive('heading', { level: 2 })
                    ? 'h2'
                    : editor.isActive('heading', { level: 3 })
                    ? 'h3'
                    : 'p'
                }
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === 'p') {
                    editor.chain().focus().setParagraph().run();
                  } else {
                    const level = parseInt(value.replace('h', '')) as 1 | 2 | 3;
                    editor.chain().focus().toggleHeading({ level }).run();
                  }
                }}
              >
                <option value="p">Normal Text</option>
                <option value="h1">Heading 1</option>
                <option value="h2">Heading 2</option>
                <option value="h3">Heading 3</option>
              </select>

              <select
                className="text-xs border rounded px-2 py-1.5 bg-transparent min-w-[90px]"
                onChange={(e) => {
                  editor.chain().focus().setFontFamily(e.target.value).run();
                }}
              >
                {fontFamilies.map((font) => (
                  <option key={font.value} value={font.value}>
                    {font.label}
                  </option>
                ))}
              </select>

              <select
                className="text-xs border rounded px-2 py-1.5 bg-transparent w-16"
                onChange={(e) => {
                  // Font size would need a custom extension
                }}
              >
                {fontSizes.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>

            {/* Text Formatting */}
            <div className="flex items-center gap-0.5 px-2 border-r">
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', editor.isActive('bold') && 'bg-gray-200 dark:bg-gray-700')}
                onClick={() => editor.chain().focus().toggleBold().run()}
              >
                <Bold className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', editor.isActive('italic') && 'bg-gray-200 dark:bg-gray-700')}
                onClick={() => editor.chain().focus().toggleItalic().run()}
              >
                <Italic className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', editor.isActive('underline') && 'bg-gray-200 dark:bg-gray-700')}
                onClick={() => editor.chain().focus().toggleUnderline().run()}
              >
                <UnderlineIcon className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', editor.isActive('strike') && 'bg-gray-200 dark:bg-gray-700')}
                onClick={() => editor.chain().focus().toggleStrike().run()}
              >
                <Strikethrough className="h-4 w-4" />
              </Button>
            </div>

            {/* Alignment */}
            <div className="flex items-center gap-0.5 px-2 border-r">
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', editor.isActive({ textAlign: 'left' }) && 'bg-gray-200 dark:bg-gray-700')}
                onClick={() => editor.chain().focus().setTextAlign('left').run()}
              >
                <AlignLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', editor.isActive({ textAlign: 'center' }) && 'bg-gray-200 dark:bg-gray-700')}
                onClick={() => editor.chain().focus().setTextAlign('center').run()}
              >
                <AlignCenter className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', editor.isActive({ textAlign: 'right' }) && 'bg-gray-200 dark:bg-gray-700')}
                onClick={() => editor.chain().focus().setTextAlign('right').run()}
              >
                <AlignRight className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', editor.isActive({ textAlign: 'justify' }) && 'bg-gray-200 dark:bg-gray-700')}
                onClick={() => editor.chain().focus().setTextAlign('justify').run()}
              >
                <AlignJustify className="h-4 w-4" />
              </Button>
            </div>

            {/* Lists */}
            <div className="flex items-center gap-0.5 px-2">
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', editor.isActive('bulletList') && 'bg-gray-200 dark:bg-gray-700')}
                onClick={() => editor.chain().focus().toggleBulletList().run()}
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', editor.isActive('orderedList') && 'bg-gray-200 dark:bg-gray-700')}
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
              >
                <ListOrdered className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Document Canvas Area */}
        <div className="canvas-area">
          <div className="page-container">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      {/* AI Rewrite Panel - Portal to body, positioned near selection */}
      {showAIRewrite && createPortal(
        <div
          ref={aiPanelRef}
          className="fixed z-[1000] animate-in fade-in duration-200"
          style={{
            top: selectionRect 
              ? Math.min(Math.max(selectionRect.bottom + 8, 60), window.innerHeight - 340)
              : 'auto',
            left: selectionRect 
              ? Math.max(Math.min(selectionRect.left, window.innerWidth - 420), 20)
              : 24,
            bottom: selectionRect ? 'auto' : 24,
            width: '400px',
          }}
        >
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50 dark:bg-gray-900">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-teal-600" />
                <span className="font-semibold text-sm">AI Rewrite</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleCancelRewrite}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-4">
              {/* Original text preview */}
              <div className="text-sm text-gray-700 dark:text-gray-300 mb-3 p-3 bg-gray-100 dark:bg-gray-900 rounded-lg border max-h-20 overflow-auto">
                {selectedText}
              </div>
              
              {/* Editable textarea */}
              <div className="relative">
                <textarea
                  value={rewriteText}
                  onChange={(e) => setRewriteText(e.target.value)}
                  className="w-full min-h-[80px] p-3 pr-16 text-sm border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white dark:bg-gray-900"
                  placeholder="Pedir a Genspark que mejore la escritura..."
                />
                <div className="absolute bottom-2 right-2 flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                    <Mic className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-teal-600 hover:text-teal-700"
                    onClick={handleApplyRewrite}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-between mt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRevert}
                  disabled={rewriteText === selectedText}
                  className="text-muted-foreground gap-1"
                >
                  <RotateCcw className="h-3 w-3" />
                  Revertir
                </Button>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleCancelRewrite}>
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleApplyRewrite}
                    className="bg-teal-600 hover:bg-teal-700 text-white"
                  >
                    Aplicar cambios
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// Helper function to convert markdown to HTML for TipTap
function convertMarkdownToHTML(markdown: string): string {
  if (!markdown) return '<p></p>';
  
  let html = markdown
    // Headings
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // Bold and Italic
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Lists
    .replace(/^\s*[-*] (.*$)/gim, '<li>$1</li>')
    .replace(/^\s*\d+\. (.*$)/gim, '<li>$1</li>')
    // Blockquotes
    .replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>')
    // Paragraphs (lines not already wrapped)
    .split('\n')
    .map(line => {
      if (line.match(/^<(h[1-3]|li|blockquote|ul|ol)/)) return line;
      if (line.trim() === '') return '';
      if (!line.startsWith('<')) return `<p>${line}</p>`;
      return line;
    })
    .join('');

  // Wrap consecutive li items in ul
  html = html.replace(/(<li>.*?<\/li>)+/g, '<ul>$&</ul>');
  
  return html || '<p></p>';
}

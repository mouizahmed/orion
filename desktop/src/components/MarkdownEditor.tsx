import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type CSSProperties,
  type ForwardedRef,
} from 'react'
import { Camera, Loader2, Sparkles } from 'lucide-react'
import AISelectionPopover from './AISelectionPopover'
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  linkPlugin,
  linkDialogPlugin,
  markdownShortcutPlugin,
  thematicBreakPlugin,
  tablePlugin,
  imagePlugin,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  CodeToggle,
  StrikeThroughSupSubToggles,
  ListsToggle,
  BlockTypeSelect,
  CreateLink,
  InsertTable,
  InsertThematicBreak,
  Separator,
  type MDXEditorMethods,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import { uploadNoteImage } from '@/lib/notes-client'

type MarkdownEditorProps = {
  markdown: string
  onChange: (value: string) => void
  placeholder?: string
  theme?: 'dark' | 'auto'
  showToolbar?: boolean
  className?: string
  noteId?: string
  onEnhance?: () => void
  isEnhancing?: boolean
  canEnhance?: boolean
}

export type MarkdownEditorHandle = {
  focus: () => void
  blur: () => void
  isFocused: () => boolean
}

type ToolbarContentsProps = {
  onEnhance?: () => void
  isEnhancing?: boolean
  canEnhance?: boolean
}

function ToolbarContents({ onEnhance, isEnhancing = false, canEnhance = true }: ToolbarContentsProps) {
  return (
    <>
      <UndoRedo />
      <Separator />
      <BoldItalicUnderlineToggles />
      <CodeToggle />
      <Separator />
      <StrikeThroughSupSubToggles />
      <Separator />
      <ListsToggle />
      <Separator />
      <BlockTypeSelect />
      <Separator />
      <div role="group" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
        <CreateLink />
        <InsertTable />
        <InsertThematicBreak />
      </div>
      {onEnhance ? (
        <>
          <Separator />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onEnhance}
            disabled={isEnhancing || !canEnhance}
            title="Enhance note with AI"
            className="inline-flex h-8 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-violet-400/25 bg-violet-500/15 px-3 text-xs font-medium leading-none text-violet-700 outline-none transition-colors hover:bg-violet-500/20 hover:text-violet-800 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-300/20 dark:bg-violet-400/15 dark:text-violet-200 dark:hover:bg-violet-400/20 dark:hover:text-violet-100"
            style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
          >
            {isEnhancing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Enhance
          </button>
        </>
      ) : null}
    </>
  )
}

function useDarkMode(theme: 'dark' | 'auto') {
  const [isDark, setIsDark] = useState(() => {
    if (theme === 'dark') return true
    return document.documentElement.classList.contains('dark')
  })

  useEffect(() => {
    if (theme === 'dark') { setIsDark(true); return }
    const obs = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [theme])

  return isDark
}

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function getImageFiles(dataTransfer: DataTransfer): File[] {
  return Array.from(dataTransfer.files).filter((f) => IMAGE_MIME_TYPES.has(f.type))
}

function MarkdownEditorInner(
  {
    markdown,
    onChange,
    placeholder,
    theme = 'auto',
    showToolbar = false,
    className,
    noteId,
    onEnhance,
    isEnhancing = false,
    canEnhance = true,
  }: MarkdownEditorProps,
  ref: ForwardedRef<MarkdownEditorHandle>,
) {
  const editorRef = useRef<MDXEditorMethods>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isInternalChangeRef = useRef(false)
  const hasMountedRef = useRef(false)
  const isDark = useDarkMode(theme)
  const noteIdRef = useRef(noteId)
  noteIdRef.current = noteId
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const dragCounterRef = useRef(0)

  // Plugins are stateful — each editor instance needs its own fresh array
  const plugins = useMemo(() => {
    const base = [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      markdownShortcutPlugin(),
      thematicBreakPlugin(),
      tablePlugin(),
      imagePlugin(),
    ]
    if (showToolbar) {
      base.push(
        toolbarPlugin({
          toolbarContents: () => (
            <ToolbarContents
              onEnhance={onEnhance}
              isEnhancing={isEnhancing}
              canEnhance={canEnhance}
            />
          ),
        }),
      )
    }
    return base
  }, [canEnhance, isEnhancing, onEnhance, showToolbar])

  const handleImageFiles = useCallback(async (files: File[]) => {
    const currentNoteId = noteIdRef.current
    if (!currentNoteId || !editorRef.current || files.length === 0) return

    setIsUploading(true)
    try {
      for (const file of files) {
        try {
          const url = await uploadNoteImage(currentNoteId, file)
          const imageMarkdown = `![${file.name}](${url})`
          const current = editorRef.current?.getMarkdown() ?? ''
          const updated = current ? `${current}\n\n${imageMarkdown}` : imageMarkdown
          isInternalChangeRef.current = true
          onChangeRef.current(updated)
          editorRef.current?.setMarkdown(updated)
        } catch (e) {
          console.error('Image upload failed:', e)
        }
      }
    } finally {
      setIsUploading(false)
    }
  }, [])

  const handleDragEnter = useCallback((e: ReactDragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: ReactDragEvent) => {
    e.preventDefault()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: ReactDragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragging(false)
    const images = getImageFiles(e.dataTransfer)
    if (images.length === 0) return
    void handleImageFiles(images)
  }, [handleImageFiles])

  const handleDragOver = useCallback((e: ReactDragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const images = getImageFiles(e.clipboardData)
    if (images.length === 0) return
    e.preventDefault()
    void handleImageFiles(images)
  }, [handleImageFiles])

  // Sync external markdown changes (e.g. note switch) into the editor
  useEffect(() => {
    if (!editorRef.current) return
    if (isInternalChangeRef.current) {
      isInternalChangeRef.current = false
      return
    }
    editorRef.current.setMarkdown(markdown)
  }, [markdown])

  const handleChange = (value: string) => {
    // Ignore the initial normalization onChange that MDXEditor fires on mount
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return
    }
    isInternalChangeRef.current = true
    onChange(value)
  }

  const getMarkdown = useCallback(() => editorRef.current?.getMarkdown() ?? '', [])
  const handleSetMarkdown = useCallback((md: string) => {
    if (!editorRef.current) return
    isInternalChangeRef.current = true
    editorRef.current.setMarkdown(md)
  }, [])

  useImperativeHandle(ref, () => ({
    focus: () => {
      editorRef.current?.focus(undefined, {
        defaultSelection: 'rootEnd',
        preventScroll: true,
      })
    },
    blur: () => {
      const activeElement = document.activeElement
      if (activeElement instanceof HTMLElement && containerRef.current?.contains(activeElement)) {
        activeElement.blur()
      }
    },
    isFocused: () => {
      const activeElement = document.activeElement
      return Boolean(activeElement && containerRef.current?.contains(activeElement))
    },
  }), [])

  return (
    <div
      ref={containerRef}
      onDragEnter={noteId ? handleDragEnter : undefined}
      onDragLeave={noteId ? handleDragLeave : undefined}
      onDrop={noteId ? handleDrop : undefined}
      onDragOver={noteId ? handleDragOver : undefined}
      onPaste={noteId ? handlePaste : undefined}
      className="relative h-full"
    >
      <MDXEditor
        ref={editorRef}
        markdown={markdown}
        onChange={handleChange}
        placeholder={placeholder}
        plugins={plugins}
        contentEditableClassName="mdx-content-editable"
        className={`mdx-editor-root ${isDark ? 'dark-theme dark-editor' : ''} ${className ?? ''}`}
      />

      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-neutral-900/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              <div className="absolute -left-3 -top-1 h-16 w-20 rotate-[-8deg] rounded-lg border border-neutral-600 bg-neutral-800" />
              <div className="absolute -right-3 -top-1 h-16 w-20 rotate-[8deg] rounded-lg border border-neutral-600 bg-neutral-800" />
              <div className="relative z-10 flex h-16 w-20 items-center justify-center rounded-lg border border-neutral-500 bg-neutral-700">
                <Camera className="h-6 w-6 text-teal-400" />
              </div>
            </div>
            <div className="mt-2 text-center">
              <p className="text-sm font-semibold text-white">Attach images</p>
              <p className="text-xs text-neutral-400">Enhance your notes with visual context</p>
            </div>
          </div>
        </div>
      )}

      {isUploading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-neutral-900/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-teal-400" />
            <p className="text-sm font-medium text-white">Uploading image...</p>
          </div>
        </div>
      )}

      <AISelectionPopover
        editorContainerRef={containerRef}
        getMarkdown={getMarkdown}
        setMarkdown={handleSetMarkdown}
        onChange={onChange}
        noteId={noteId}
      />
    </div>
  )
}

const MarkdownEditor = memo(forwardRef(MarkdownEditorInner))
export default MarkdownEditor

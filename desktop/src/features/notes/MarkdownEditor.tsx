import {
  Fragment,
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
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { Camera, Loader2 } from 'lucide-react'
import EditorContextMenu, { type EditorCommand } from '@/features/notes/EditorContextMenu'
import {
  MDXEditor,
  activePlugins$,
  allowedHeadingLevels$,
  createRootEditorSubscription$,
  convertSelectionToNode$,
  currentBlockType$,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  realmPlugin,
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
  CreateLink,
  InsertTable,
  InsertThematicBreak,
  Separator,
  type BlockType,
  type HEADING_LEVEL,
  type MDXEditorMethods,
} from '@mdxeditor/editor'
import { useCellValue, usePublisher } from '@mdxeditor/gurx'
import { $createHeadingNode, $createQuoteNode, type HeadingTagType } from '@lexical/rich-text'
import { $createParagraphNode } from 'lexical'
import '@mdxeditor/editor/style.css'
import { uploadNoteImage } from '@/features/notes/api/notes-client'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type MarkdownEditorProps = {
  markdown: string
  onChange: (value: string) => void
  placeholder?: string
  theme?: 'dark' | 'auto'
  showToolbar?: boolean
  className?: string
  noteId?: string
  toolbarLeading?: ReactNode
  bottomOverlayInset?: number
}

export type MarkdownEditorHandle = {
  focus: () => void
  blur: () => void
  isFocused: () => boolean
}

type ToolbarContentsProps = { leading?: ReactNode }

type BlockTypeOption = {
  label: string
  value: BlockType
}

function DashboardBlockTypeSelect() {
  const convertSelectionToNode = usePublisher(convertSelectionToNode$)
  const currentBlockType = useCellValue(currentBlockType$)
  const activePlugins = useCellValue(activePlugins$)
  const allowedHeadingLevels = useCellValue(allowedHeadingLevels$)

  const hasQuote = activePlugins.includes('quote')
  const hasHeadings = activePlugins.includes('headings')
  if (!hasQuote && !hasHeadings) return null

  const options: BlockTypeOption[] = [{ label: 'Paragraph', value: 'paragraph' }]
  if (hasQuote) options.push({ label: 'Quote', value: 'quote' })
  if (hasHeadings) {
    options.push(...allowedHeadingLevels.map((level: HEADING_LEVEL) => ({
      label: `Heading ${level}`,
      value: `h${level}` as BlockType,
    })))
  }

  const handleChange = (blockType: string) => {
    switch (blockType as BlockType) {
      case 'quote':
        convertSelectionToNode(() => $createQuoteNode())
        break
      case 'paragraph':
      case '':
        convertSelectionToNode(() => $createParagraphNode())
        break
      default:
        convertSelectionToNode(() => $createHeadingNode(blockType as HeadingTagType))
    }
  }

  return (
    <Select value={currentBlockType || 'paragraph'} onValueChange={handleChange}>
      <SelectTrigger
        className="dashboard-block-type-trigger"
        title="Select block type"
        style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      >
        <SelectValue placeholder="Block type" />
      </SelectTrigger>
      <SelectContent align="start" width="md">
        {options.map((option, index) => (
          <Fragment key={option.value}>
            {index === 2 ? <SelectSeparator /> : null}
            <SelectItem value={option.value} checkPosition="left">{option.label}</SelectItem>
          </Fragment>
        ))}
      </SelectContent>
    </Select>
  )
}

function ToolbarContents({ leading }: ToolbarContentsProps) {
  return (
    <div className="dashboard-toolbar-layout">
      {leading ? <div className="dashboard-toolbar-leading">{leading}</div> : null}
      <div className="dashboard-toolbar-controls">
        <UndoRedo />
        <Separator />
        <BoldItalicUnderlineToggles />
        <CodeToggle />
        <Separator />
        <StrikeThroughSupSubToggles />
        <Separator className="dashboard-toolbar-responsive-break" />
        <ListsToggle />
        <Separator />
        <DashboardBlockTypeSelect />
        <Separator />
        <div role="group" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <CreateLink />
          <InsertTable />
          <InsertThematicBreak />
        </div>
      </div>
    </div>
  )
}

type BottomOverlayCaretPluginParams = {
  getContainer: () => HTMLDivElement | null
  getInset: () => number
}

function keepCaretAboveBottomOverlay(container: HTMLDivElement | null, bottomInset: number) {
  if (!container || bottomInset <= 0) return

  const selection = document.getSelection()
  if (!selection?.isCollapsed || selection.rangeCount === 0) return

  const editable = container.querySelector<HTMLElement>('.mdx-content-editable')
  const anchorNode = selection.anchorNode
  if (!editable || !anchorNode || !editable.contains(anchorNode)) return

  const scrollContainer = editable.closest<HTMLElement>('.mdxeditor-root-contenteditable')
  if (!scrollContainer) return

  const rangeRect = selection.getRangeAt(0).getBoundingClientRect()
  const anchorElement = anchorNode instanceof HTMLElement ? anchorNode : anchorNode.parentElement
  const caretRect = rangeRect.bottom > 0 ? rangeRect : anchorElement?.getBoundingClientRect()
  if (!caretRect) return

  const safeBottom = scrollContainer.getBoundingClientRect().bottom - bottomInset
  if (caretRect.bottom > safeBottom) {
    scrollContainer.scrollTop += caretRect.bottom - safeBottom + 4
  }
}

const bottomOverlayCaretPlugin = realmPlugin<BottomOverlayCaretPluginParams>({
  init(realm, params) {
    if (!params) return
    realm.pub(createRootEditorSubscription$, (editor) =>
      editor.registerUpdateListener(() => {
        keepCaretAboveBottomOverlay(params.getContainer(), params.getInset())
      }),
    )
  },
})

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
    toolbarLeading,
    bottomOverlayInset = 0,
  }: MarkdownEditorProps,
  ref: ForwardedRef<MarkdownEditorHandle>,
) {
  const editorRef = useRef<MDXEditorMethods>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomOverlayInsetRef = useRef(bottomOverlayInset)
  bottomOverlayInsetRef.current = bottomOverlayInset
  const isInternalChangeRef = useRef(false)
  const hasMountedRef = useRef(false)
  const isDark = useDarkMode(theme)
  const noteIdRef = useRef(noteId)
  noteIdRef.current = noteId
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)
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
      bottomOverlayCaretPlugin({
        getContainer: () => containerRef.current,
        getInset: () => bottomOverlayInsetRef.current,
      }),
    ]
    if (showToolbar) {
      base.push(
        toolbarPlugin({
          toolbarContents: () => (
            <ToolbarContents leading={toolbarLeading} />
          ),
        }),
      )
    }
    return base
  }, [showToolbar, toolbarLeading])

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

  const focusEditorEnd = useCallback(() => {
    editorRef.current?.focus(() => {
      const editable = containerRef.current?.querySelector<HTMLElement>('.mdx-content-editable')
      const selection = window.getSelection()
      if (!editable || !selection) return
      const range = document.createRange()
      range.selectNodeContents(editable)
      range.collapse(false)
      selection.removeAllRanges()
      selection.addRange(range)
    }, {
      defaultSelection: 'rootEnd',
      preventScroll: true,
    })
  }, [])

  const handleEditorCanvasMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.defaultPrevented) return

    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest('button, input, textarea, select, a, [role="dialog"], [role="menu"]')) return

    const editable = containerRef.current?.querySelector<HTMLElement>('.mdx-content-editable')
    if (!editable) return

    const contentBlocks = editable.querySelectorAll<HTMLElement>(
      'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, hr, img',
    )
    const lastBlock = contentBlocks.item(contentBlocks.length - 1)
    if (lastBlock && event.clientY < lastBlock.getBoundingClientRect().bottom) return

    event.preventDefault()
    focusEditorEnd()
  }, [focusEditorEnd])

  const handleEditorContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element) || !target.closest('.mdx-content-editable')) return
    if (!window.editorContextMenu?.run) return
    event.preventDefault()
    const selection = window.getSelection()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      hasSelection: Boolean(selection && !selection.isCollapsed && selection.toString()),
    })
  }, [])

  const runEditorCommand = useCallback((command: EditorCommand) => {
    window.editorContextMenu?.run(command)
  }, [])

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

  useImperativeHandle(ref, () => ({
    focus: focusEditorEnd,
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
  }), [focusEditorEnd])

  return (
    <div
      ref={containerRef}
      onDragEnter={noteId ? handleDragEnter : undefined}
      onDragLeave={noteId ? handleDragLeave : undefined}
      onDrop={noteId ? handleDrop : undefined}
      onDragOver={noteId ? handleDragOver : undefined}
      onPaste={noteId ? handlePaste : undefined}
      onMouseDownCapture={handleEditorCanvasMouseDown}
      onContextMenu={handleEditorContextMenu}
      className="relative h-full min-w-0 max-w-full overflow-hidden"
      style={{ '--editor-bottom-overlay-inset': `${bottomOverlayInset}px` } as CSSProperties}
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
              <p className="text-xs text-neutral-400">Add visual context to your notes</p>
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

      {contextMenu ? (
        <EditorContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          hasSelection={contextMenu.hasSelection}
          onCommand={runEditorCommand}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

    </div>
  )
}

const MarkdownEditor = memo(forwardRef(MarkdownEditorInner))
export default MarkdownEditor

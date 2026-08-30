import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { InfoBanner } from '@/components/ui/info-banner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import NoteChatPanel from '@/features/chat/note/NoteChatPanel'
import type { TranscriptSegment } from '@/features/notes/api/transcript-client'
import SavedTranscriptView from '@/features/notes/SavedTranscriptView'

export type NoteSidePanelTab = 'transcript' | 'chat'

type NoteSidePanelProps = {
  activeTab: NoteSidePanelTab
  onActiveTabChange: (tab: NoteSidePanelTab) => void
  onClose: () => void
  transcriptSegments: TranscriptSegment[]
  transcriptLoading: boolean
  noteId: string
  noteTitle: string
}

export default function NoteSidePanel({
  activeTab,
  onActiveTabChange,
  onClose,
  transcriptSegments,
  transcriptLoading,
  noteId,
  noteTitle,
}: NoteSidePanelProps) {
  return (
    <aside
      aria-label="Note details"
      className="ml-2 flex h-full w-[360px] flex-col overflow-hidden rounded-lg border border-neutral-300/70 bg-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.68),0_18px_46px_-34px_rgba(15,23,42,0.5)] backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/80 dark:shadow-none"
    >
      <Tabs
        value={activeTab}
        onValueChange={(value) => onActiveTabChange(value === 'chat' ? 'chat' : 'transcript')}
        className="h-full min-h-0 gap-0"
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-neutral-200 px-2 dark:border-white/10">
          <TabsList className="h-8 w-fit shrink-0 rounded-full border border-neutral-200 bg-neutral-100/80 p-0.5 text-neutral-500 shadow-none dark:border-white/10 dark:bg-white/5 dark:text-neutral-400">
            <TabsTrigger
              value="transcript"
              className="h-full rounded-full px-3 py-0 text-xs shadow-none data-[state=active]:bg-white data-[state=active]:text-neutral-950 dark:data-[state=active]:border-0 dark:data-[state=active]:bg-white/12 dark:data-[state=active]:text-white"
            >
              Transcript
            </TabsTrigger>
            <TabsTrigger
              value="chat"
              className="h-full rounded-full px-3 py-0 text-xs shadow-none data-[state=active]:bg-white data-[state=active]:text-neutral-950 dark:data-[state=active]:border-0 dark:data-[state=active]:bg-white/12 dark:data-[state=active]:text-white"
            >
              Chat
            </TabsTrigger>
          </TabsList>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close note panel"
            title="Close panel"
            className="ml-auto h-7 w-7"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <TabsContent
          value="transcript"
          forceMount
          className="min-h-0 overflow-y-auto p-2.5 data-[state=inactive]:hidden sidebar-scrollbar"
        >
          <InfoBanner className="mb-2">
            The transcript may show repeated sentences without headphones, but your final notes will be unaffected. For the best experience, use headphones.
          </InfoBanner>
          <SavedTranscriptView
            segments={transcriptSegments}
            loading={transcriptLoading}
            theme="light"
          />
        </TabsContent>

        <TabsContent
          value="chat"
          forceMount
          className="min-h-0 data-[state=inactive]:hidden"
        >
          <NoteChatPanel key={noteId} noteId={noteId} noteTitle={noteTitle} />
        </TabsContent>
      </Tabs>
    </aside>
  )
}

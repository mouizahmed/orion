import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Link2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SettingRow, ToggleSwitch } from '@/features/settings/components/SettingsPrimitives'
import { useAuth } from '@/features/auth/AuthContext'
import { attendeeInitials, isCurrentUserAttendee } from '@/features/notes/NoteAttendeesDropdown'
import type { NoteDetail } from '@/features/notes/types'

type ShareNoteDialogProps = {
  note: NoteDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function ShareNoteDialog({ note, open, onOpenChange }: ShareNoteDialogProps) {
  const { user } = useAuth()
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set())
  const [includeTranscript, setIncludeTranscript] = useState(false)
  const [sharingActive, setSharingActive] = useState(false)
  const [stopSharingOpen, setStopSharingOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    setSelectedEmails(new Set())
  }, [open])

  useEffect(() => {
    setIncludeTranscript(false)
    setSharingActive(false)
    setStopSharingOpen(false)
  }, [note.id])

  const selectedCount = selectedEmails.size
  const attendeeEmails = useMemo(() => note.attendees.map((attendee) => attendee.email), [note.attendees])

  const toggleAttendee = (email: string) => {
    setSelectedEmails((current) => {
      const next = new Set(current)
      if (next.has(email)) next.delete(email)
      else next.add(email)
      return next
    })
  }

  const allSelected = attendeeEmails.length > 0 && attendeeEmails.every((email) => selectedEmails.has(email))
  const shareLink = `orion.app/share/${note.id.slice(0, 8)}`
  const toggleAll = () => {
    setSelectedEmails(allSelected ? new Set() : new Set(attendeeEmails))
  }

  const stopSharing = () => {
    setSharingActive(false)
    setStopSharingOpen(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[min(calc(100vw-32px),400px)] gap-0 p-4">
          <DialogHeader className="mb-4">
            <DialogTitle>Share note</DialogTitle>
          </DialogHeader>

        <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 dark:border-white/10">
            <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">Attendees</div>
            <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
              {note.attendees.length === 0 ? '0 people' : `${selectedCount} / ${note.attendees.length} selected`}
            </div>
          </div>

          <div className="px-3 py-3">
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              Choose who should receive the share link.
            </div>
            {note.attendees.length === 0 ? (
              <div className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">No attendees added yet.</div>
            ) : null}
          </div>

          {note.attendees.length > 0 ? (
            <div className="max-h-44 overflow-y-auto border-t border-neutral-200 sidebar-scrollbar dark:border-white/10">
              {note.attendees.map((attendee) => {
                const selected = selectedEmails.has(attendee.email)
                const isYou = isCurrentUserAttendee(attendee.email, user?.email)
                return (
                  <button
                    key={attendee.email}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    onClick={() => toggleAttendee(attendee.email)}
                    className="flex w-full items-center gap-2.5 border-b border-neutral-200 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-neutral-100 dark:border-white/10 dark:hover:bg-white/5"
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${selected ? 'border-violet-400 bg-violet-500 text-white' : 'border-neutral-300 bg-white dark:border-white/20 dark:bg-white/5'}`}>
                      {selected ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                      {attendeeInitials(attendee.name, attendee.email)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">
                        {attendee.name || attendee.email}
                        {isYou ? <span className="font-normal text-neutral-500 dark:text-neutral-400"> (You)</span> : null}
                      </span>
                      {attendee.name ? <span className="block truncate text-[11px] text-neutral-500 dark:text-neutral-400">{attendee.email}</span> : null}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3 border-t border-neutral-200 px-3 py-2 dark:border-white/10">
            {note.attendees.length > 0 ? (
              <button
                type="button"
                onClick={toggleAll}
                className="mr-auto text-[11px] font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              >
                {allSelected ? 'Clear selection' : 'Select all'}
              </button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              disabled={selectedCount === 0}
              onClick={() => setSharingActive(true)}
            >
              Send note
            </Button>
          </div>
        </section>

        <div className="my-4 border-t border-white/10" />

        <section className="space-y-2">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-neutral-100">
              {sharingActive ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> : null}
              {sharingActive ? 'Link sharing is active' : 'Public link'}
            </div>
            <div className="mt-0.5 text-[11px] text-neutral-400">
              {sharingActive ? 'Send or copy this link to share the note.' : 'Anyone with the link can read the note.'}
            </div>
          </div>

          {sharingActive ? (
            <div className="flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.025] px-2.5">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
              <span className="min-w-0 flex-1 truncate text-xs text-neutral-300">{shareLink}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Copy share link"
                title="Copy link"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
            <SettingRow
              label="Include transcript"
              value="Let anyone with the link read the full conversation."
              action={<ToggleSwitch
                enabled={includeTranscript}
                onClick={() => setIncludeTranscript((current) => !current)}
                ariaLabel="Include transcript"
              />}
            />
          </div>
        </section>

          <DialogFooter className="mt-4 flex-row justify-end gap-2 space-x-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {sharingActive ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setStopSharingOpen(true)}
                className="border-red-500/30 text-red-300 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-200"
              >
                Stop sharing
              </Button>
            ) : (
              <Button type="button" variant="brand" onClick={() => setSharingActive(true)}>
                Create link
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stopSharingOpen} onOpenChange={setStopSharingOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop sharing this note?</DialogTitle>
            <p className="text-xs leading-5 text-neutral-400">
              The current link will stop working for everyone. You can create a new link later.
            </p>
          </DialogHeader>
          <DialogFooter className="mt-2 flex-row justify-end gap-2 space-x-0">
            <Button type="button" variant="outline" onClick={() => setStopSharingOpen(false)}>
              Keep sharing
            </Button>
            <Button type="button" variant="destructive" onClick={stopSharing}>
              Stop sharing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

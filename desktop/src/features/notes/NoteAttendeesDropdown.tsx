import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { toast } from 'sonner'
import { Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownLabel,
  DropdownPopover,
  DropdownSeparator,
  dropdownItemClassName,
} from '@/components/ui/dropdown-list'
import { useAuth } from '@/features/auth/AuthContext'
import type { NoteDetail } from '@/features/notes/types'
import { useAddNoteAttendeeMutation, useRemoveNoteAttendeeMutation } from '@/features/notes/queries/useNoteMutations'

type Props = {
  note: NoteDetail
}

export function attendeeInitials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length > 0) {
    const selected = words.length === 1 ? words : [words[0], words[words.length - 1]]
    return selected.map((word) => word[0]).join('').toUpperCase()
  }
  return email.trim()[0]?.toUpperCase() ?? '?'
}

export function isCurrentUserAttendee(attendeeEmail: string, userEmail?: string): boolean {
  if (!userEmail) return false
  return attendeeEmail.trim().toLowerCase() === userEmail.trim().toLowerCase()
}

function Avatar({ name, email, size = 'sm' }: { name: string; email: string; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-7 w-7 text-[11px]'
  return (
    <span
      className={`${dim} inline-flex shrink-0 items-center justify-center rounded-full bg-violet-100 font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300`}
      title={name || email}
    >
      {attendeeInitials(name, email)}
    </span>
  )
}

export default function NoteAttendeesDropdown({ note }: Props) {
  const { user } = useAuth()
  const { mutateAsync: addAttendee } = useAddNoteAttendeeMutation(user?.id ?? '')
  const { mutateAsync: removeAttendee } = useRemoveNoteAttendeeMutation(user?.id ?? '')
  const [open, setOpen] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [emailInput, setEmailInput] = useState('')
  const [adding, setAdding] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)

  const attendees = note.attendees

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Focus the first field when the dropdown opens.
  useEffect(() => {
    if (open) {
      setTimeout(() => nameInputRef.current?.focus(), 0)
    } else {
      setNameInput('')
      setEmailInput('')
    }
  }, [open])

  const handleAdd = async () => {
    const email = emailInput.trim().toLowerCase()
    const name = nameInput.trim()
    if (!email || adding) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error('Please enter a valid email address'); return }
    if (attendees.some((attendee) => isCurrentUserAttendee(attendee.email, email))) {
      toast.error('That email is already an attendee')
      return
    }
    setAdding(true)
    try {
      await addAttendee({ noteID: note.id, email, name: name || undefined })
      setNameInput('')
      setEmailInput('')
      nameInputRef.current?.focus()
    } catch (error) {
      toast.error(error instanceof Error && error.message === 'attendee already exists'
        ? 'That email is already an attendee'
        : 'Could not add attendee')
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (email: string) => {
    try {
      await removeAttendee({ noteID: note.id, email })
    } catch {
      toast.error('Could not remove attendee')
    }
  }

  // Stacked avatars — show up to 3, then +N badge
  const visibleAvatars = attendees.slice(0, 3)
  const overflow = attendees.length - 3

  return (
    <div ref={containerRef} className="relative" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen((v) => !v)}
        className="h-8 gap-1.5 px-2"
        title="Attendees"
      >
        {attendees.length === 0 ? (
          <Users className="h-3.5 w-3.5" />
        ) : (
          <span className="flex items-center">
            {visibleAvatars.map((a, i) => (
              <span key={a.email} className={i > 0 ? '-ml-1.5' : ''}>
                <Avatar name={a.name} email={a.email} />
              </span>
            ))}
            {overflow > 0 && (
              <span className="-ml-1.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white bg-neutral-100 text-[10px] font-medium text-neutral-600 dark:border-neutral-800 dark:bg-neutral-700 dark:text-neutral-300">
                +{overflow}
              </span>
            )}
          </span>
        )}
      </Button>

      {open && (
        <DropdownPopover width="lg" align="end">
          <DropdownLabel className="space-y-1.5">
            <input
              ref={nameInputRef}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false)
              }}
              placeholder="Name (optional)"
              className="w-full bg-transparent outline-none placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
              maxLength={120}
              disabled={adding}
            />
            <div className="border-t border-neutral-200/40 dark:border-white/5" aria-hidden="true" />
            <input
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void handleAdd() }
                if (e.key === 'Escape') setOpen(false)
              }}
              placeholder="Email address"
              className="w-full bg-transparent outline-none placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
              disabled={adding}
            />
          </DropdownLabel>
          <DropdownSeparator />
          {attendees.length === 0 ? (
            <div className="px-3 py-2 text-xs text-neutral-400 dark:text-neutral-500">No attendees yet</div>
          ) : (
            <div className="max-h-56 overflow-y-auto">
              {attendees.map((a) => {
                const isYou = isCurrentUserAttendee(a.email, user?.email)
                const removeLabel = isYou ? 'Remove yourself from attendees' : 'Remove attendee'
                return (
                  <div key={a.email} className={dropdownItemClassName({ layout: 'multiline', className: 'group cursor-default' })}>
                    <Avatar name={a.name} email={a.email} size="md" />
                    <span className="min-w-0 flex-1 text-left">
                      {a.name ? (
                        <>
                          <span className="block truncate leading-4">
                            {a.name}{isYou ? <span className="text-neutral-400 dark:text-neutral-500"> (You)</span> : null}
                          </span>
                          <span className="block truncate text-[11px] text-neutral-400 dark:text-neutral-500">{a.email}</span>
                        </>
                      ) : (
                        <span className="block truncate leading-4">
                          {a.email}{isYou ? <span className="text-neutral-400 dark:text-neutral-500"> (You)</span> : null}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void handleRemove(a.email) }}
                      className="ml-auto shrink-0 rounded-full p-0.5 text-neutral-400 opacity-0 transition-opacity hover:text-neutral-700 group-hover:opacity-100 dark:text-neutral-500 dark:hover:text-neutral-200"
                      title={removeLabel}
                      aria-label={removeLabel}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </DropdownPopover>
      )}
    </div>
  )
}

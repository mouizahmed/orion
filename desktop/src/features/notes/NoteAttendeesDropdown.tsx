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

function initials(name: string, email: string): string {
  const src = name.trim() || email
  return src[0]?.toUpperCase() ?? '?'
}

function Avatar({ name, email, avatarUrl, size = 'sm' }: { name: string; email: string; avatarUrl?: string; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-7 w-7 text-[11px]'
  const [imgError, setImgError] = useState(false)

  const fallback = (
    <span
      className={`${dim} inline-flex shrink-0 items-center justify-center rounded-full bg-violet-100 font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300`}
      title={name || email}
    >
      {initials(name, email)}
    </span>
  )

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={name || email}
        title={name || email}
        className={`${dim} shrink-0 rounded-full object-cover`}
        onError={() => setImgError(true)}
      />
    )
  }
  return fallback
}

export default function NoteAttendeesDropdown({ note }: Props) {
  const { user } = useAuth()
  const currentUserEmail = user?.email ?? ''
  const { mutateAsync: addAttendee } = useAddNoteAttendeeMutation(user?.id ?? '')
  const { mutateAsync: removeAttendee } = useRemoveNoteAttendeeMutation(user?.id ?? '')
  const [open, setOpen] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [adding, setAdding] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

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

  // Focus input when dropdown opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setEmailInput('')
    }
  }, [open])

  const handleAdd = async () => {
    const email = emailInput.trim().toLowerCase()
    if (!email || adding) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error('Please enter a valid email address'); return }
    const alreadyIn = attendees.some((a) => a.email.toLowerCase() === email)
    if (alreadyIn) { setEmailInput(''); return }
    setAdding(true)
    await addAttendee({ noteID: note.id, email })
    setAdding(false)
    setEmailInput('')
  }

  const handleRemove = async (email: string) => {
    await removeAttendee({ noteID: note.id, email })
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
                <Avatar name={a.name} email={a.email} avatarUrl={a.avatarUrl} />
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
          <DropdownLabel>
            <input
              ref={inputRef}
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void handleAdd() }
                if (e.key === 'Escape') setOpen(false)
              }}
              placeholder="Add by email…"
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
                const isCreator = a.email.toLowerCase() === currentUserEmail.toLowerCase()
                return (
                  <div key={a.email} className={dropdownItemClassName({ layout: 'multiline', className: 'group cursor-default' })}>
                    <Avatar name={a.name} email={a.email} avatarUrl={a.avatarUrl} size="md" />
                    <span className="min-w-0 flex-1 text-left">
                      {a.name ? (
                        <>
                          <span className="block truncate leading-4">{a.name}</span>
                          <span className="block truncate text-[11px] text-neutral-400 dark:text-neutral-500">{a.email}</span>
                        </>
                      ) : (
                        <span className="block truncate leading-4">{a.email}</span>
                      )}
                    </span>
                    {!isCreator && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void handleRemove(a.email) }}
                        className="ml-auto shrink-0 rounded-full p-0.5 text-neutral-400 opacity-0 transition-opacity hover:text-neutral-700 group-hover:opacity-100 dark:text-neutral-500 dark:hover:text-neutral-200"
                        title="Remove attendee"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
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

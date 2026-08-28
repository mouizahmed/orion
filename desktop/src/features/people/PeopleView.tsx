import { FormEvent, useRef, useState } from 'react'
import { Plus, Trash2, UserRound, UsersRound, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DashboardPanel,
  DashboardPanelBody,
  DashboardPanelHeader,
  DashboardPanelTitle,
} from '@/components/ui/dashboard-panel'
import { useAuth } from '@/features/auth/AuthContext'
import type { Person } from '@/features/people/types'
import { usePeople } from '@/features/people/usePeople'

function initials(name: string, email: string) {
  const words = (name.trim() || email.trim()).split(/\s+/).filter(Boolean)
  return (words.length > 1 ? `${words[0][0]}${words[words.length - 1]?.[0]}` : words[0]?.[0] ?? '?').toUpperCase()
}

export function hasPersonEmail(people: Pick<Person, 'email'>[], email: string): boolean {
  const normalizedEmail = email.trim().toLowerCase()
  return people.some((person) => person.email.trim().toLowerCase() === normalizedEmail)
}

export default function PeopleView() {
  const { user } = useAuth()
  const { query, createMutation, deleteMutation } = usePeople(user?.id ?? '')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const people = query.data ?? []

  const openForm = () => {
    setAdding(true)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  const closeForm = () => {
    setAdding(false)
    setName('')
    setEmail('')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const normalizedName = name.trim()
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || createMutation.isPending) return
    if (hasPersonEmail(people, normalizedEmail)) {
      toast.error('That email is already in People')
      return
    }
    try {
      await createMutation.mutateAsync({ name: normalizedName, email: normalizedEmail })
      closeForm()
    } catch (error) {
      toast.error(error instanceof Error && error.message === 'person already exists'
        ? 'That email is already in People'
        : error instanceof Error ? error.message : 'Could not add person')
    }
  }

  return (
    <DashboardPanel className="flex h-full min-h-0 flex-col">
      <DashboardPanelHeader className="border-b border-neutral-200 dark:border-white/10">
        <div className="min-w-0">
          <DashboardPanelTitle>People</DashboardPanelTitle>
        </div>
        {adding ? (
          <form onSubmit={(event) => void submit(event)} className="flex items-center gap-1.5">
            <div className="flex items-center rounded-full border border-neutral-200 bg-white/80 px-3 dark:border-white/12 dark:bg-white/5">
              <input
                ref={inputRef}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') closeForm() }}
                className="h-8 w-36 bg-transparent text-xs text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
                placeholder="Name (optional)"
                maxLength={120}
                disabled={createMutation.isPending}
              />
              <div className="mx-2 h-4 border-l border-neutral-200 dark:border-white/10" aria-hidden="true" />
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') closeForm() }}
                className="h-8 w-44 bg-transparent text-xs text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
                placeholder="Email"
                type="email"
                required
                maxLength={320}
                disabled={createMutation.isPending}
              />
            </div>
            <Button type="submit" variant="brand" size="sm" disabled={!email.trim() || createMutation.isPending}>
              Add
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" onClick={closeForm} aria-label="Cancel adding person">
              <X />
            </Button>
          </form>
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={openForm}>
            <Plus />
            Add person
          </Button>
        )}
      </DashboardPanelHeader>

      <DashboardPanelBody className="min-h-0 flex-1">
        {query.isLoading ? (
          <div className="space-y-1">
            {[0, 1, 2].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
                <div className="h-9 w-9 animate-pulse rounded-full bg-neutral-200 dark:bg-white/10" />
                <div className="h-3 w-40 animate-pulse rounded bg-neutral-200 dark:bg-white/10" />
              </div>
            ))}
          </div>
        ) : query.isError ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
            <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Could not load people</p>
            <Button className="mt-3" type="button" variant="secondary" size="sm" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        ) : people.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-100 text-neutral-500 dark:border-white/10 dark:bg-white/5 dark:text-neutral-400">
              <UsersRound className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">No people yet</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-neutral-500 dark:text-neutral-400">
              Add someone by email, with an optional name. Meeting attendees can be collected here later.
            </p>
            <Button className="mt-4" type="button" variant="secondary" size="sm" onClick={openForm}>
              <Plus />
              Add your first person
            </Button>
          </div>
        ) : (
          <div className="space-y-0.5">
            {people.map((person) => (
              <div key={person.id} className="group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-neutral-100/80 dark:hover:bg-white/5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                  {initials(person.name, person.email)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">{person.name || person.email}</p>
                  <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                    <UserRound className="h-3 w-3 shrink-0" />
                    {person.name ? person.email : 'Added manually'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Remove ${person.name || person.email}`}
                  title="Remove person"
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    void deleteMutation.mutateAsync(person.id).catch((error: unknown) => {
                      toast.error(error instanceof Error ? error.message : 'Could not remove person')
                    })
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}
      </DashboardPanelBody>
    </DashboardPanel>
  )
}

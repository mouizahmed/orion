import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { useUpdateVocabularyMutation, useVocabularyQuery } from '@/features/settings/sections/vocabulary/useVocabularyQuery'

const MAX_TERMS = 100
const MAX_TERM_LENGTH = 50
const EMPTY_TERMS: string[] = []

function termsEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((term, index) => term === right[index])
}

function mergeTerms(current: string[], candidates: string[]) {
  const terms = [...current]
  const seen = new Set(current.map((term) => term.toLowerCase()))
  for (const candidate of candidates) {
    const term = candidate.trim()
    if (!term) continue
    if ([...term].length > MAX_TERM_LENGTH) return { terms: current, error: 'Each vocabulary term must be 50 characters or fewer.' }
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    if (terms.length >= MAX_TERMS) return { terms: current, error: 'Vocabulary can contain at most 100 terms.' }
    seen.add(key)
    terms.push(term)
  }
  return { terms, error: null }
}

export function VocabularySettings({ userID }: { userID?: string }) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const wasSavingRef = useRef(false)
  const [input, setInput] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const query = useVocabularyQuery(userID)
  const mutation = useUpdateVocabularyMutation(userID)
  const terms = query.data?.terms ?? EMPTY_TERMS
  const isSaving = mutation.isPending
  const displayedError = localError ?? (query.error instanceof Error ? query.error.message : null)

  useEffect(() => {
    const saveFinished = wasSavingRef.current && !isSaving
    wasSavingRef.current = isSaving
    if (saveFinished && !query.isPending && terms.length < MAX_TERMS) inputRef.current?.focus()
  }, [isSaving, query.isPending, terms.length])

  const persistTerms = useCallback(async (nextTerms: string[]) => {
    setLocalError(null)
    try {
      await mutation.mutateAsync(nextTerms)
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Failed to update vocabulary')
    }
  }, [mutation])

  const addTerms = useCallback((candidates: string[]) => {
    const merged = mergeTerms(terms, candidates)
    if (merged.error) {
      setLocalError(merged.error)
      return false
    }
    setLocalError(null)
    if (!termsEqual(merged.terms, terms)) void persistTerms(merged.terms)
    return true
  }, [persistTerms, terms])

  const commitInput = useCallback(() => {
    if (!input.trim()) return
    if (addTerms([input])) setInput('')
  }, [addTerms, input])

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 dark:border-white/10">
        <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">Recognition terms</div>
        <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{terms.length} / 100 terms</span>
      </div>
      {query.isPending ? (
        <div className="px-3 py-5 text-xs text-neutral-500 dark:text-neutral-400">Loading vocabulary...</div>
      ) : (
        <div className="px-3 py-3">
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            Add names, brands, products, acronyms, or specialized terminology. Changes apply to new recordings.
          </div>
          <Input
            ref={inputRef}
            value={input}
            placeholder="Type a term, then press Enter"
            className="mt-3 h-9 text-xs"
            disabled={isSaving || terms.length >= MAX_TERMS}
            onChange={(event) => {
              const value = event.target.value
              if ([...value].length > MAX_TERM_LENGTH) {
                setLocalError('Each vocabulary term must be 50 characters or fewer.')
                return
              }
              setInput(value)
              setLocalError(null)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              commitInput()
            }}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData('text')
              if (!pasted.includes('\n')) return
              event.preventDefault()
              if (addTerms(pasted.split(/\r?\n/))) setInput('')
            }}
          />
          <div className="mt-3 flex min-h-7 flex-wrap gap-1.5">
            {terms.map((term) => (
              <span key={term.toLowerCase()} className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-neutral-200 bg-neutral-100 px-2.5 text-xs text-neutral-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-neutral-200">
                <span className="truncate">{term}</span>
                <button
                  type="button"
                  aria-label={`Remove ${term}`}
                  className="rounded-full text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200"
                  disabled={isSaving}
                  onClick={() => void persistTerms(terms.filter((candidate) => candidate !== term))}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            {terms.length === 0 ? <div className="flex h-7 items-center text-xs text-neutral-400 dark:text-neutral-500">No terms added yet.</div> : null}
          </div>
          {displayedError ? (
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-red-600 dark:text-red-400" aria-live="polite">
              <span>{displayedError}</span>
              {query.isError ? <button type="button" className="shrink-0 font-medium underline-offset-2 hover:underline" onClick={() => void query.refetch()}>Retry</button> : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

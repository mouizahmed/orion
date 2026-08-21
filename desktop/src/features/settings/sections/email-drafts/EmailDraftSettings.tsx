import { useEffect, useRef, useState } from 'react'

import { createDebouncedPromptSave, type DebouncedPromptSave } from '@/features/settings/sections/email-drafts/email-draft-autosave'
import type { EmailDraftSettingsPatch } from '@/features/settings/sections/email-drafts/email-draft-settings-client'
import {
  useEmailDraftSettingsQuery,
  useUpdateEmailDraftSettingsMutation,
} from '@/features/settings/sections/email-drafts/useEmailDraftSettingsQuery'
import { SettingRow, ToggleSwitch } from '@/features/settings/components/SettingsPrimitives'

const MAX_DRAFT_PROMPT_LENGTH = 1000

function characterCount(value: string) {
  return [...value].length
}

export function EmailDraftSettings({ userID }: { userID?: string }) {
  const query = useEmailDraftSettingsQuery(userID)
  const mutation = useUpdateEmailDraftSettingsMutation(userID)
  const [draftPrompt, setDraftPrompt] = useState(() => query.data?.draftPrompt ?? '')
  const [isPromptDirty, setIsPromptDirty] = useState(false)
  const [isPromptFocused, setIsPromptFocused] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [failedPatch, setFailedPatch] = useState<EmailDraftSettingsPatch | null>(null)
  const draftPromptRef = useRef(draftPrompt)
  const promptVersionRef = useRef(0)
  const savePromptCallbackRef = useRef<(value: string) => void>(() => undefined)
  const promptSaverRef = useRef<DebouncedPromptSave | null>(null)

  if (promptSaverRef.current === null) {
    promptSaverRef.current = createDebouncedPromptSave((value) => savePromptCallbackRef.current(value))
  }

  const settings = query.data
  const displayedError = saveError ?? (query.error instanceof Error ? query.error.message : null)

  savePromptCallbackRef.current = (value) => {
    const savedVersion = promptVersionRef.current
    const patch = { draftPrompt: value }
    void mutation.mutateAsync(patch).then(() => {
      if (promptVersionRef.current !== savedVersion || draftPromptRef.current !== value) return
      setIsPromptDirty(false)
      setFailedPatch(null)
      setSaveError(null)
    }).catch((error: unknown) => {
      if (promptVersionRef.current !== savedVersion || draftPromptRef.current !== value) return
      setFailedPatch(patch)
      setSaveError(error instanceof Error ? error.message : 'Failed to update email draft settings')
    })
  }

  useEffect(() => {
    if (!settings || isPromptDirty || isPromptFocused) return
    draftPromptRef.current = settings.draftPrompt
    setDraftPrompt(settings.draftPrompt)
  }, [isPromptDirty, isPromptFocused, settings])

  useEffect(() => () => promptSaverRef.current?.cancel(), [])

  const updateToggle = (patch: EmailDraftSettingsPatch) => {
    setSaveError(null)
    setFailedPatch(null)
    mutation.mutate(patch, {
      onError: (error) => {
        setFailedPatch(patch)
        setSaveError(error instanceof Error ? error.message : 'Failed to update email draft settings')
      },
      onSuccess: () => {
        setFailedPatch(null)
        setSaveError(null)
      },
    })
  }

  const retryFailedSave = () => {
    if (!failedPatch) return
    setSaveError(null)
    if (failedPatch.draftPrompt !== undefined) {
      savePromptCallbackRef.current(draftPromptRef.current)
      return
    }
    updateToggle(failedPatch)
  }

  if (!settings && query.isPending) {
    return (
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 px-3 py-5 text-xs text-neutral-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-400">
        Loading email draft settings...
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 px-3 py-5 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex items-center justify-between gap-3 text-xs text-red-600 dark:text-red-400">
          <span>{displayedError ?? 'Email draft settings are unavailable'}</span>
          <button type="button" className="shrink-0 font-medium underline-offset-2 hover:underline" onClick={() => void query.refetch()}>Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
        <SettingRow
          label="Enable email draft"
          value="Automatically draft follow-up emails after meetings."
          action={(
            <ToggleSwitch
              enabled={settings.enabled}
              ariaLabel="Enable email draft"
              onClick={() => updateToggle({ enabled: !settings.enabled })}
            />
          )}
        />
        <SettingRow
          label="Include sharing link in the email body"
          value="e.g. You can review the full meeting notes here: https://orion.so/m/..."
          action={(
            <ToggleSwitch
              enabled={settings.includeSharingLink}
              ariaLabel="Include sharing link in the email body"
              onClick={() => updateToggle({ includeSharingLink: !settings.includeSharingLink })}
            />
          )}
        />
      </div>
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 dark:border-white/10">
          <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">Draft prompt</div>
          <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
            {characterCount(draftPrompt)} / {MAX_DRAFT_PROMPT_LENGTH} characters
          </span>
        </div>
        <div className="px-3 py-3">
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            Provide custom instructions to the AI that generates your draft email replies, such as your priorities, decision-making style, or business context.
          </div>
          <textarea
            id="email-draft-prompt"
            aria-label="Draft prompt"
            aria-invalid={Boolean(saveError)}
            value={draftPrompt}
            spellCheck
            className="sidebar-scrollbar mt-3 min-h-80 w-full resize-none rounded-xl border border-neutral-200 bg-white/70 px-3 py-3 text-xs leading-5 text-neutral-900 outline-none transition-[border-color,box-shadow,background-color] placeholder:text-neutral-500 focus-visible:border-neutral-300 focus-visible:ring-2 focus-visible:ring-neutral-900/10 aria-invalid:border-red-400 aria-invalid:ring-2 aria-invalid:ring-red-500/10 dark:border-white/12 dark:bg-white/5 dark:text-neutral-100 dark:focus-visible:border-white/20 dark:focus-visible:ring-white/10"
            onFocus={() => setIsPromptFocused(true)}
            onBlur={() => {
              setIsPromptFocused(false)
              promptSaverRef.current?.flush()
            }}
            onChange={(event) => {
              const value = event.target.value
              if (characterCount(value) > MAX_DRAFT_PROMPT_LENGTH) {
                setSaveError('Draft prompt must be 1,000 characters or fewer')
                return
              }
              promptVersionRef.current += 1
              draftPromptRef.current = value
              setDraftPrompt(value)
              setIsPromptDirty(true)
              setFailedPatch(null)
              setSaveError(null)
              promptSaverRef.current?.schedule(value)
            }}
          />
          {displayedError ? (
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-red-600 dark:text-red-400" aria-live="polite">
              <span>{displayedError}</span>
              {failedPatch || query.isError ? (
                <button
                  type="button"
                  className="shrink-0 font-medium underline-offset-2 hover:underline"
                  onClick={failedPatch ? retryFailedSave : () => void query.refetch()}
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

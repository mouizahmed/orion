import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getEmailDraftSettings,
  patchEmailDraftSettings,
  type EmailDraftSettings,
  type EmailDraftSettingsPatch,
} from '@/features/settings/sections/email-drafts/email-draft-settings-client'
import { isActiveServerStateAccount } from '@/lib/query-client'
import { queryKeys } from '@/lib/query-keys'

const EMAIL_DRAFT_SETTINGS_STALE_TIME_MS = 5 * 60_000

function mergePatch(current: EmailDraftSettings, patch: EmailDraftSettingsPatch): EmailDraftSettings {
  return { ...current, ...patch }
}

function rollbackPatch(
  current: EmailDraftSettings,
  previous: EmailDraftSettings,
  failedPatch: EmailDraftSettingsPatch,
): EmailDraftSettings {
  const next = { ...current }
  if (failedPatch.enabled !== undefined && current.enabled === failedPatch.enabled) next.enabled = previous.enabled
  if (failedPatch.includeSharingLink !== undefined && current.includeSharingLink === failedPatch.includeSharingLink) {
    next.includeSharingLink = previous.includeSharingLink
  }
  if (failedPatch.draftPrompt !== undefined && current.draftPrompt === failedPatch.draftPrompt) next.draftPrompt = previous.draftPrompt
  return next
}

function mergeCanonicalResponse(
  current: EmailDraftSettings,
  canonical: EmailDraftSettings,
  patch: EmailDraftSettingsPatch,
): EmailDraftSettings {
  const next = {
    ...current,
    createdAt: canonical.createdAt,
    updatedAt: canonical.updatedAt,
  }
  if (patch.enabled !== undefined && current.enabled === patch.enabled) next.enabled = canonical.enabled
  if (patch.includeSharingLink !== undefined && current.includeSharingLink === patch.includeSharingLink) {
    next.includeSharingLink = canonical.includeSharingLink
  }
  if (patch.draftPrompt !== undefined && current.draftPrompt === patch.draftPrompt) next.draftPrompt = canonical.draftPrompt
  return next
}

export function useEmailDraftSettingsQuery(accountID: string | undefined) {
  return useQuery({
    queryKey: queryKeys.emailDraftSettings(accountID ?? 'anonymous'),
    queryFn: ({ signal }) => getEmailDraftSettings(signal),
    enabled: Boolean(accountID),
    staleTime: EMAIL_DRAFT_SETTINGS_STALE_TIME_MS,
  })
}

export function useUpdateEmailDraftSettingsMutation(accountID: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: patchEmailDraftSettings,
    scope: { id: `email-draft-settings:${accountID ?? 'anonymous'}` },
    onMutate: async (patch) => {
      if (!accountID) throw new Error('Email draft settings are unavailable')
      const queryKey = queryKeys.emailDraftSettings(accountID)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<EmailDraftSettings>(queryKey)
      if (previous) queryClient.setQueryData(queryKey, mergePatch(previous, patch))
      return { previous, queryKey }
    },
    onError: (_error, patch, context) => {
      if (!accountID || !isActiveServerStateAccount(accountID) || !context?.previous) return
      const previous = context.previous
      queryClient.setQueryData<EmailDraftSettings>(context.queryKey, (current) => (
        current ? rollbackPatch(current, previous, patch) : previous
      ))
    },
    onSuccess: (canonical, patch) => {
      if (!accountID || !isActiveServerStateAccount(accountID)) return
      queryClient.setQueryData<EmailDraftSettings>(queryKeys.emailDraftSettings(accountID), (current) => (
        current ? mergeCanonicalResponse(current, canonical, patch) : canonical
      ))
    },
  })
}

export const emailDraftSettingsCacheTransforms = {
  mergePatch,
  rollbackPatch,
  mergeCanonicalResponse,
}

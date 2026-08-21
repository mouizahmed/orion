import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createSummaryTemplate,
  deleteSummaryTemplate,
  listSummaryTemplates,
  SummaryTemplateApiError,
  updateSummaryTemplate,
} from '@/features/settings/sections/summary-templates/summary-templates-client'
import type { SummaryTemplate, SummaryTemplateInput } from '@/features/settings/sections/summary-templates/types'
import { isActiveServerStateAccount } from '@/lib/query-client'
import { queryKeys } from '@/lib/query-keys'

const SUMMARY_TEMPLATES_STALE_TIME_MS = 5 * 60_000

export function useSummaryTemplatesQuery(accountID: string | undefined) {
  return useQuery({
    queryKey: queryKeys.summaryTemplates(accountID ?? 'anonymous'),
    queryFn: ({ signal }) => listSummaryTemplates(signal),
    enabled: Boolean(accountID),
    staleTime: SUMMARY_TEMPLATES_STALE_TIME_MS,
  })
}

function useConflictRefresh(accountID: string | undefined) {
  const queryClient = useQueryClient()
  return (error: Error) => {
    if (!(error instanceof SummaryTemplateApiError) || error.code !== 'summary_template_folder_conflict') return
    if (!accountID || !isActiveServerStateAccount(accountID)) return
    void queryClient.invalidateQueries({ queryKey: queryKeys.summaryTemplates(accountID) })
  }
}

export function useCreateSummaryTemplateMutation(accountID: string | undefined) {
  const queryClient = useQueryClient()
  const refreshConflict = useConflictRefresh(accountID)
  return useMutation({
    mutationFn: createSummaryTemplate,
    onSuccess: (template) => {
      if (!accountID || !isActiveServerStateAccount(accountID)) return
      queryClient.setQueryData<SummaryTemplate[]>(queryKeys.summaryTemplates(accountID), (current = []) => [...current, template])
    },
    onError: refreshConflict,
  })
}

export function useUpdateSummaryTemplateMutation(accountID: string | undefined) {
  const queryClient = useQueryClient()
  const refreshConflict = useConflictRefresh(accountID)
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SummaryTemplateInput }) => updateSummaryTemplate(id, input),
    onSuccess: (template) => {
      if (!accountID || !isActiveServerStateAccount(accountID)) return
      queryClient.setQueryData<SummaryTemplate[]>(queryKeys.summaryTemplates(accountID), (current = []) => (
        current.map((candidate) => candidate.id === template.id ? template : candidate)
      ))
    },
    onError: refreshConflict,
  })
}

export function useDeleteSummaryTemplateMutation(accountID: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteSummaryTemplate,
    onSuccess: (_result, templateID) => {
      if (!accountID || !isActiveServerStateAccount(accountID)) return
      queryClient.setQueryData<SummaryTemplate[]>(queryKeys.summaryTemplates(accountID), (current = []) => (
        current.filter((template) => template.id !== templateID)
      ))
    },
  })
}

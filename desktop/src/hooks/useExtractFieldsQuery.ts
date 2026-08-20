import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createExtractField,
  deleteExtractField,
  listExtractFields,
  updateExtractField,
} from '@/lib/extract-fields-client'
import { isActiveServerStateAccount } from '@/lib/query-client'
import { queryKeys } from '@/lib/query-keys'
import type { ExtractField, ExtractFieldInput } from '@/types/extract-field'

const EXTRACT_FIELDS_STALE_TIME_MS = 5 * 60_000

export function useExtractFieldsQuery(accountID: string | undefined) {
  return useQuery({
    queryKey: queryKeys.extractFields(accountID ?? 'anonymous'),
    queryFn: ({ signal }) => listExtractFields(signal),
    enabled: Boolean(accountID),
    staleTime: EXTRACT_FIELDS_STALE_TIME_MS,
  })
}

export function useCreateExtractFieldMutation(accountID: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createExtractField,
    onSuccess: (field) => {
      if (!accountID || !isActiveServerStateAccount(accountID)) return
      queryClient.setQueryData<ExtractField[]>(queryKeys.extractFields(accountID), (current = []) => [...current, field])
    },
  })
}

export function useUpdateExtractFieldMutation(accountID: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ExtractFieldInput }) => updateExtractField(id, input),
    onSuccess: (field) => {
      if (!accountID || !isActiveServerStateAccount(accountID)) return
      queryClient.setQueryData<ExtractField[]>(queryKeys.extractFields(accountID), (current = []) => (
        current.map((candidate) => candidate.id === field.id ? field : candidate)
      ))
    },
  })
}

export function useDeleteExtractFieldMutation(accountID: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteExtractField,
    onSuccess: (_result, fieldID) => {
      if (!accountID || !isActiveServerStateAccount(accountID)) return
      queryClient.setQueryData<ExtractField[]>(queryKeys.extractFields(accountID), (current = []) => (
        current.filter((field) => field.id !== fieldID)
      ))
    },
  })
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getVocabulary,
  putVocabulary,
  type AccountVocabulary,
} from '@/features/settings/sections/vocabulary/vocabulary-client'
import { queryKeys } from '@/lib/query-keys'
import { isActiveServerStateAccount } from '@/lib/query-client'

const VOCABULARY_STALE_TIME_MS = 5 * 60_000

export function useVocabularyQuery(accountID: string | undefined) {
  return useQuery({
    queryKey: queryKeys.vocabulary(accountID ?? 'anonymous'),
    queryFn: ({ signal }) => getVocabulary(signal),
    enabled: Boolean(accountID),
    staleTime: VOCABULARY_STALE_TIME_MS,
  })
}

export function useUpdateVocabularyMutation(accountID: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: putVocabulary,
    onMutate: async (terms) => {
      if (!accountID) throw new Error('Vocabulary is unavailable')
      const queryKey = queryKeys.vocabulary(accountID)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<AccountVocabulary>(queryKey)
      queryClient.setQueryData<AccountVocabulary>(queryKey, {
        ...previous,
        terms,
      })
      return { previous, queryKey }
    },
    onError: (_error, _terms, context) => {
      if (accountID && isActiveServerStateAccount(accountID) && context?.previous) {
        queryClient.setQueryData(context.queryKey, context.previous)
      }
    },
    onSuccess: (vocabulary) => {
      if (!accountID || !isActiveServerStateAccount(accountID)) return
      queryClient.setQueryData(queryKeys.vocabulary(accountID), vocabulary)
    },
  })
}

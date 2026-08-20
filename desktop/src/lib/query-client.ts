import { QueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'

export const dashboardQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 30 * 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
})

let activeServerStateAccountID: string | null = null

export function setActiveServerStateAccount(accountID: string | null) {
  activeServerStateAccountID = accountID
}

export function isActiveServerStateAccount(accountID: string) {
  return activeServerStateAccountID === accountID
}

export async function clearAccountServerState(queryClient: QueryClient, accountID: string) {
  const queryKey = queryKeys.account(accountID)
  await queryClient.cancelQueries({ queryKey })
  queryClient.removeQueries({ queryKey })
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { createPerson, deletePerson, listPeople } from '@/features/people/people-client'
import type { Person } from '@/features/people/types'
import { queryKeys } from '@/lib/query-keys'

export function usePeople(accountID: string) {
  const queryClient = useQueryClient()
  const key = queryKeys.people(accountID)
  const query = useQuery({
    queryKey: key,
    queryFn: listPeople,
    enabled: Boolean(accountID),
  })
  const createMutation = useMutation({
    mutationFn: createPerson,
    onSuccess: (person) => {
      queryClient.setQueryData<Person[]>(key, (current = []) => (
        [
          ...current.filter((item) => item.id !== person.id && item.email.toLowerCase() !== person.email.toLowerCase()),
          person,
        ].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, undefined, { sensitivity: 'base' }))
      ))
    },
  })
  const deleteMutation = useMutation({
    mutationFn: deletePerson,
    onSuccess: (_result, personID) => {
      queryClient.setQueryData<Person[]>(key, (current = []) => current.filter((person) => person.id !== personID))
    },
  })

  return { query, createMutation, deleteMutation }
}

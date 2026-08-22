import { describe, expect, it } from 'vitest'

import { reconcileCanonicalDraft } from '@/features/notes/draft-reconciliation'

describe('reconcileCanonicalDraft', () => {
  it('adopts canonical changes when the draft is clean', () => {
    expect(reconcileCanonicalDraft('old', 'old', 'new')).toBe('new')
  })

  it('preserves a dirty draft when canonical data changes', () => {
    expect(reconcileCanonicalDraft('old', 'local edit', 'remote edit')).toBeNull()
  })

  it('does nothing when canonical data has not changed', () => {
    expect(reconcileCanonicalDraft('same', 'same', 'same')).toBeNull()
  })
})

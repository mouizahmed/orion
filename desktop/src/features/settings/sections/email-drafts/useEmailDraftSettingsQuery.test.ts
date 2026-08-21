import { describe, expect, it } from 'vitest'

import type { EmailDraftSettings } from '@/features/settings/sections/email-drafts/email-draft-settings-client'
import { emailDraftSettingsCacheTransforms } from '@/features/settings/sections/email-drafts/useEmailDraftSettingsQuery'

const original: EmailDraftSettings = {
  enabled: true,
  includeSharingLink: true,
  draftPrompt: 'Original',
  updatedAt: '2026-08-20T00:00:00Z',
}

describe('email draft settings cache transforms', () => {
  it('optimistically merges only patched fields', () => {
    expect(emailDraftSettingsCacheTransforms.mergePatch(original, { enabled: false })).toEqual({
      ...original,
      enabled: false,
    })
  })

  it('rolls back a failed field without overwriting a newer optimistic value', () => {
    const newer = { ...original, enabled: true, draftPrompt: 'Newer prompt' }
    expect(emailDraftSettingsCacheTransforms.rollbackPatch(newer, original, { draftPrompt: 'Failed prompt' })).toEqual(newer)
  })

  it('merges a canonical response without overwriting unrelated newer state', () => {
    const current = { ...original, enabled: false, draftPrompt: 'Locally newer' }
    const canonical = {
      ...original,
      enabled: true,
      draftPrompt: 'Saved prompt',
      updatedAt: '2026-08-20T00:01:00Z',
    }
    expect(emailDraftSettingsCacheTransforms.mergeCanonicalResponse(current, canonical, { draftPrompt: 'Older prompt' })).toEqual({
      ...current,
      updatedAt: canonical.updatedAt,
    })
  })
})

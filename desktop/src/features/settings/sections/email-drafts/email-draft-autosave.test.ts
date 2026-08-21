import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDebouncedPromptSave } from '@/features/settings/sections/email-drafts/email-draft-autosave'

afterEach(() => vi.useRealTimers())

describe('email draft prompt autosave', () => {
  it('saves only the latest value after the debounce window', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const autosave = createDebouncedPromptSave(save, 750)
    autosave.schedule('first')
    vi.advanceTimersByTime(500)
    autosave.schedule('latest')
    vi.advanceTimersByTime(749)
    expect(save).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith('latest')
  })

  it('flushes an empty prompt immediately on blur', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const autosave = createDebouncedPromptSave(save)
    autosave.schedule('')
    autosave.flush()
    expect(save).toHaveBeenCalledWith('')
    vi.runAllTimers()
    expect(save).toHaveBeenCalledOnce()
  })

  it('cancels pending account-local work on unmount', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const autosave = createDebouncedPromptSave(save)
    autosave.schedule('private prompt')
    autosave.cancel()
    vi.runAllTimers()
    expect(save).not.toHaveBeenCalled()
  })
})

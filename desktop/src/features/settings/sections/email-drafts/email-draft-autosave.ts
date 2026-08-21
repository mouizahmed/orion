export type DebouncedPromptSave = {
  schedule: (value: string) => void
  flush: () => void
  cancel: () => void
}

export function createDebouncedPromptSave(
  save: (value: string) => void,
  delay = 750,
): DebouncedPromptSave {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: string | undefined

  const flush = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    if (pending === undefined) return
    const value = pending
    pending = undefined
    save(value)
  }

  return {
    schedule(value) {
      pending = value
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(flush, delay)
    },
    flush,
    cancel() {
      if (timer !== null) clearTimeout(timer)
      timer = null
      pending = undefined
    },
  }
}

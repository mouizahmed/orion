import { useEffect } from 'react'

import type { RecordingNoteDraft } from '@/features/recording/recording-types'
import { desktopApi } from '@/lib/desktop-api'

/**
 * Feed of the main-process recording note draft: live events first, with the
 * current value fetched once as a fallback and deduplicated by the draft's
 * monotonic version, so a slow initial fetch can never override a newer event.
 * `onDraft` also receives null when main clears the draft.
 *
 * The version guard lives for the lifetime of one subscription. Callers whose
 * handler identity changes (e.g. per recording session) restart the
 * subscription and its guard with it.
 */
export function useRecordingNoteDraftFeed(onDraft: (draft: RecordingNoteDraft | null) => void) {
  useEffect(() => {
    let active = true
    let newestVersion = 0
    let receivedDraftEvent = false
    const apply = (draft: RecordingNoteDraft | null) => {
      if (!draft) {
        onDraft(null)
        return
      }
      if (draft.version <= newestVersion) return
      newestVersion = draft.version
      onDraft(draft)
    }
    const unsubscribe = desktopApi.recording.onNoteDraft((draft) => {
      receivedDraftEvent = true
      apply(draft)
    })
    void desktopApi.recording.getNoteDraft().then((draft) => {
      if (active && !receivedDraftEvent) apply(draft)
    }).catch((error) => {
      console.error('Failed to load recording note draft', error)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [onDraft])
}

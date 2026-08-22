export function reconcileCanonicalDraft(
  previousCanonical: string,
  draft: string,
  nextCanonical: string,
): string | null {
  if (nextCanonical === previousCanonical) return null
  if (draft !== previousCanonical) return null
  return nextCanonical
}

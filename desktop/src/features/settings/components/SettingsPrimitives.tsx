export function SettingRow({
  label,
  value,
  action,
}: {
  label: string
  value?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 last:border-b-0 dark:border-white/10">
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">{label}</div>
        {value ? <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{value}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function ToggleSwitch({
  enabled,
  onClick,
  disabled = false,
  ariaLabel,
}: {
  enabled: boolean
  onClick?: () => void
  disabled?: boolean
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={enabled}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={[
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
        enabled ? 'bg-[#7c3aed] dark:bg-[#9f73f2]' : 'bg-neutral-300 dark:bg-white/25',
        disabled ? 'cursor-not-allowed opacity-60' : '',
      ].join(' ')}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <span className={[
        'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
        enabled ? 'translate-x-4' : 'translate-x-0',
      ].join(' ')} />
    </button>
  )
}

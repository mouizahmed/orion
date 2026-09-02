import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

type ViewSwitchOption<T extends string> = {
  label: string
  value: T
}

type ViewSwitchProps<T extends string> = {
  options: readonly ViewSwitchOption<T>[]
  className?: string
  ariaLabel: string
}

export function ViewSwitch<T extends string>({
  options,
  className,
  ariaLabel,
}: ViewSwitchProps<T>) {
  return (
    <TabsList
      aria-label={ariaLabel}
      className={cn(
        'note-view-tabs h-8 shrink-0 rounded-full border border-neutral-200 bg-neutral-100/80 p-0.5 text-neutral-500 shadow-none',
        'dark:border-white/10 dark:bg-white/5 dark:text-neutral-400',
        className,
      )}
    >
      {options.map((option) => (
        <TabsTrigger
          key={option.value}
          value={option.value}
          className="h-full rounded-full px-3 py-0 text-xs shadow-none data-[state=active]:bg-white data-[state=active]:text-neutral-950 dark:data-[state=active]:border-0 dark:data-[state=active]:bg-white/12 dark:data-[state=active]:text-white"
        >
          {option.label}
        </TabsTrigger>
      ))}
    </TabsList>
  )
}

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

type DropdownWidth = "sm" | "md" | "lg" | "trigger"
type DropdownSize = "sm" | "md"
type DropdownItemLayout = "single" | "multiline"
type DropdownItemRadius = "full" | "md"

const widthClasses: Record<DropdownWidth, string> = {
  sm: "w-36 min-w-36",
  md: "w-40 min-w-40",
  lg: "w-72 min-w-72",
  trigger: "min-w-[var(--radix-select-trigger-width)]",
}

const itemSizeClasses: Record<DropdownSize, string> = {
  sm: "h-7 text-[11px]",
  md: "h-8 text-xs",
}

const itemRadiusClasses: Record<DropdownItemRadius, string> = {
  full: "rounded-full",
  md: "rounded-md",
}

function dropdownSurfaceClassName({
  className,
  width = "md",
}: {
  className?: string
  width?: DropdownWidth
}) {
  return cn(
    "overflow-hidden rounded-lg border border-neutral-200 bg-white/95 py-1 text-neutral-900 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/95 dark:text-neutral-100",
    widthClasses[width],
    className,
  )
}

function dropdownViewportClassName(className?: string) {
  return cn(className)
}

function dropdownSeparatorClassName(className?: string) {
  return cn("pointer-events-none my-1 h-px bg-neutral-200 dark:bg-white/10", className)
}

function dropdownItemClassName({
  className,
  size = "md",
  destructive = false,
  layout = "single",
  radius = "md",
}: {
  className?: string
  size?: DropdownSize
  destructive?: boolean
  layout?: DropdownItemLayout
  radius?: DropdownItemRadius
}) {
  return cn(
    "relative mx-1 my-0.5 flex w-[calc(100%-8px)] cursor-pointer select-none items-center gap-2 px-2 outline-none transition-colors disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
    itemRadiusClasses[radius],
    layout === "multiline" ? "h-auto min-h-8 py-1.5 text-xs leading-4" : cn(itemSizeClasses[size], "leading-none"),
    destructive
      ? "text-red-600 hover:bg-red-50 hover:text-red-700 focus:bg-red-50 focus:text-red-700 dark:text-red-300 dark:hover:bg-red-500/12 dark:hover:text-red-200 dark:focus:bg-red-500/12 dark:focus:text-red-200"
      : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 focus:bg-neutral-100 focus:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white dark:focus:bg-white/10 dark:focus:text-white",
    className,
  )
}

function DropdownSurface({
  className,
  width = "md",
  ...props
}: React.ComponentProps<"div"> & {
  width?: DropdownWidth
}) {
  return <div data-slot="dropdown-surface" className={dropdownSurfaceClassName({ className, width })} {...props} />
}

function DropdownPopover({
  className,
  align = "start",
  sideOffset = 4,
  width = "md",
  ...props
}: React.ComponentProps<"div"> & {
  align?: "start" | "end"
  sideOffset?: number
  width?: DropdownWidth
}) {
  return (
    <DropdownSurface
      width={width}
      className={cn(
        "absolute z-[60]",
        align === "end" ? "right-0" : "left-0",
        sideOffset === 4 ? "top-[calc(100%+4px)]" : "top-full",
        className,
      )}
      {...props}
    />
  )
}

function DropdownItem({
  className,
  size = "md",
  destructive = false,
  layout = "single",
  radius,
  children,
  ...props
}: React.ComponentProps<"button"> & {
  size?: DropdownSize
  destructive?: boolean
  layout?: DropdownItemLayout
  radius?: DropdownItemRadius
}) {
  return (
    <button
      data-slot="dropdown-item"
      type="button"
      className={dropdownItemClassName({
        className,
        size,
        destructive,
        layout,
        radius,
      })}
      {...props}
    >
      {children}
    </button>
  )
}

function DropdownIconSlot({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="dropdown-icon-slot" className={cn("flex size-3.5 shrink-0 items-center justify-center", className)} {...props} />
}

function DropdownLabel({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dropdown-label" className={cn("px-3 py-1.5 text-xs text-neutral-400 dark:text-neutral-500", className)} {...props} />
}

function DropdownSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dropdown-separator" className={dropdownSeparatorClassName(className)} {...props} />
}

function SelectDropdownContent({
  className,
  children,
  width = "md",
  position = "popper",
  align = "center",
  viewportClassName,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
  width?: DropdownWidth
  viewportClassName?: string
}) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-dropdown-content"
        className={cn(
          "relative z-50 max-h-(--radix-select-content-available-height) origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          dropdownSurfaceClassName({ width }),
          className,
        )}
        position={position}
        align={align}
        {...props}
      >
        <SelectPrimitive.Viewport
          className={dropdownViewportClassName(
            cn(position === "popper" && "scroll-my-1", viewportClassName),
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectDropdownItem({
  className,
  children,
  size = "md",
  destructive = false,
  checkPosition = "left",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & {
  size?: DropdownSize
  destructive?: boolean
  checkPosition?: "left" | "right"
}) {
  return (
    <SelectPrimitive.Item
      data-slot="select-dropdown-item"
      className={dropdownItemClassName({
        className: cn(checkPosition === "right" && "pr-8", className),
        size,
        destructive,
      })}
      {...props}
    >
      {checkPosition === "left" ? (
        <DropdownIconSlot>
          <SelectPrimitive.ItemIndicator>
            <Check className="size-3.5" />
          </SelectPrimitive.ItemIndicator>
        </DropdownIconSlot>
      ) : null}
      <SelectPrimitive.ItemText asChild>
        <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      </SelectPrimitive.ItemText>
      {checkPosition === "right" ? (
        <span className="absolute right-2 flex size-3.5 items-center justify-center">
          <SelectPrimitive.ItemIndicator>
            <Check className="size-3.5" />
          </SelectPrimitive.ItemIndicator>
        </span>
      ) : null}
    </SelectPrimitive.Item>
  )
}

function SelectDropdownSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator data-slot="select-dropdown-separator" className={dropdownSeparatorClassName(className)} {...props} />
}

export {
  DropdownIconSlot,
  DropdownItem,
  DropdownLabel,
  DropdownPopover,
  DropdownSeparator,
  DropdownSurface,
  SelectDropdownContent,
  SelectDropdownItem,
  SelectDropdownSeparator,
  dropdownItemClassName,
  dropdownSeparatorClassName,
  dropdownSurfaceClassName,
  dropdownViewportClassName,
}

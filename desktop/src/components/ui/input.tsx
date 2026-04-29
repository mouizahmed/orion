import * as React from "react"

import { cn } from "@/lib/utils"

type InputProps = React.ComponentProps<"input"> & {
  variant?: "surface" | "ghost"
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant = "surface", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        className={cn(
          "h-8 w-full min-w-0 px-3 py-1 text-xs text-neutral-100 outline-none transition-[border-color,box-shadow,background-color] placeholder:text-neutral-500 selection:bg-violet-600 selection:text-white file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-neutral-100 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          variant === "surface"
            ? "rounded-full border border-white/12 bg-white/5"
            : "rounded-none border-0 bg-transparent px-0 shadow-none",
          "focus-visible:border-white/20 focus-visible:ring-2 focus-visible:ring-white/10",
          variant === "ghost" && "focus-visible:border-transparent focus-visible:ring-0",
          "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
          className
        )}
        {...props}
      />
    )
  }
)

Input.displayName = "Input"

export { Input }

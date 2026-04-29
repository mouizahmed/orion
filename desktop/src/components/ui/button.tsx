import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full text-xs font-medium leading-none outline-none transition-colors disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:shrink-0 focus-visible:ring-2 focus-visible:ring-neutral-900/10 dark:focus-visible:ring-white/20 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "border border-neutral-200 bg-white/80 text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 dark:border-white/12 dark:bg-[#171417]/80 dark:text-neutral-200 dark:hover:bg-white/10 dark:hover:text-white",
        destructive:
          "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500/20",
        outline:
          "border border-neutral-200 bg-transparent text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 dark:border-white/12 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white",
        secondary:
          "border border-neutral-200 bg-white/70 text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 dark:border-white/12 dark:bg-white/5 dark:text-neutral-200 dark:hover:bg-white/10 dark:hover:text-white",
        ghost:
          "text-neutral-600 hover:bg-neutral-200/70 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/8 dark:hover:text-white",
        link: "text-[#9f73f2] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-8 gap-2 px-3",
        lg: "h-10 px-4",
        icon: "size-8",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

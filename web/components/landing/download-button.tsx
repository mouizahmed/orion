"use client";

import Image from "next/image";
import { ChevronDown, Terminal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOS } from "@/hooks/useOS";
import { cn } from "@/lib/utils";

interface DownloadButtonProps {
  variant?: "default" | "outline" | "light";
  size?: "sm" | "md" | "lg";
  className?: string;
}

function PlatformIcon({
  platform,
  inverted = true,
}: {
  platform: string;
  inverted?: boolean;
}) {
  if (platform === "windows") {
    return (
      <Image
        src="/windows.svg"
        alt=""
        width={16}
        height={16}
        className={inverted ? "size-4 invert" : "size-4"}
      />
    );
  }

  if (platform === "mac") {
    return (
      <Image
        src="/apple.svg"
        alt=""
        width={16}
        height={16}
        className={inverted ? "size-4 invert" : "size-4"}
      />
    );
  }

  return <Terminal className="size-4" />;
}

const platformOptions = [
  {
    id: "windows",
    title: "Download for Windows",
    description: "Windows 10/11",
  },
  {
    id: "mac",
    title: "Download for macOS",
    description: "Apple silicon and Intel",
  },
  {
    id: "linux",
    title: "Download for Linux",
    description: "AppImage package",
  },
];

export default function DownloadButton({
  variant = "default",
  size = "md",
  className = "",
}: DownloadButtonProps) {
  const os = useOS();

  const baseClasses =
    "font-medium rounded-full transition-colors inline-flex items-stretch overflow-hidden";
  const sizeClasses = {
    sm: "h-9 text-sm",
    md: "h-12 text-base",
    lg: "h-14 text-lg",
  };
  const labelClasses = {
    sm: "gap-2 px-4",
    md: "gap-2 px-6",
    lg: "gap-3 px-8",
  };
  const triggerClasses = {
    sm: "w-9",
    md: "w-11",
    lg: "w-12",
  };
  const variantClasses = {
    default: "bg-brand hover:bg-brand-light text-white",
    light: "bg-zinc-100 hover:bg-white text-zinc-950",
    outline:
      "bg-zinc-900 hover:bg-zinc-800 text-zinc-50 border border-zinc-700",
  };
  const dividerClasses = {
    default: "border-white/20",
    light: "border-zinc-300",
    outline: "border-zinc-700",
  };

  const currentPlatform =
    platformOptions.find((option) => option.id === os) ?? platformOptions[0];

  return (
    <DropdownMenu>
      <div
        className={cn(
          baseClasses,
          sizeClasses[size],
          variantClasses[variant],
          className,
        )}
      >
        <button
          type="button"
          className={cn(
            "inline-flex h-full items-center justify-center whitespace-nowrap",
            labelClasses[size],
          )}
          aria-label={currentPlatform.title}
        >
          <PlatformIcon
            platform={currentPlatform.id}
            inverted={variant !== "light"}
          />
          Download
        </button>

        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex h-full items-center justify-center border-l transition-colors hover:bg-black/5",
              dividerClasses[variant],
              triggerClasses[size],
            )}
            aria-label="Show other download options"
          >
            <ChevronDown className="size-4" />
          </button>
        </DropdownMenuTrigger>
      </div>

      <DropdownMenuContent
        align="end"
        className="w-64 border-zinc-800 bg-zinc-950 text-zinc-100"
      >
        <DropdownMenuLabel className="text-xs uppercase tracking-[0.18em] text-zinc-500">
          Install options
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-zinc-800" />
        {platformOptions.map((option) => (
          <DropdownMenuItem
            key={option.id}
            className="cursor-pointer items-start gap-3 px-3 py-3 transition-colors hover:bg-zinc-900 hover:text-white focus:bg-zinc-900 focus:text-white"
          >
            <span className="mt-0.5">
              <PlatformIcon platform={option.id} />
            </span>
            <span>
              <span className="block font-medium">{option.title}</span>
              <span className="block text-xs text-zinc-500">
                {option.description}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

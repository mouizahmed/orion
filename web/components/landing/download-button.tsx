"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useOS } from "@/hooks/useOS";

interface DownloadButtonProps {
  variant?: "default" | "outline";
  size?: "sm" | "md" | "lg";
  className?: string;
}

function DownloadGridIcon() {
  return (
    <span className="grid h-4 w-4 grid-cols-2 gap-0.5">
      <span className="bg-current" />
      <span className="bg-current" />
      <span className="bg-current" />
      <span className="bg-current" />
    </span>
  );
}

export default function DownloadButton({
  variant = "default",
  size = "md",
  className = "",
}: DownloadButtonProps) {
  const os = useOS();

  const baseClasses =
    "font-medium rounded-full transition-colors flex items-center gap-2";
  const sizeClasses = {
    sm: "px-4 py-2 text-sm",
    md: "px-6 py-3 text-base",
    lg: "px-8 py-6 text-lg",
  };
  const variantClasses = {
    default: "bg-violet-600 hover:bg-violet-700 text-white",
    outline:
      "bg-zinc-900 hover:bg-zinc-800 text-zinc-50 border border-zinc-700",
  };

  const buttonClasses = `${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`;

  // Windows users get direct download
  if (os === "windows") {
    return (
      <Button className={buttonClasses}>
        <DownloadGridIcon />
        Download
      </Button>
    );
  }

  // Mac users get direct download
  if (os === "mac") {
    return (
      <Button className={buttonClasses}>
        <DownloadGridIcon />
        Download
      </Button>
    );
  }

  // All other users get dialog
  return (
    <Dialog>
      <DialogTrigger asChild>
        <div className={`${buttonClasses} cursor-pointer`}>
          <DownloadGridIcon />
          Download
        </div>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose your platform</DialogTitle>
          <DialogDescription>
            Select the download option for your operating system.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Button className="flex items-center gap-3 p-4 h-auto">
            <DownloadGridIcon />
            <div className="text-left">
              <div className="font-medium">Download for Windows</div>
              <div className="text-sm text-muted-foreground">Windows 10/11</div>
            </div>
          </Button>
          <Button className="flex items-center gap-3 p-4 h-auto">
            <DownloadGridIcon />
            <div className="text-left">
              <div className="font-medium">Download for Mac</div>
              <div className="text-sm text-muted-foreground">macOS 10.15+</div>
            </div>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

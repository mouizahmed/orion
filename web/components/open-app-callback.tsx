"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import Image from "next/image";
import { Spinner } from "@/components/ui/spinner";

const callbackShellClass = "flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-center";

type OpenAppCallbackProps = {
  protocolUrl: string | null;
  error?: string | null;
  failureTitle: string;
  failureBody: string;
  successTitle?: string;
  successBody?: string;
  showManualOpen?: boolean;
}

export function OpenAppCallback({
  protocolUrl,
  error,
  failureTitle,
  failureBody,
  successTitle = "Opening Orion...",
  successBody = "Your browser should prompt you to open the app automatically.",
  showManualOpen = true,
}: OpenAppCallbackProps) {
  const router = useRouter();
  const automaticOpenAttemptedRef = useRef(false);

  useEffect(() => {
    if (!protocolUrl || automaticOpenAttemptedRef.current) return;

    automaticOpenAttemptedRef.current = true;
    window.location.href = protocolUrl;
  }, [protocolUrl]);

  const handleManualOpen = () => {
    if (protocolUrl) {
      window.location.href = protocolUrl;
    }
  };

  if (error) {
    return (
      <div className={`${callbackShellClass} py-10`}>
        <div className="flex w-full max-w-xl flex-col items-center gap-6">
          <Image
            src="/orion-logo.svg"
            alt="Orion Logo"
            width={112}
            height={112}
            draggable={false}
            className="pointer-events-none select-none rounded-md"
          />

          <div className="space-y-3">
            <h1 className="text-3xl font-semibold text-rose-100 sm:text-4xl">
              {failureTitle}
            </h1>
            <p className="text-sm text-rose-200/80 sm:text-base">
              {failureBody}
            </p>
          </div>

          {protocolUrl ? (
            <button
              onClick={handleManualOpen}
              className="inline-flex items-center gap-2 text-brand underline decoration-brand-dark underline-offset-4 transition hover:text-brand-light"
            >
              <ExternalLink className="h-4 w-4" />
              Open Orion
            </button>
          ) : null}

          <button
            onClick={() => router.push("/")}
            className="rounded-full bg-brand px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-black/30 transition hover:bg-brand-light"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${callbackShellClass} py-12`}>
      <div className="flex w-full max-w-2xl flex-col items-center gap-6">
        <Image
          src="/orion-logo.svg"
          alt="Orion Logo"
          width={128}
          height={128}
          draggable={false}
          className="pointer-events-none select-none rounded-md"
        />

        <div className="space-y-3">
          <h1 className="text-4xl font-semibold text-zinc-50 sm:text-5xl">
            {successTitle}
          </h1>
          <p className="text-sm text-zinc-400 sm:text-base">
            {successBody}
          </p>
        </div>

        {showManualOpen && protocolUrl ? (
          <div className="space-y-2 text-sm text-zinc-400">
            <span className="block">Nothing happened?</span>
            <button
              onClick={handleManualOpen}
              className="inline-flex items-center gap-2 text-brand underline decoration-brand-dark underline-offset-4 transition hover:text-brand-light"
            >
              <ExternalLink className="h-4 w-4" />
              Click here to open Orion.
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function OpenAppCallbackFallback() {
  return (
    <div className={`${callbackShellClass} py-12`}>
      <div className="flex flex-col items-center gap-4">
        <Spinner className="size-12 text-brand" />
        <p className="text-sm text-zinc-400">Loading...</p>
      </div>
    </div>
  );
}

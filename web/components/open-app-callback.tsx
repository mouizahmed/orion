"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import Image from "next/image";
import { pageBackground } from "@/lib/styles";

const callbackShellClass = `flex min-h-screen items-center justify-center ${pageBackground} px-6 text-center`;

type OpenAppCallbackProps = {
  protocolUrl: string | null;
  error?: string | null;
  failureTitle: string;
  failureBody: string;
  showManualOpen?: boolean;
}

export function OpenAppCallback({
  protocolUrl,
  error,
  failureTitle,
  failureBody,
  showManualOpen = true,
}: OpenAppCallbackProps) {
  const router = useRouter();

  useEffect(() => {
    if (!protocolUrl) return;

    try {
      window.location.href = protocolUrl;

      setTimeout(() => {
        if (window.opener) {
          window.close();
        }
      }, 1000);
    } catch {
      console.log("Could not redirect to app");
    }
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
            src="/orionly-mark.svg"
            alt="Orionly Logo"
            width={80}
            height={80}
            className="rounded-md"
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
              Open Orionly
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
          src="/orionly-mark.svg"
          alt="Orionly Logo"
          width={88}
          height={88}
          className="rounded-md"
        />

        <div className="space-y-3">
          <h1 className="text-4xl font-semibold text-zinc-50 sm:text-5xl">
            Opening Orionly...
          </h1>
          <p className="text-sm text-zinc-400 sm:text-base">
            Your browser should prompt you to open the app automatically.
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
              Click here to open Orionly.
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
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-zinc-800 border-t-brand"></div>
        <p className="text-sm text-zinc-400">Loading...</p>
      </div>
    </div>
  );
}

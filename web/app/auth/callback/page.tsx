"use client";

import { useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import Image from "next/image";
import { pageBackground } from "@/lib/styles";

const authShellClass = `flex min-h-screen items-center justify-center ${pageBackground} px-6 text-center`;

function AuthCallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const error = searchParams.get("error");
    const code = searchParams.get("code");
    const state = searchParams.get("state");

    if (error) {
      console.log("❌ OAuth error:", error);
      return;
    }

    if (!code) {
      console.warn("⚠️ No code in callback URL");
      return;
    }

    console.log("🔑 Code received:", code);
    console.log("🔑 State received:", state);

    // Try to open desktop app
    try {
      const protocolUrl = `orionly://auth-complete?code=${code}&state=${state}`;
      console.log("🔗 Opening app with:", protocolUrl);

      // Set location to trigger protocol
      window.location.href = protocolUrl;

      // Try to close if opened from desktop app
      setTimeout(() => {
        if (window.opener) {
          window.close();
        }
      }, 1000);
    } catch {
      console.log("Could not redirect to app");
    }
  }, [searchParams]);

  const handleManualOpen = () => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    if (code) {
      window.location.href = `orionly://auth-complete?code=${code}&state=${state}`;
    }
  };

  const error = searchParams.get("error");
  const code = searchParams.get("code");

  // Show error state
  if (error) {
    return (
      <div className={`${authShellClass} py-10`}>
        <div className="flex w-full max-w-xl flex-col items-center gap-6">
          <Image
            src="/orionly-mark.svg"
            alt="Orionly Logo"
            width={80}
            height={80}
            className="rounded-md"
          />

          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-950 text-rose-300 shadow-sm">
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>

          <div className="space-y-3">
            <h1 className="text-3xl font-semibold text-rose-100 sm:text-4xl">
              Authentication Failed
            </h1>
            <p className="text-sm text-rose-200/80 sm:text-base">
              Authentication was cancelled or failed. You can return to the
              homepage and try again.
            </p>
          </div>

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

  // Show success state
  return (
    <div className={`${authShellClass} py-12`}>
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

        {code && (
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
        )}
      </div>
    </div>
  );
}

export default function AuthCallback() {
  return (
    <Suspense
      fallback={
        <div className={`${authShellClass} py-12`}>
          <div className="flex flex-col items-center gap-4">
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-zinc-800 border-t-brand"></div>
            <p className="text-sm text-zinc-400">Loading...</p>
          </div>
        </div>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}

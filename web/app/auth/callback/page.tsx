"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  OpenAppCallback,
  OpenAppCallbackFallback,
} from "@/components/open-app-callback";

function buildProtocolUrl(params: { code?: string; error?: string; errorDescription?: string; state?: string }) {
  const query = new URLSearchParams();
  if (params.code) query.set("code", params.code);
  if (params.error) query.set("error", params.error);
  if (params.errorDescription) query.set("error_description", params.errorDescription);
  if (params.state) query.set("state", params.state);
  return `orion://auth-complete?${query.toString()}`;
}

function AuthCallbackContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const platform = searchParams.get("platform");
  const isDesktopCallback = platform === "desktop";
  const protocolUrl = isDesktopCallback && error
    ? buildProtocolUrl({ error, errorDescription: errorDescription ?? undefined, state: state ?? undefined })
    : isDesktopCallback && code
      ? buildProtocolUrl({ code, state: state ?? undefined })
      : null;
  const callbackError = error || (!isDesktopCallback ? "unsupported_platform" : null);

  if (!error && !code) {
    console.warn("No code in callback URL");
  }

  return (
    <OpenAppCallback
      protocolUrl={protocolUrl}
      error={callbackError}
      failureTitle={isDesktopCallback ? "Authentication Failed" : "Unsupported Login"}
      failureBody={
        isDesktopCallback
          ? "Authentication was cancelled or failed. You can return to the homepage and try again."
          : "Web login is not available yet. Open Orion and sign in from the desktop app."
      }
      showManualOpen={Boolean(isDesktopCallback && code)}
    />
  );
}

export default function AuthCallback() {
  return (
    <Suspense fallback={<OpenAppCallbackFallback />}>
      <AuthCallbackContent />
    </Suspense>
  );
}

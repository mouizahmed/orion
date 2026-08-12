"use client";

import { Suspense, useEffect, useState } from "react";
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
  // Capture the callback exactly once before removing credentials and state
  // from browser history. useSearchParams can update after replaceState;
  // reading it directly on every render made a valid desktop callback appear
  // to become an unsupported web login after the URL was scrubbed.
  const [callback] = useState(() => ({
    error: searchParams.get("error"),
    errorDescription: searchParams.get("error_description"),
    code: searchParams.get("code"),
    state: searchParams.get("state"),
    platform: searchParams.get("platform"),
  }));
  const { error, errorDescription, code, state, platform } = callback;
  const isDesktopCallback = platform === "desktop";
  const protocolUrl = isDesktopCallback && error
    ? buildProtocolUrl({ error, errorDescription: errorDescription ?? undefined, state: state ?? undefined })
    : isDesktopCallback && code
      ? buildProtocolUrl({ code, state: state ?? undefined })
      : null;
  const callbackError = error || (!isDesktopCallback ? "unsupported_platform" : null);

  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

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

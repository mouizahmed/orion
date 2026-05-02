"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  OpenAppCallback,
  OpenAppCallbackFallback,
} from "@/components/open-app-callback";

function buildProtocolUrl(params: { code?: string; error?: string; errorDescription?: string }) {
  const query = new URLSearchParams();
  if (params.code) query.set("code", params.code);
  if (params.error) query.set("error", params.error);
  if (params.errorDescription) query.set("error_description", params.errorDescription);
  return `orionly://auth-complete?${query.toString()}`;
}

function AuthCallbackContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  const code = searchParams.get("code");
  const protocolUrl = error
    ? buildProtocolUrl({ error, errorDescription: errorDescription ?? undefined })
    : code
      ? buildProtocolUrl({ code })
      : null;

  if (!error && !code) {
    console.warn("No code in callback URL");
  }

  return (
    <OpenAppCallback
      protocolUrl={protocolUrl}
      error={error}
      failureTitle="Authentication Failed"
      failureBody="Authentication was cancelled or failed. You can return to the homepage and try again."
      showManualOpen={Boolean(code)}
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

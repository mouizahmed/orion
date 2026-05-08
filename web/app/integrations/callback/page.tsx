"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  OpenAppCallback,
  OpenAppCallbackFallback,
} from "@/components/open-app-callback";

function buildProtocolUrl(params: {
  success?: string;
  provider?: string;
  feature?: string;
  error?: string;
  errorDescription?: string;
}) {
  const query = new URLSearchParams();
  if (params.success) query.set("success", params.success);
  if (params.provider) query.set("provider", params.provider);
  if (params.feature) query.set("feature", params.feature);
  if (params.error) query.set("error", params.error);
  if (params.errorDescription) query.set("error_description", params.errorDescription);
  return `orion://integrations/callback?${query.toString()}`;
}

function IntegrationCallbackContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const protocolUrl = buildProtocolUrl({
    success: searchParams.get("success") ?? undefined,
    provider: searchParams.get("provider") ?? undefined,
    feature: searchParams.get("feature") ?? undefined,
    error: error ?? undefined,
    errorDescription: searchParams.get("error_description") ?? undefined,
  });

  return (
    <OpenAppCallback
      protocolUrl={protocolUrl}
      error={error}
      failureTitle="Connection Failed"
      failureBody="Calendar connection was cancelled or failed. Return to Orion and try again."
    />
  );
}

export default function IntegrationCallback() {
  return (
    <Suspense fallback={<OpenAppCallbackFallback />}>
      <IntegrationCallbackContent />
    </Suspense>
  );
}

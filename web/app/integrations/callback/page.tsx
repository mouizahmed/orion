"use client";

import { Suspense, useEffect, useState } from "react";
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
  state?: string;
}) {
  const query = new URLSearchParams();
  if (params.success) query.set("success", params.success);
  if (params.provider) query.set("provider", params.provider);
  if (params.feature) query.set("feature", params.feature);
  if (params.error) query.set("error", params.error);
  if (params.errorDescription) query.set("error_description", params.errorDescription);
  if (params.state) query.set("state", params.state);
  return `orion://integrations/callback?${query.toString()}`;
}

function IntegrationCallbackContent() {
  const searchParams = useSearchParams();
  const [callback] = useState(() => ({
    success: searchParams.get("success"),
    provider: searchParams.get("provider"),
    feature: searchParams.get("feature"),
    error: searchParams.get("error"),
    errorDescription: searchParams.get("error_description"),
    state: searchParams.get("state"),
  }));
  const { error } = callback;
  const protocolUrl = buildProtocolUrl({
    success: callback.success ?? undefined,
    provider: callback.provider ?? undefined,
    feature: callback.feature ?? undefined,
    error: error ?? undefined,
    errorDescription: callback.errorDescription ?? undefined,
    state: callback.state ?? undefined,
  });

  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

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

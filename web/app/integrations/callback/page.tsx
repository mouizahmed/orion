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

const INTEGRATION_PARAMETERS = [
  "success",
  "provider",
  "feature",
  "error",
  "error_description",
  "state",
] as const;

function captureIntegrationCallback(searchParams: URLSearchParams) {
  if (
    [...searchParams.keys()].some(
      (name) =>
        !INTEGRATION_PARAMETERS.includes(
          name as (typeof INTEGRATION_PARAMETERS)[number],
        ),
    ) ||
    INTEGRATION_PARAMETERS.some(
      (name) => searchParams.getAll(name).length > 1,
    )
  ) return null;

  const success = searchParams.get("success");
  const provider = searchParams.get("provider");
  const feature = searchParams.get("feature");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  const state = searchParams.get("state");
  if (
    (success !== "true" && success !== "false") ||
    Boolean(provider && provider !== "google" && provider !== "microsoft") ||
    Boolean(feature && feature !== "calendar") ||
    (error?.length ?? 0) > 128 ||
    (errorDescription?.length ?? 0) > 512 ||
    Boolean(state && !/^[A-Za-z0-9_-]{43}$/.test(state)) ||
    (success === "true" && (!provider || feature !== "calendar" || !state || error || errorDescription)) ||
    (success === "false" && !error)
  ) return null;

  return { success, provider, feature, error, errorDescription, state };
}

function IntegrationCallbackContent() {
  const searchParams = useSearchParams();
  const [callback] = useState(() =>
    captureIntegrationCallback(new URLSearchParams(searchParams.toString())),
  );
  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  if (!callback) {
    return (
      <OpenAppCallback
        protocolUrl={null}
        error="invalid_callback"
        failureTitle="Connection Failed"
        failureBody="The calendar connection response was invalid. Return to Orion and try again."
        showManualOpen={false}
      />
    );
  }
  const { error } = callback;
  const protocolUrl = buildProtocolUrl({
    success: callback.success ?? undefined,
    provider: callback.provider ?? undefined,
    feature: callback.feature ?? undefined,
    error: error ?? undefined,
    errorDescription: callback.errorDescription ?? undefined,
    state: callback.state ?? undefined,
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

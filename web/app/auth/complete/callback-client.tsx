"use client";

import { useEffect, useRef, useState } from "react";
import {
  OpenAppCallback,
  OpenAppCallbackFallback,
} from "@/components/open-app-callback";

const ALLOWED_PARAMETERS = ["code", "error", "error_code", "error_description", "sb_flow_id"] as const;

type Callback = {
  protocolUrl: string | null;
  error: string | null;
};

function captureCallback(fragment: string): Callback {
  const params = new URLSearchParams(fragment.startsWith("#") ? fragment.slice(1) : fragment);
  if (params.get("invalid_callback") === "1") {
    return { protocolUrl: null, error: "invalid_callback" };
  }
  if (
    [...params.keys()].some((name) => !ALLOWED_PARAMETERS.includes(name as typeof ALLOWED_PARAMETERS[number]))
    || ALLOWED_PARAMETERS.some((name) => params.getAll(name).length > 1)
  ) {
    return { protocolUrl: null, error: "invalid_callback" };
  }

  const code = params.get("code");
  const error = params.get("error");
  const errorCode = params.get("error_code");
  const errorDescription = params.get("error_description");
  const flowId = params.get("sb_flow_id");
  if (
    Boolean(code) === Boolean(error)
    || (code?.length ?? 0) > 2048
    || (error?.length ?? 0) > 128
    || (errorCode?.length ?? 0) > 128
    || (errorDescription?.length ?? 0) > 512
    || Boolean(errorCode && !error)
    || Boolean(errorDescription && !error)
    || (flowId?.length ?? 0) > 512
    || Boolean(flowId && !code)
  ) {
    return { protocolUrl: null, error: "invalid_callback" };
  }

  const forwarded = new URLSearchParams();
  if (code) forwarded.set("code", code);
  if (error) forwarded.set("error", error);
  if (errorCode) forwarded.set("error_code", errorCode);
  if (errorDescription) forwarded.set("error_description", errorDescription);
  if (flowId) forwarded.set("sb_flow_id", flowId);
  return {
    protocolUrl: `orion://auth/callback?${forwarded.toString()}`,
    error,
  };
}

export function AuthCompleteClient() {
  const [callback, setCallback] = useState<Callback | null>(null);
  const capturedRef = useRef(false);

  useEffect(() => {
    if (capturedRef.current) return;
    capturedRef.current = true;
    const captured = captureCallback(window.location.hash);
    window.history.replaceState(null, "", window.location.pathname);
    setCallback(captured);
  }, []);

  if (!callback) return <OpenAppCallbackFallback />;

  return (
    <OpenAppCallback
      protocolUrl={callback.protocolUrl}
      error={callback.error}
      failureTitle="Sign-in Failed"
      failureBody="Sign-in was cancelled or could not be completed. Return to Orion and try again."
      successTitle="Opening Orion..."
      successBody="Your browser should prompt you to open Orion. You can close this tab after the app opens."
      showManualOpen={Boolean(callback.protocolUrl)}
    />
  );
}

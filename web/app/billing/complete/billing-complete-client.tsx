"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  OpenAppCallback,
  OpenAppCallbackFallback,
} from "@/components/open-app-callback";

type BillingResult = "success" | "cancelled" | "portal";

function readResult(params: URLSearchParams): BillingResult | null {
  if ([...params.keys()].some((key) => key !== "result" && key !== "session_id")) return null;
  if (params.getAll("result").length !== 1 || params.getAll("session_id").length > 1) return null;
  const result = params.get("result");
  if (result !== "success" && result !== "cancelled" && result !== "portal") return null;
  const sessionID = params.get("session_id");
  if ((sessionID?.length ?? 0) > 255) return null;
  return result;
}

function BillingCompleteContent() {
  const searchParams = useSearchParams();
  const [result] = useState<BillingResult | "invalid">(() =>
    readResult(new URLSearchParams(searchParams.toString())) ?? "invalid",
  );

  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  if (result === "invalid") {
    return (
      <OpenAppCallback
        protocolUrl={null}
        error="invalid_callback"
        failureTitle="Billing Return Failed"
        failureBody="This billing return link is invalid. Open Orion to check your current plan."
      />
    );
  }

  const protocolUrl = `orion://billing/complete?result=${encodeURIComponent(result)}`;
  const success = result === "success";
  return (
    <OpenAppCallback
      protocolUrl={protocolUrl}
      successTitle="Opening Orion..."
      successBody={
        success
          ? "Orion is verifying your subscription. Your plan will update after Stripe confirms it."
          : "Return to Orion to review your billing status."
      }
      failureTitle="Billing Return Failed"
      failureBody="Open Orion to check your current plan."
      showManualOpen
    />
  );
}

export function BillingCompleteClient() {
  return (
    <Suspense fallback={<OpenAppCallbackFallback />}>
      <BillingCompleteContent />
    </Suspense>
  );
}

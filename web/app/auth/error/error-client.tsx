"use client";

import { useEffect, useRef, useState } from "react";
import {
  OpenAppCallback,
  OpenAppCallbackFallback,
} from "@/components/open-app-callback";
import { authErrorCopy, validatedAuthError } from "@/lib/auth-error";

type ErrorCopy = ReturnType<typeof authErrorCopy>;

export function AuthErrorClient() {
  const [copy, setCopy] = useState<ErrorCopy | null>(null);
  const capturedRef = useRef(false);

  useEffect(() => {
    if (capturedRef.current) return;
    capturedRef.current = true;
    const authError = validatedAuthError(
      new URLSearchParams(window.location.hash.slice(1)),
    );
    window.history.replaceState(null, "", window.location.pathname);
    setCopy(
      authError
        ? authErrorCopy(authError.details)
        : {
            title: "Sign-in Failed",
            body: "No valid sign-in error was provided. Return to Orion and start a new sign-in.",
          },
    );
  }, []);

  if (!copy) return <OpenAppCallbackFallback />;

  return (
    <OpenAppCallback
      protocolUrl={null}
      error="auth_error"
      failureTitle={copy.title}
      failureBody={copy.body}
      showManualOpen={false}
    />
  );
}

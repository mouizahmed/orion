"use client";

import { useEffect } from "react";
import { validatedAuthError } from "@/lib/auth-error";

export function AuthErrorFragmentFallback() {
  useEffect(() => {
    if (!window.location.hash) return;
    const authError = validatedAuthError(
      new URLSearchParams(window.location.hash.slice(1)),
    );
    if (!authError) return;
    window.location.replace(`/auth/error#${authError.forwarded.toString()}`);
  }, []);

  return null;
}

"use client";

import { useSyncExternalStore } from "react";

type OS = "windows" | "mac" | "linux" | "android" | "ios" | "unknown";

export function useOS() {
  return useSyncExternalStore(
    () => () => undefined,
    detectOS,
    () => "unknown",
  );
}

function detectOS(): OS {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("windows")) return "windows";
  if (userAgent.includes("android")) return "android";
  if (userAgent.includes("iphone") || userAgent.includes("ipad")) return "ios";
  if (userAgent.includes("mac")) return "mac";
  if (userAgent.includes("linux")) return "linux";
  return "unknown";
}

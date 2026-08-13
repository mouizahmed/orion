const ALLOWED_PARAMETERS = ["code", "error", "error_code", "error_description", "sb_flow_id"] as const;
const CALLBACK_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join("; ");

function validatedCallback(searchParams: URLSearchParams): URLSearchParams | null {
  if (
    [...searchParams.keys()].some((name) => !ALLOWED_PARAMETERS.includes(name as typeof ALLOWED_PARAMETERS[number]))
    || ALLOWED_PARAMETERS.some((name) => searchParams.getAll(name).length > 1)
  ) {
    return null;
  }

  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const errorCode = searchParams.get("error_code");
  const errorDescription = searchParams.get("error_description");
  const flowId = searchParams.get("sb_flow_id");
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
    return null;
  }

  const forwarded = new URLSearchParams();
  if (code) forwarded.set("code", code);
  if (error) forwarded.set("error", error);
  if (errorCode) forwarded.set("error_code", errorCode);
  if (errorDescription) forwarded.set("error_description", errorDescription);
  if (flowId) forwarded.set("sb_flow_id", flowId);
  return forwarded;
}

export function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const callback = validatedCallback(requestUrl.searchParams);
  const destination = new URL("/auth/complete", requestUrl.origin);
  destination.hash = callback?.toString() || "invalid_callback=1";

  return new Response(null, {
    status: 303,
    headers: {
      Location: destination.toString(),
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": CALLBACK_CSP,
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

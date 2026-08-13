import { NextResponse, type NextRequest } from "next/server";
import { validatedAuthError } from "@/lib/auth-error";

export function proxy(request: NextRequest) {
  const authError = validatedAuthError(request.nextUrl.searchParams);
  if (!authError) return NextResponse.next();

  const destination = new URL("/auth/error", request.url);
  destination.hash = authError.forwarded.toString();
  const response = NextResponse.redirect(destination, 303);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: "/",
};

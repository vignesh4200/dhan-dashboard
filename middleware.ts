import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Lightweight edge check: just confirms the session cookie exists.
// Real verification (signature, expiry) happens server-side in each API route
// via firebase-admin, since that needs the Node runtime, not the Edge runtime.
export function middleware(req: NextRequest) {
  const session = req.cookies.get("session")?.value;
  const isProtected =
    req.nextUrl.pathname.startsWith("/dashboard") ||
    req.nextUrl.pathname.startsWith("/settings");

  if (isProtected && !session) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/settings/:path*"],
};

import { NextResponse, type NextRequest } from "next/server";

/**
 * Console access (BUILD_PLAN §3): /agent and the console-only APIs require the
 * passcode cookie (set by /agent/unlock) or the x-admin-passcode header
 * (scripts, tests). Worker routes stay public.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/agent/unlock")) return NextResponse.next();

  const passcode = process.env.ADMIN_PASSCODE;
  const authorized =
    !!passcode &&
    (req.cookies.get("legwork_admin")?.value === passcode ||
      req.headers.get("x-admin-passcode") === passcode);
  if (authorized) return NextResponse.next();

  if (pathname.startsWith("/agent")) {
    return NextResponse.redirect(new URL("/agent/unlock", req.url));
  }
  return NextResponse.json({ error: "console only" }, { status: 401 });
}

export const config = {
  matcher: [
    "/agent",
    "/agent/:path*",
    "/api/missions",
    "/api/missions/:path*",
    "/api/director",
    "/api/console",
    "/api/tasks/tick-all",
    "/api/tasks/:id/resolve",
  ],
};

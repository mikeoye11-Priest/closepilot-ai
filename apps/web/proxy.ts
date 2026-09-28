import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const AUTH_DISABLED = process.env.CLOSEPILOT_AUTH_DISABLED === "1" && process.env.NODE_ENV !== "production";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // /update-password is public so an expired or reused reset link reaches the
  // page's own "link expired" screen instead of being bounced to /login with no
  // explanation. The page still requires a session before it will change anything.
  const publicPaths = new Set([
    "/login",
    "/demo",
    "/compatibility",
    "/forgot-password",
    "/auth/callback",
    // The recipient has no session until verifyOtp runs inside this route, so
    // gating it would bounce every emailed link to /login before it could work.
    "/auth/confirm",
    "/update-password"
  ]);

  if (AUTH_DISABLED) {
    return NextResponse.next();
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    if (process.env.NODE_ENV === "production" && !publicPaths.has(pathname)) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
      }
    }
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user && !publicPaths.has(pathname)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"]
};

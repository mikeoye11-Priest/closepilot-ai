import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

type ApiSession =
  | { ok: true; userId: string | null; userEmail: string | null; authDisabled: boolean }
  | { ok: false; response: NextResponse };

const AUTH_DISABLED = process.env.CLOSEPILOT_AUTH_DISABLED === "1" && process.env.NODE_ENV !== "production";
const AUTH_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export async function requireApiSession(): Promise<ApiSession> {
  if (AUTH_DISABLED) {
    return { ok: true, userId: null, userEmail: null, authDisabled: true };
  }

  if (!AUTH_CONFIGURED) {
    if (process.env.NODE_ENV === "production") {
      return {
        ok: false,
        response: NextResponse.json({ error: "Authentication is not configured" }, { status: 503 })
      };
    }

    return { ok: true, userId: null, userEmail: null, authDisabled: true };
  }

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    };
  }

  return { ok: true, userId: user.id, userEmail: user.email ?? null, authDisabled: false };
}

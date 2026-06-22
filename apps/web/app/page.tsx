import { AppShell } from "@/components/app-shell";

export default async function Home() {
  let userEmail = "";
  const authDisabled = process.env.CLOSEPILOT_AUTH_DISABLED === "1" && process.env.NODE_ENV !== "production";

  if (!authDisabled && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const { createClient } = await import("@/lib/supabase-server");
    const { redirect } = await import("next/navigation");
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    userEmail = user?.email ?? "";
  }

  return <AppShell userEmail={userEmail} />;
}

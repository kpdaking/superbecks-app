import { supabase } from "@/lib/supabase";

export async function confirmAndLogout(message?: string) {
  const ok = window.confirm(message ?? "Are you sure you want to log out?");
  if (!ok) return false;

  await supabase.auth.signOut();

  // hard redirect so all client state resets
  window.location.href = "/login";
  return true;
}
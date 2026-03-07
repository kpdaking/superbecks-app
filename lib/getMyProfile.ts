import { supabase } from "./supabase";

export async function getMyProfile() {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr) throw userErr;
  if (!user) throw new Error("Not authenticated");

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("role, branch_id")
    .eq("id", user.id)
    .single();

  if (profErr) throw profErr;

  return {
    userId: user.id,
    role: profile.role,
    branchId: profile.branch_id,
  };
}
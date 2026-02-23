import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function getBearer(req: Request) {
  const h = req.headers.get("authorization") || "";
  if (!h.toLowerCase().startsWith("bearer ")) return null;
  return h.slice(7).trim();
}

export async function POST(req: Request) {
  try {
    const token = getBearer(req);
    if (!token) return NextResponse.json({ error: "Missing auth token" }, { status: 401 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return NextResponse.json({ error: "Missing public env vars" }, { status: 500 });

    // validate caller (owner) via token
    const viewer = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await viewer.auth.getUser();
    if (userErr || !userData?.user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    const callerId = userData.user.id;

    // verify caller is owner
    const { data: prof, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("user_id", callerId)
      .maybeSingle();

    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
    if (!prof || prof.role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const mode = body?.mode as "cashier" | "owner";
    const newPassword = body?.newPassword as string;

    if (!mode || !newPassword) {
      return NextResponse.json({ error: "Missing mode or newPassword" }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    let targetUserId = callerId; // default: reset owner (self)
    if (mode === "cashier") {
      const { data: s, error: sErr } = await supabaseAdmin
        .from("app_settings")
        .select("value")
        .eq("key", "cashier_user_id")
        .maybeSingle();

      if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
      if (!s?.value) return NextResponse.json({ error: "cashier_user_id not set in app_settings" }, { status: 500 });

      targetUserId = s.value;
    }

    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
      password: newPassword,
    });

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
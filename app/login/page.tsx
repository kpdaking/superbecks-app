"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { useRouter } from "next/navigation";




export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    setLoading(true);
    setMsg("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    const { data: authData2 } = await supabase.auth.getUser();
    const user = authData2.user;

    if (!user) {
     router.push("/login");
    return;
    }

    const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
     .single();

    if (prof?.role === "owner") {
    router.push("/owner");
    } else {
    router.push("/cashier");
    }

     };

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 420 }}>
      <h1>Superbecks Login</h1>
      <p style={{ color: "#555" }}>Use the cashier account (e.g. s1.cashier@superbecks.local)</p>

      <div style={{ display: "grid", gap: 10 }}>
        <input
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: 12, borderRadius: 10, border: "1px solid #ccc" }}
        />
        <input
          placeholder="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ padding: 12, borderRadius: 10, border: "1px solid #ccc" }}
        />
        <button
          onClick={signIn}
          disabled={loading}
          style={{
            padding: 12,
            borderRadius: 12,
            border: "1px solid #000",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          {loading ? "Signing in..." : "SIGN IN"}
        </button>

        <button
            onClick={async () => {
            await supabase.auth.signOut();
            alert("Logged out");
          }}
        style={{
            padding: 12,
            borderRadius: 12,
            border: "1px solid #ccc",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
        LOG OUT
        </button>


        {msg ? <p style={{ color: "red" }}>Error: {msg}</p> : null}
      </div>
    </div>
  );
}

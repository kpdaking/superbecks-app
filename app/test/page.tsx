"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

type MenuItem = {
  name: string;
  category: string | null;
  price: number;
  is_active: boolean;
};

export default function TestPage() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    const run = async () => {
      const { data, error } = await supabase
        .from("menu_items")
        .select("name, category, price, is_active")
        .eq("is_active", true)
        .order("category", { ascending: true })
        .order("name", { ascending: true });

      if (error) {
        setErrorMsg(error.message);
        return;
      }
      setMenu((data ?? []) as MenuItem[]);
    };

    run();
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Supabase Menu Test</h1>

      {errorMsg ? (
        <p style={{ color: "red" }}>Error: {errorMsg}</p>
      ) : (
        <pre>{JSON.stringify(menu, null, 2)}</pre>
      )}
    </div>
  );
}

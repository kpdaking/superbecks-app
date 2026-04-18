"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { getMyProfile } from "@/lib/getMyProfile";

type MenuRow = {
  id: string;
  name: string;
  category: string | null;
  price: number;
  is_active: boolean;
};

export default function MenuTab() {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rows, setRows] = useState<MenuRow[]>([]);

  async function loadMenu() {
    setLoading(true);
    setErrorMsg("");
    try {
      const prof = await getMyProfile();
      if (prof.role !== "owner") throw new Error("Not an owner account.");

      const { data, error } = await supabase
        .from("menu_items")
        .select("id,name,category,price,is_active")
        .order("category", { ascending: true })
        .order("name", { ascending: true });

      if (error) throw new Error(error.message);

      setRows((data ?? []) as MenuRow[]);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to load menu");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMenu();
  }, []);

  function updateRow(id: string, patch: Partial<MenuRow>) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  }

  async function saveRow(row: MenuRow) {
    setSavingId(row.id);
    setErrorMsg("");
    try {
      const { error } = await supabase
        .from("menu_items")
        .update({
          name: row.name,
          category: row.category,
          price: Number(row.price),
          is_active: row.is_active,
        })
        .eq("id", row.id);

      if (error) throw new Error(error.message);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to save menu item");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) return <div style={{ padding: 16 }}>Loading menu…</div>;

  return (
    <div style={{ padding: 16, display: "grid", gap: 16 }}>
      {errorMsg && (
        <div style={{ padding: 12, border: "1px solid #ff6b6b", borderRadius: 8 }}>
          {errorMsg}
        </div>
      )}

      <div style={{ border: "1px solid #333", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Menu Management</div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: 8, borderBottom: "1px solid #333" }}>Item</th>
                <th style={{ padding: 8, borderBottom: "1px solid #333" }}>Category</th>
                <th style={{ padding: 8, borderBottom: "1px solid #333" }}>Price</th>
                <th style={{ padding: 8, borderBottom: "1px solid #333" }}>Active</th>
                <th style={{ padding: 8, borderBottom: "1px solid #333" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: 8, borderBottom: "1px solid #222" }}>
                    <input
                      value={r.name}
                      onChange={(e) => updateRow(r.id, { name: e.target.value })}
                      style={{ width: "100%" }}
                    />
                  </td>

                  <td style={{ padding: 8, borderBottom: "1px solid #222" }}>
                    <select
                      className="posSelect"
                      value={r.category ?? ""}
                      onChange={(e) => updateRow(r.id, { category: e.target.value })}
                      style={{ width: "100%" }}
                    >
                      <option value="Meals">Meals</option>
                      <option value="Add-ons">Add-ons</option>
                      <option value="Drinks">Drinks</option>
                    </select>
                  </td>

                  <td style={{ padding: 8, borderBottom: "1px solid #222" }}>
                    <input
                      type="number"
                      value={r.price}
                      onChange={(e) => updateRow(r.id, { price: Number(e.target.value) })}
                      style={{ width: "100%" }}
                    />
                  </td>

                  <td style={{ padding: 8, borderBottom: "1px solid #222" }}>
                    <input
                      type="checkbox"
                      checked={r.is_active}
                      onChange={(e) => updateRow(r.id, { is_active: e.target.checked })}
                    />
                  </td>

                  <td style={{ padding: 8, borderBottom: "1px solid #222" }}>
                    <button onClick={() => saveRow(r)} disabled={savingId === r.id}>
                      {savingId === r.id ? "Saving..." : "Save"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
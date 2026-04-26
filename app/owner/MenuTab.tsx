"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("Meals");
  const [newPrice, setNewPrice] = useState<number>(150);
  const [newActive, setNewActive] = useState(true);
  const [adding, setAdding] = useState(false);
  const [originalRows, setOriginalRows] = useState<MenuRow[]>([]);
  const [savingAll, setSavingAll] = useState(false);

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


        const loaded = (data ?? []) as MenuRow[];
        setRows(loaded);
        setOriginalRows(loaded);

      
      
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

const hasUnsavedChanges = useMemo(() => {
  return JSON.stringify(rows) !== JSON.stringify(originalRows);
}, [rows, originalRows]);


async function saveAllRows() {
  if (!hasUnsavedChanges) return;

  const ok = window.confirm("Are you sure you want to save all menu changes?");
  if (!ok) return;

  setSavingAll(true);
  setErrorMsg("");

  try {
    for (const row of rows) {
      const original = originalRows.find((r) => r.id === row.id);
      if (!original) continue;

      const changed =
        row.name !== original.name ||
        row.category !== original.category ||
        Number(row.price) !== Number(original.price) ||
        row.is_active !== original.is_active;

      if (!changed) continue;

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
    }

    setOriginalRows(rows);
    alert("Menu changes saved ✅");
  } catch (e: any) {
    setErrorMsg(e?.message ?? "Failed to save menu changes");
  } finally {
    setSavingAll(false);
  }
}


 

    async function addMenuItem() {
        setErrorMsg("");

        if (!newName.trim()) {
            setErrorMsg("Item name is required");
            return;
        }

        if (!newPrice || Number(newPrice) <= 0) {
            setErrorMsg("Price must be greater than 0");
            return;
        }

        const ok = window.confirm(`Add new menu item "${newName}"?`);
        if (!ok) return;

        setAdding(true);
        try {
            const { error } = await supabase
            .from("menu_items")
            .insert({
                name: newName.trim(),
                category: newCategory,
                price: Number(newPrice),
                is_active: newActive,
            });

            if (error) throw new Error(error.message);

            setNewName("");
            setNewCategory("Meals");
            setNewPrice(150);
            setNewActive(true);

            await loadMenu();
        } catch (e: any) {
            setErrorMsg(e?.message ?? "Failed to add menu item");
        } finally {
            setAdding(false);
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

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontWeight: 700 }}>Menu Management</div>

                <button
                  onClick={saveAllRows}
                  disabled={!hasUnsavedChanges || savingAll}
                  className={hasUnsavedChanges ? "menuSaveBtn menuSaveBtnHot" : "menuSaveBtn"}
                >
                  {savingAll ? "Saving..." : "Save All Changes"}
                </button>
              </div>
        
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "2fr 1fr 1fr auto auto",
                    gap: 10,
                    marginBottom: 16,
                    alignItems: "end",
                }}
                >
                <div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>New Item Name</div>
                    <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Enter new menu item"
                    style={{ width: "100%" }}
                    />
                </div>

                <div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Category</div>
                    <select
                    className="posSelect"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    style={{ width: "100%" }}
                    >
                    <option value="Meals">Meals</option>
                    <option value="Add-ons">Add-ons</option>
                    <option value="Drinks">Drinks</option>
                    </select>
                </div>

                <div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Price</div>
                    <input
                    type="number"
                    value={newPrice}
                    onChange={(e) => setNewPrice(Number(e.target.value))}
                    style={{ width: "100%" }}
                    />
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <input
                    type="checkbox"
                    checked={newActive}
                    onChange={(e) => setNewActive(e.target.checked)}
                    />
                    <span>Active</span>
                </label>

                <button
                    onClick={addMenuItem}
                    disabled={adding}
                    className="menuSaveBtn"
                >
                    {adding ? "Adding..." : "+ Add Item"}
                </button>
                </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: 8, borderBottom: "1px solid #333" }}>Item</th>
                <th style={{ padding: 8, borderBottom: "1px solid #333" }}>Category</th>
                <th style={{ padding: 8, borderBottom: "1px solid #333" }}>Price</th>
                <th style={{ padding: 8, borderBottom: "1px solid #333" }}>Active</th>
                
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

                  
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
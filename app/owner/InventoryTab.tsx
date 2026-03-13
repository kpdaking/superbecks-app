"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase"; // adjust path
import { getMyProfile } from "@/lib/getMyProfile";

type Branch = { id: string; name: string; is_commissary: boolean };
type MenuItem = { id: string; name: string };

type OnhandRow = {
  branch_id: string;
  menu_item_id: string;
  on_hand: number;
  updated_at: string;
  branch_name?: string;
  item_name?: string;
};

type MoveRow = {
  id: string;
  created_at: string;
  move_type: string;
  from_branch_id: string | null;
  to_branch_id: string | null;
  menu_item_id: string;
  qty: number;
  reason: string | null;
  created_by: string | null;
  order_id: string | null;
  from_branch_name?: string;
  to_branch_name?: string;
  item_name?: string;
};




export default function InventoryTab() {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);

  const [onhand, setOnhand] = useState<OnhandRow[]>([]);
  const [moves, setMoves] = useState<MoveRow[]>([]);

  

  // forms
  const [moveType, setMoveType] = useState<"RECEIPT" | "TRANSFER" | "ADJUST">("RECEIPT");
  const [fromBranchId, setFromBranchId] = useState<string>("");
  const [toBranchId, setToBranchId] = useState<string>("");
  const [menuItemId, setMenuItemId] = useState<string>("");
  const [qty, setQty] = useState<number>(1);
  const [reason, setReason] = useState<string>("");

  const commissaryBranch = useMemo(() => branches.find((b) => b.is_commissary), [branches]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErrorMsg("");
      try {
        const prof = await getMyProfile();
        if (prof.role !== "owner") throw new Error("Not an owner account.");

        const [{ data: b, error: bErr }, { data: mi, error: miErr }] = await Promise.all([
          supabase.from("branches").select("id,name,is_commissary").order("name"),
          supabase.from("menu_items").select("id,name").eq("is_active", true).order("name"),
        ]);

        if (bErr) throw new Error(bErr.message);
        if (miErr) throw new Error(miErr.message);

        setBranches((b ?? []) as Branch[]);
        setMenu((mi ?? []) as MenuItem[]);

        // default selections
        const comm = (b ?? []).find((x: any) => x.is_commissary);
        if (comm) {
          setFromBranchId(comm.id);
          setToBranchId(comm.id);
        }
        if (mi?.[0]?.id) setMenuItemId(mi[0].id);

        await refreshAll(b ?? [], mi ?? []);
      } catch (e: any) {
        setErrorMsg(e?.message ?? "Failed to load inventory");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshAll(bList?: any[], miList?: any[]) {
    const b = (bList ?? branches) as Branch[];
    const mi = (miList ?? menu) as MenuItem[];

    const branchNameById = new Map(b.map((x) => [x.id, x.name]));
    const itemNameById = new Map(mi.map((x) => [x.id, x.name]));

    // onhand
    const { data: oh, error: ohErr } = await supabase
      .from("inventory_onhand")
      .select("branch_id,menu_item_id,on_hand,updated_at");
    if (ohErr) throw new Error(ohErr.message);

    const hydratedOnhand = (oh ?? []).map((r: any) => ({
      ...r,
      branch_name: branchNameById.get(r.branch_id) ?? r.branch_id,
      item_name: itemNameById.get(r.menu_item_id) ?? r.menu_item_id,
    })) as OnhandRow[];

    setOnhand(hydratedOnhand);

    // moves (latest 200)
    const { data: mv, error: mvErr } = await supabase
      .from("inventory_moves")
      .select("id,created_at,move_type,from_branch_id,to_branch_id,menu_item_id,qty,reason,created_by,order_id")
      .order("created_at", { ascending: false })
      .limit(200);
    if (mvErr) throw new Error(mvErr.message);

    const hydratedMoves = (mv ?? []).map((r: any) => ({
      ...r,
      from_branch_name: r.from_branch_id ? branchNameById.get(r.from_branch_id) ?? r.from_branch_id : "—",
      to_branch_name: r.to_branch_id ? branchNameById.get(r.to_branch_id) ?? r.to_branch_id : "—",
      item_name: itemNameById.get(r.menu_item_id) ?? r.menu_item_id,
    })) as MoveRow[];

    setMoves(hydratedMoves);
  }

  function numberOrZero(n: any) {
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
  }

  // Good defaults:
  // RECEIPT: to = commissary, from = null
  // TRANSFER: from = commissary, to = branch
  // ADJUST: to = branch (or commissary) with +/- qty (you decide convention)
  useEffect(() => {
    if (!commissaryBranch) return;

    if (moveType === "RECEIPT") {
      setFromBranchId("");
      setToBranchId(commissaryBranch.id);
      if (!reason) setReason("Supplier / Production");
    }
    if (moveType === "TRANSFER") {
      setFromBranchId(commissaryBranch.id);
      // keep toBranchId as selected, but if empty set to first non-commissary branch
      if (!toBranchId) {
        const firstStore = branches.find((b) => !b.is_commissary);
        if (firstStore) setToBranchId(firstStore.id);
      }
      if (!reason) setReason("Replenishment");
    }
    if (moveType === "ADJUST") {
      // adjustment applies to to_branch_id (destination), from null
      setFromBranchId("");
      if (!toBranchId) setToBranchId(commissaryBranch.id);
      if (!reason) setReason("Stock count adjustment");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveType, commissaryBranch?.id]);

  async function submitMove() {
    setErrorMsg("");
    try {
      const prof = await getMyProfile();
      if (prof.role !== "owner") throw new Error("Not an owner account");

      if (!menuItemId) throw new Error("Pick an item");
      
      if (!qty || Number(qty) === 0) {
       throw new Error("Qty must not be 0");
} 
      
      if (!qty || (moveType !== "ADJUST" && qty <= 0)) {
          throw new Error("Qty must be > 0");
}

      // Build payload based on type
      const payload: any = {
        move_type: moveType,
        menu_item_id: menuItemId,
        qty: Number(qty),
        reason: reason || null,
        created_by: prof.userId,
      };

      if (moveType === "RECEIPT") {
        if (!toBranchId) throw new Error("Pick destination (commissary)");
        payload.to_branch_id = toBranchId;
        payload.from_branch_id = null;
      }

      if (moveType === "TRANSFER") {
        if (!fromBranchId) throw new Error("Pick FROM branch (commissary)");
        if (!toBranchId) throw new Error("Pick TO branch");
        if (fromBranchId === toBranchId) throw new Error("FROM and TO must be different");
        payload.from_branch_id = fromBranchId;
        payload.to_branch_id = toBranchId;
      }

      if (moveType === "ADJUST") {
        if (!toBranchId) throw new Error("Pick which branch to adjust");
        if (!qty || qty === 0) throw new Error("Qty must not be 0");

        const absQty = Math.abs(Number(qty));

        // negative adjust = subtract from branch
        if (Number(qty) < 0) {
          payload.qty = absQty;
          payload.from_branch_id = toBranchId;
          payload.to_branch_id = null;
        } else {
          // positive adjust = add to branch
          payload.qty = absQty;
          payload.from_branch_id = null;
          payload.to_branch_id = toBranchId;
        }
      }

      const { error } = await supabase.from("inventory_moves").insert(payload);
      if (error) throw new Error(error.message);

      await refreshAll();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to post inventory move");
    }
  }

  // Group onhand by branch for nicer display
  const onhandByBranch = useMemo(() => {
    const map = new Map<string, OnhandRow[]>();
    onhand.forEach((r) => {
      const k = r.branch_name ?? r.branch_id;
      const arr = map.get(k) ?? [];
      arr.push(r);
      map.set(k, arr);
    });
    // sort items inside each branch
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => String(a.item_name).localeCompare(String(b.item_name)));
      map.set(k, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [onhand]);


    const LOW_STOCK_THRESHOLD = 10;
    const TARGET_STOCK = 30;

    const lowStockCommissary = useMemo(() => {
      return onhand
        .filter((r) => {
          const branch = branches.find((b) => b.id === r.branch_id);
          return branch?.is_commissary && Number(r.on_hand || 0) <= LOW_STOCK_THRESHOLD;
        })
        .sort((a, b) => Number(a.on_hand || 0) - Number(b.on_hand || 0));
    }, [onhand, branches]);

    const lowStockBranches = useMemo(() => {
      return onhand
        .filter((r) => {
          const branch = branches.find((b) => b.id === r.branch_id);
          return !branch?.is_commissary && Number(r.on_hand || 0) <= LOW_STOCK_THRESHOLD;
        })
        .sort((a, b) => Number(a.on_hand || 0) - Number(b.on_hand || 0));
    }, [onhand, branches]);

  const showMoves = false;



  if (loading) return <div style={{ padding: 16 }}>Loading inventory…</div>;

  return (
    <div style={{ padding: 16, display: "grid", gap: 16 }}>
      {errorMsg && (
        <div style={{ padding: 12, border: "1px solid #ff6b6b", borderRadius: 8 }}>
          {errorMsg}
        </div>
      )}

      {/* ACTIONS */}
      <div style={{ border: "1px solid #333", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Inventory Actions</div>

        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Type</div>
            <select
                className="posSelect"
                value={moveType}
                onChange={(e) => setMoveType(e.target.value as any)}
                style={{ width: "100%" }}
              >
              <option value="RECEIPT">RECEIPT (Add to Commissary)</option>
              <option value="TRANSFER">TRANSFER (Commissary → Branch)</option>
              <option value="ADJUST">ADJUST (Manual +/-)</option>
            </select>
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Item</div>
            <select
                    className="posSelect"
                    value={menuItemId}
                    onChange={(e) => setMenuItemId(e.target.value)}
                    style={{ width: "100%" }}
                  >
              {menu.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Qty</div>
            <input
              type="number"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              style={{ width: "100%" }}
            />
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
              For ADJUST: you can use negative qty to subtract.
            </div>
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>From</div>
            <select
                  className="posSelect"
                  value={fromBranchId}
                  onChange={(e) => setFromBranchId(e.target.value)}
                  style={{ width: "100%" }}
                >
              <option value="">—</option>
              {branches
                  .filter((b) => !toBranchId || b.id !== toBranchId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.is_commissary ? " (Commissary)" : ""}
                    </option>
              ))}
            </select>
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>To</div>
            <select
                  className="posSelect"
                  value={toBranchId}
                  onChange={(e) => setToBranchId(e.target.value)}
                  style={{ width: "100%" }}
                >
              <option value="">—</option>
               {branches
                .filter((b) => !fromBranchId || b.id !== fromBranchId)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.is_commissary ? " (Commissary)" : ""}
                  </option>
              ))}
            </select>
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Reason</div>
            <input value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: "100%" }} />
          </label>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <button onClick={submitMove}>Save Move</button>
          <button onClick={() => refreshAll()}>Refresh</button>
        </div>
      </div>

        {/* LOW STOCK ALERTS */}
        <div style={{ border: "1px solid #333", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Low Stock Alerts</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {/* Commissary */}
            <div>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Commissary</div>
              {lowStockCommissary.length === 0 ? (
                <div style={{ color: "#888" }}>No low-stock commissary items.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {lowStockCommissary.map((r) => (
                    <div
                      key={`comm-${r.branch_id}-${r.menu_item_id}`}
                      style={{
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 12,
                        padding: 10,
                        display: "flex",
                        justifyContent: "space-between",
                        background: "rgba(255, 77, 79, 0.08)",
                      }}
                    >
                      <span>{r.item_name}</span>
                      <strong>{Number(r.on_hand || 0)} left</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Branches */}
            <div>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Branches</div>
              {lowStockBranches.length === 0 ? (
                <div style={{ color: "#888" }}>No low-stock branch items.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {lowStockBranches.map((r) => (
                    <div
                      key={`branch-${r.branch_id}-${r.menu_item_id}`}
                      style={{
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 12,
                        padding: 10,
                        display: "flex",
                        justifyContent: "space-between",
                        background: "rgba(255, 179, 0, 0.08)",
                      }}
                    >
                      <div>
                        <div>{r.item_name}</div>
                        <div style={{ fontSize: 12, color: "#bbb" }}>{r.branch_name}</div>
                      </div>

                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 900 }}>{Number(r.on_hand || 0)} left</div>
                        <div style={{ fontSize: 12, color: "#bbb" }}>
                          Suggest +{Math.max(TARGET_STOCK - Number(r.on_hand || 0), 0)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

      {/* CURRENT STOCK */}
      <div style={{ border: "1px solid #333", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Current Stock (inventory_onhand)</div>

        {onhandByBranch.map(([branchName, rows]) => (
          <div key={branchName} style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{branchName}</div>
            <div style={{ display: "grid", gap: 6 }}>
              {rows.map((r) => {
                  const stock = Number(r.on_hand || 0);
                  const stockColor =
                    stock <= 10 ? "#ff8a8a" :
                    stock <= 20 ? "#ffd166" :
                    "#fff";

                  return (
                    <div
                      key={`${r.branch_id}-${r.menu_item_id}`}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        borderBottom: "1px dashed #333",
                        paddingBottom: 4,
                      }}
                    >
                      <span>{r.item_name}</span>
                      <span style={{ fontWeight: 700, color: stockColor }}>{stock}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>

   

    
      {/* MOVEMENTS */}
     {showMoves && (
          <div style={{ border: "1px solid #333", borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Movements (inventory_moves) — latest 200</div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th style={{ borderBottom: "1px solid #333", padding: 6 }}>Time</th>
                    <th style={{ borderBottom: "1px solid #333", padding: 6 }}>Type</th>
                    <th style={{ borderBottom: "1px solid #333", padding: 6 }}>From</th>
                    <th style={{ borderBottom: "1px solid #333", padding: 6 }}>To</th>
                    <th style={{ borderBottom: "1px solid #333", padding: 6 }}>Item</th>
                    <th style={{ borderBottom: "1px solid #333", padding: 6 }}>Qty</th>
                    <th style={{ borderBottom: "1px solid #333", padding: 6 }}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map((m) => (
                    <tr key={m.id}>
                      <td style={{ borderBottom: "1px solid #222", padding: 6 }}>
                        {new Date(m.created_at).toLocaleString()}
                      </td>
                      <td style={{ borderBottom: "1px solid #222", padding: 6 }}>{m.move_type}</td>
                      <td style={{ borderBottom: "1px solid #222", padding: 6 }}>{m.from_branch_name}</td>
                      <td style={{ borderBottom: "1px solid #222", padding: 6 }}>{m.to_branch_name}</td>
                      <td style={{ borderBottom: "1px solid #222", padding: 6 }}>{m.item_name}</td>
                      <td style={{ borderBottom: "1px solid #222", padding: 6, fontWeight: 700 }}>{m.qty}</td>
                      <td style={{ borderBottom: "1px solid #222", padding: 6 }}>{m.reason ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
    </div> 
    
  );
}
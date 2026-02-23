"use client";


import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import "./ui.css";
import { confirmAndLogout } from "@/lib/logout";

type Branch = { id: string; name: string };

type Order = {
  id: string;
  branch_id: string;
  created_at: string;
  payment_type: "CASH" | "GCASH";
  total_amount: number;
  status?: string | null;
};

type Line = {
  order_id: string;
  menu_item_id: string;
  qty: number;
  line_total: number;
  menu_items?: { name: string };
};

async function getMyProfile() {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData.user) throw new Error("Login required");

  const { data: prof, error: profErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", authData.user.id)
    .single();

  if (profErr) throw new Error(profErr.message);
  return prof as { role: string };
}





/**
 * We treat UI dates as "Philippines time" (UTC+8), regardless of the PC timezone.
 * startDate: YYYY-MM-DD (inclusive)
 * endDate:   YYYY-MM-DD (inclusive) -> converted to exclusive end by adding +1 day at midnight PH
 */
function phDateRangeToUtcIso(startDate: string, endDateInclusive: string) {
  const offsetMin = 8 * 60;

  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDateInclusive.split("-").map(Number);

  // build PH midnight dates using UTC constructors (avoid local timezone effects)
  const startPhMs = Date.UTC(sy, sm - 1, sd, 0, 0, 0);
  const endPhMsInclusive = Date.UTC(ey, em - 1, ed, 0, 0, 0);

  // end exclusive = next day midnight (PH)
  const endPhExclusiveMs = endPhMsInclusive + 24 * 60 * 60 * 1000;

  // Convert PH time -> UTC time: UTC = PH - 8 hours
  const startUtcMs = startPhMs - offsetMin * 60 * 1000;
  const endUtcMs = endPhExclusiveMs - offsetMin * 60 * 1000;

  return {
    startUtc: new Date(startUtcMs).toISOString(),
    endUtc: new Date(endUtcMs).toISOString(),
  };
}

// Returns YYYY-MM-DD for "today" in PH time (UTC+8)
function phTodayYMD() {
  const now = new Date();
  const nowUtcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const ph = new Date(nowUtcMs + 8 * 60 * 60000);
  const y = ph.getUTCFullYear();
  const m = String(ph.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ph.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function phStartOfWeekYMD() {
  // Week starts Monday
  const now = new Date();
  const nowUtcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const ph = new Date(nowUtcMs + 8 * 60 * 60000);

  const day = ph.getUTCDay(); // 0=Sun ... 6=Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(ph.getUTCFullYear(), ph.getUTCMonth(), ph.getUTCDate() + mondayOffset));
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const d = String(monday.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function phStartOfMonthYMD() {
  const today = phTodayYMD();
  const [y, m] = today.split("-");
  return `${y}-${m}-01`;
}

function fmtMoney(n: number) {
  return `₱${Number(n || 0).toFixed(2)}`;
}

function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeCsv(v: any) {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export default function OwnerDashboard() {
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(true);
  

  type ReplaceLine = {
    id: string; // local id (menu_item_id)
    menu_item_id: string;
    name: string;
    unit_price: number;
    qty: number;
  };

  const [replaceMode, setReplaceMode] = useState(false);
  const [replaceOldId, setReplaceOldId] = useState<string | null>(null);
  const [replaceNewId, setReplaceNewId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [replaceSaving, setReplaceSaving] = useState(false);
  const [replaceLines, setReplaceLines] = useState<ReplaceLine[]>([]);
  const [replaceBranchLabel, setReplaceBranchLabel] = useState<string>("");

  const [menuAll, setMenuAll] = useState<{ id: string; name: string; price: number }[]>([]);

  // Live Updates
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshEverySec, setRefreshEverySec] = useState(1800);


  // branches cached
  const [branches, setBranches] = useState<Branch[]>([]);

  // main dashboard range (customizable)
  const [startDate, setStartDate] = useState(phTodayYMD());
  const [endDate, setEndDate] = useState(phTodayYMD());

  // main range data
  const [orders, setOrders] = useState<Order[]>([]);
  const [lines, setLines] = useState<Line[]>([]);

  // summaries
  const [sumToday, setSumToday] = useState<{ total: number; count: number }>({ total: 0, count: 0 });
  const [sumWtd, setSumWtd] = useState<{ total: number; count: number }>({ total: 0, count: 0 });
  const [sumMtd, setSumMtd] = useState<{ total: number; count: number }>({ total: 0, count: 0 });

  // drilldown
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const branchNameById = useMemo(() => {
    const m = new Map<string, string>();
    branches.forEach((b) => m.set(b.id, b.name));
    return m;
  }, [branches]);


  // --- Password reset UI state (Owner only) ---
  const [pwCashier, setPwCashier] = useState("");
  const [pwOwner, setPwOwner] = useState("");
  const [pwMsg, setPwMsg] = useState<string>("");
  const [pwSaving, setPwSaving] = useState(false);

  async function resetPassword(mode: "cashier" | "owner", newPassword: string) {
    // confirm
    const ok = window.confirm(
      mode === "cashier"
        ? "Reset CASHIER password? Cashier will need to log in again."
        : "Change OWNER password (your account)? You may need to log in again."
    );
    if (!ok) return;

    setPwMsg("");
    setPwSaving(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Not logged in");

      const res = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ mode, newPassword }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Reset failed");

      setPwMsg(mode === "cashier" ? "✅ Cashier password updated." : "✅ Owner password updated.");

      // clear inputs
      if (mode === "cashier") setPwCashier("");
      if (mode === "owner") setPwOwner("");
    } catch (e: any) {
      setPwMsg(`❌ ${e?.message ?? "Unknown error"}`);
    } finally {
      setPwSaving(false);
    }
  }






  const paymentSplit = useMemo(() => {
    let cash = 0,
      gcash = 0;
    for (const o of orders) {
      if (o.payment_type === "CASH") cash += Number(o.total_amount || 0);
      else if (o.payment_type === "GCASH") gcash += Number(o.total_amount || 0);
    }
    return { cash, gcash };
  }, [orders]);

  const totalSales = useMemo(() => orders.reduce((s, o) => s + Number(o.total_amount || 0), 0), [orders]);

  const salesByBranch = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const o of orders) {
      const cur = map.get(o.branch_id) ?? { total: 0, count: 0 };
      cur.total += Number(o.total_amount || 0);
      cur.count += 1;
      map.set(o.branch_id, cur);
    }
    return Array.from(map.entries())
      .map(([branch_id, v]) => ({
        branch_id,
        total: v.total,
        count: v.count,
        name: branchNameById.get(branch_id) ?? branch_id,
      }))
      .sort((a, b) => b.total - a.total);
  }, [orders, branchNameById]);

  const topItems = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; amount: number }>();
    for (const l of lines) {
      const name = l.menu_items?.name ?? "Unknown";
      const key = l.menu_item_id;
      const cur = map.get(key) ?? { name, qty: 0, amount: 0 };
      cur.qty += Number(l.qty || 0);
      cur.amount += Number(l.line_total || 0);
      map.set(key, cur);
    }
    return Array.from(map.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);
  }, [lines]);

  const filteredOrders = useMemo(() => {
    if (!selectedBranchId) return orders;
    return orders.filter((o) => o.branch_id === selectedBranchId).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [orders, selectedBranchId]);

  const orderLinesForSelectedOrder = useMemo(() => {
    if (!selectedOrderId) return [];
    return lines.filter((l) => l.order_id === selectedOrderId);
  }, [lines, selectedOrderId]);

  async function loadBranchesOnce() {
    if (branches.length > 0) return;

    const { data: b, error: bErr } = await supabase.from("branches").select("id,name").order("name", { ascending: true });
    if (bErr) throw new Error(bErr.message);
    setBranches((b ?? []) as Branch[]);
  }

  async function fetchOrdersOnly(startYmd: string, endYmd: string) {
    const { startUtc, endUtc } = phDateRangeToUtcIso(startYmd, endYmd);

    const { data: o, error: oErr } = await supabase
      .from("orders")
      .select("id,branch_id,created_at,payment_type,total_amount,status")
      .gte("created_at", startUtc)
      .lt("created_at", endUtc);

    if (oErr) throw new Error(oErr.message);
    const ord = (o ?? []) as Order[];

    const total = ord.reduce((s, x) => s + Number(x.total_amount || 0), 0);
    return { total, count: ord.length };
  }

  async function loadSummaries() {
    const today = phTodayYMD();
    const wtdStart = phStartOfWeekYMD();
    const mtdStart = phStartOfMonthYMD();

    const [t, w, m] = await Promise.all([
      fetchOrdersOnly(today, today),
      fetchOrdersOnly(wtdStart, today),
      fetchOrdersOnly(mtdStart, today),
    ]);

    setSumToday(t);
    setSumWtd(w);
    setSumMtd(m);
  }

  async function loadMainRange(startYmd: string, endYmd: string) {
    const { startUtc, endUtc } = phDateRangeToUtcIso(startYmd, endYmd);

    // orders
    const { data: o, error: oErr } = await supabase
      .from("orders")
      .select("id,branch_id,created_at,payment_type,total_amount,status")
      .gte("created_at", startUtc)
      .lt("created_at", endUtc);

    if (oErr) throw new Error(oErr.message);
    const ord = (o ?? []) as Order[];
    setOrders(ord);

    // lines (no embedded join)
    const orderIds = ord.map((x) => x.id);
    if (orderIds.length === 0) {
      setLines([]);
      return;
    }

    const { data: l, error: lErr } = await supabase
      .from("order_lines")
      .select("order_id,menu_item_id,qty,line_total")
      .in("order_id", orderIds);

    if (lErr) throw new Error(lErr.message);
    const rawLines = (l ?? []) as Line[];

    // hydrate names
    const itemIds = Array.from(new Set(rawLines.map((x) => x.menu_item_id)));
    const nameById = new Map<string, string>();

    if (itemIds.length > 0) {
      const { data: items, error: itemsErr } = await supabase.from("menu_items").select("id,name").in("id", itemIds);
      if (itemsErr) throw new Error(itemsErr.message);
      (items ?? []).forEach((it: any) => nameById.set(it.id, it.name));
    }

    const hydrated = rawLines.map((x) => ({
      ...x,
      menu_items: { name: nameById.get(x.menu_item_id) ?? "Unknown" },
    }));

    setLines(hydrated);
  }

  async function refreshAll() {
    setLoading(true);
    setErrorMsg("");

    try {
      const prof = await getMyProfile();
      if (prof.role !== "owner") {
        setErrorMsg("Not an owner account. Please login with owner.");
        setLoading(false);
        return;
      }

      await loadBranchesOnce();
      await Promise.all([loadSummaries(), loadMainRange(startDate, endDate)]);
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

 async function startVoidAndReplace(oldOrderId: string) {
  const ok = window.confirm("Start VOID + REPLACE for this order?");
  if (!ok) return;

  setReplaceSaving(true);
  try {
    // old order
    const { data: old, error: e1 } = await supabase
      .from("orders")
      .select("id, branch_id, payment_type, total_amount")
      .eq("id", oldOrderId)
      .single();
    if (e1) throw new Error(e1.message);

    // old lines + item names
    const { data: lines, error: e2 } = await supabase
      .from("order_lines")
      .select("menu_item_id, qty, unit_price, line_total, menu_items(name)")
      .eq("order_id", oldOrderId);
    if (e2) throw new Error(e2.message);

    // create new order (draft)
    const { data: newOrder, error: e3 } = await supabase
      .from("orders")
      .insert({
        branch_id: old.branch_id,
        payment_type: old.payment_type,
        total_amount: old.total_amount,
        status: "DRAFT",
        replaces: oldOrderId,
      })
      .select("id")
      .single();
    if (e3) throw new Error(e3.message);

    // copy lines to new order
    const newLinesDb = (lines ?? []).map((l: any) => ({
      order_id: newOrder.id,
      menu_item_id: l.menu_item_id,
      qty: l.qty,
      unit_price: l.unit_price,
      line_total: l.line_total,
    }));

    if (newLinesDb.length > 0) {
      const { error: e4 } = await supabase.from("order_lines").insert(newLinesDb);
      if (e4) throw new Error(e4.message);
    }

    // editor state (client-side)
    const editorLines: ReplaceLine[] = (lines ?? []).map((l: any) => ({
      id: l.menu_item_id,
      menu_item_id: l.menu_item_id,
      name: l.menu_items?.name ?? "Unknown",
      unit_price: Number(l.unit_price),
      qty: Number(l.qty),
    }));

    setReplaceMode(true);
    setReplaceOldId(oldOrderId);
    setReplaceNewId(newOrder.id);
    setReplaceLines(editorLines);
    setVoidReason("");

    // show branch label in editor
    setReplaceBranchLabel(branchNameById.get(old.branch_id) ?? String(old.branch_id));
  } catch (err: any) {
    alert(err?.message ?? "Failed to start replacement");
  } finally {
    setReplaceSaving(false);
  }
}


function repInc(menuItemId: string) {
  setReplaceLines((prev) =>
    prev.map((l) => (l.menu_item_id === menuItemId ? { ...l, qty: l.qty + 1 } : l))
  );
}

function repDec(menuItemId: string) {
  setReplaceLines((prev) =>
    prev
      .map((l) => (l.menu_item_id === menuItemId ? { ...l, qty: Math.max(1, l.qty - 1) } : l))
  );
}

function repRemove(menuItemId: string) {
  setReplaceLines((prev) => prev.filter((l) => l.menu_item_id !== menuItemId));
}

function repAdd(menuItemId: string) {
  const it = menuAll.find((m) => m.id === menuItemId);
  if (!it) return;

  setReplaceLines((prev) => {
    const existing = prev.find((l) => l.menu_item_id === menuItemId);
    if (existing) return prev.map((l) => (l.menu_item_id === menuItemId ? { ...l, qty: l.qty + 1 } : l));
    return [
      ...prev,
      { id: it.id, menu_item_id: it.id, name: it.name, unit_price: Number(it.price), qty: 1 },
    ];
  });
}

const replaceTotal = replaceLines.reduce((sum, l) => sum + l.unit_price * l.qty, 0);

async function saveReplacementDraft() {
  if (!replaceNewId) return;
  setReplaceSaving(true);
  try {
    // 1) delete existing lines for new order
    const { error: e1 } = await supabase.from("order_lines").delete().eq("order_id", replaceNewId);
    if (e1) throw new Error(e1.message);

    // 2) insert new lines
    const payload = replaceLines.map((l) => ({
      order_id: replaceNewId,
      menu_item_id: l.menu_item_id,
      qty: l.qty,
      unit_price: l.unit_price,
      line_total: l.unit_price * l.qty,
    }));

    if (payload.length > 0) {
      const { error: e2 } = await supabase.from("order_lines").insert(payload);
      if (e2) throw new Error(e2.message);
    }

    // 3) update order total
    const { error: e3 } = await supabase
      .from("orders")
      .update({ total_amount: replaceTotal })
      .eq("id", replaceNewId);
    if (e3) throw new Error(e3.message);

    alert("✅ Draft saved.");
  } catch (err: any) {
    alert(err?.message ?? "Save failed");
  } finally {
    setReplaceSaving(false);
  }
}

async function finalizeReplacement() {
  if (!replaceOldId || !replaceNewId) return;

  if (voidReason.trim().length < 3) {
    alert("Please enter a void reason (at least 3 characters).");
    return;
  }
  if (replaceLines.length === 0) {
    alert("Replacement cannot be empty. Add at least 1 item.");
    return;
  }

  const ok = window.confirm("Finalize replacement? This will VOID the old order and mark the new one as PAID.");
  if (!ok) return;

  setReplaceSaving(true);
  try {
    const { data: sess } = await supabase.auth.getSession();
    const ownerId = sess.session?.user?.id;
    if (!ownerId) throw new Error("Login required");

    // Always save draft before finalizing
    await saveReplacementDraft();

    // 1) new order -> PAID
    const { error: e1 } = await supabase
      .from("orders")
      .update({ status: "PAID" })
      .eq("id", replaceNewId);
    if (e1) throw new Error(e1.message);

    // 2) old order -> VOIDED
    const { error: e2 } = await supabase
      .from("orders")
      .update({
        status: "VOIDED",
        voided_at: new Date().toISOString(),
        voided_by: ownerId,
        void_reason: voidReason.trim(),
        replaced_by: replaceNewId,
      })
      .eq("id", replaceOldId);
    if (e2) throw new Error(e2.message);

    alert("✅ Replacement finalized.");

    // exit replace mode
    setReplaceMode(false);
    setReplaceOldId(null);
    setReplaceNewId(null);
    setReplaceLines([]);
    setVoidReason("");

    await refreshAll();
  } catch (err: any) {
    alert(err?.message ?? "Finalize failed");
  } finally {
    setReplaceSaving(false);
  }
}


function cancelReplacement() {
  const ok = window.confirm("Discard replacement editor? (Draft order will remain as DRAFT unless you delete it manually.)");
  if (!ok) return;

  setReplaceMode(false);
  setReplaceOldId(null);
  setReplaceNewId(null);
  setReplaceLines([]);
  setVoidReason("");
}


  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
  if (!autoRefresh) return;

  const id = setInterval(() => {
    // refresh without changing filters
    refreshAll();
  }, refreshEverySec * 1000);

  return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [autoRefresh, refreshEverySec]);


  function setPresetToday() {
    const t = phTodayYMD();
    setStartDate(t);
    setEndDate(t);
    setSelectedBranchId(null);
    setSelectedOrderId(null);
  }

  function setPresetWtd() {
    const end = phTodayYMD();
    setStartDate(phStartOfWeekYMD());
    setEndDate(end);
    setSelectedBranchId(null);
    setSelectedOrderId(null);
  }

  function setPresetMtd() {
    const end = phTodayYMD();
    setStartDate(phStartOfMonthYMD());
    setEndDate(end);
    setSelectedBranchId(null);
    setSelectedOrderId(null);
  }

  async function applyRange() {
    setSelectedBranchId(null);
    setSelectedOrderId(null);
    setLoading(true);
    setErrorMsg("");

    try {
      const prof = await getMyProfile();
      if (prof.role !== "owner") {
        setErrorMsg("Not an owner account. Please login with owner.");
        setLoading(false);
        return;
      }

      await loadBranchesOnce();
      await loadMainRange(startDate, endDate);
      // summaries are "always today/wtd/mtd"; keep them fresh too
      await loadSummaries();
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed to load range");
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    // CSV rows: one row per order line (easy to audit)
    const linesByOrder = new Map<string, Line[]>();
    for (const l of lines) {
      const arr = linesByOrder.get(l.order_id) ?? [];
      arr.push(l);
      linesByOrder.set(l.order_id, arr);
    }

    const header = [

      "order_created_at",
      "branch",
      "payment_type",
      "order_total",
      "item_name",
      "qty",
      "line_total",
    ];

    const rows: string[] = [];
    rows.push(header.join(","));

    const ordersSorted = [...orders].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    for (const o of ordersSorted) {
      const branch = branchNameById.get(o.branch_id) ?? o.branch_id;
      const ol = linesByOrder.get(o.id) ?? [];

      if (ol.length === 0) {
        rows.push(
          [
            escapeCsv(o.id),
            escapeCsv(o.created_at),
            escapeCsv(branch),
            escapeCsv(o.payment_type),
            escapeCsv(Number(o.total_amount || 0).toFixed(2)),
            "",
            "",
            "",
          ].join(",")
        );
      } else {
        for (const l of ol) {
          rows.push(
            [
              escapeCsv(o.id),
              escapeCsv(o.created_at),
              escapeCsv(branch),
              escapeCsv(o.payment_type),
              escapeCsv(Number(o.total_amount || 0).toFixed(2)),
              escapeCsv(l.menu_items?.name ?? "Unknown"),
              escapeCsv(l.qty),
              escapeCsv(Number(l.line_total || 0).toFixed(2)),
            ].join(",")
          );
        }
      }
    }

    const fn = `superbecks_sales_${startDate}_to_${endDate}.csv`;
    downloadTextFile(fn, rows.join("\n"));
  }

  if (loading) {
    return <div style={{ padding: 16, fontFamily: "system-ui" }}>Loading owner dashboard…</div>;
  }

 return (
  <div className="page">
    {/* Top Bar */}
    <div className="topBar">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <img
          src="/superbecks-logo.png"
          alt="Superbecks"
          style={{ height: 44, width: "auto", borderRadius: 10 }}
        />
        <div className="logoText">SUPERBECKS</div>
      </div>

      <div className="pill">Range: {startDate} → {endDate}</div>

      {/* RIGHT SIDE (Logout Button) */}
    <button
      onClick={() => confirmAndLogout("Log out of Owner Dashboard?")}
      style={{
      padding: "8px 14px",
      borderRadius: 999,
      border: "1px solid rgba(255,255,255,0.3)",
      background: "rgba(0,0,0,0.25)",
      color: "#fff",
      fontWeight: 800,
      cursor: "pointer"
    }}
  >
    Logout
  </button>
    </div>

    {/* Hero / Title */}
    <div className="hero">
      <h1 className="heroTitle">Superbecks Control Dashboard</h1>

      <div style={{ marginTop: 6, color: "rgba(255,255,255,0.75)", fontWeight: 700 }}>
        Range (PH time): <b>{startDate}</b> to <b>{endDate}</b>
      </div>

      {errorMsg ? (
        <div style={{ marginTop: 10, padding: 12, borderRadius: 14, border: "1px solid rgba(255,0,0,0.45)" }}>
          <b>Error:</b> {errorMsg} — try <a href="/login">/login</a>
        </div>
      ) : null}
    </div>

    {/* Body */}
    {!errorMsg ? (
      <>
        {/* Controls */}
        <div className="section">
          <div className="sectionHeader">CONTROLS</div>

          <div style={{ padding: 14, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <button onClick={setPresetToday} style={btnStyle()}>
                Today
              </button>
              <button onClick={setPresetWtd} style={btnStyle()}>
                Week-to-date
              </button>
              <button onClick={setPresetMtd} style={btnStyle()}>
                Month-to-date
              </button>

              <div style={{ width: 16 }} />

              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ color: "#bbb" }}>From</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  style={inputStyle()}
                />
              </label>

              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ color: "#bbb" }}>To</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={inputStyle()}
                />
              </label>

              <button onClick={applyRange} style={btnStyle(true)}>
                Apply
              </button>

              <button onClick={refreshAll} style={btnStyle()}>
                Refresh
              </button>

              <button onClick={exportCsv} style={btnStyle()}>
                Export CSV
              </button>
            </div>

            {/* Summary cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <div style={cardStyle()}>
                <div style={{ color: "#888" }}>Today</div>
                <div style={{ fontSize: 22, fontWeight: 900 }}>{fmtMoney(sumToday.total)}</div>
                <div style={{ color: "#888" }}>{sumToday.count} orders</div>
              </div>

              <div style={cardStyle()}>
                <div style={{ color: "#888" }}>Week-to-date</div>
                <div style={{ fontSize: 22, fontWeight: 900 }}>{fmtMoney(sumWtd.total)}</div>
                <div style={{ color: "#888" }}>{sumWtd.count} orders</div>
              </div>

              <div style={cardStyle()}>
                <div style={{ color: "#888" }}>Month-to-date</div>
                <div style={{ fontSize: 22, fontWeight: 900 }}>{fmtMoney(sumMtd.total)}</div>
                <div style={{ color: "#888" }}>{sumMtd.count} orders</div>
              </div>
    
            </div>
          </div>
        </div>

          {/* Owner admin: Password reset */}
          <div style={{ marginTop: 12, borderTop: "1px solid rgba(255,255,255,0.10)", paddingTop: 12 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Admin • Password Reset</div>

            {pwMsg ? (
              <div style={{ marginBottom: 10, padding: 10, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }}>
                {pwMsg}
              </div>
            ) : null}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {/* Reset cashier */}
              <div style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: 12 }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>Reset Cashier Password</div>
                <input
                  type="password"
                  value={pwCashier}
                  onChange={(e) => setPwCashier(e.target.value)}
                  placeholder="New cashier password (min 8 chars)"
                  style={{
                    width: "100%",
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(0,0,0,0.35)",
                    color: "#fff",
                  }}
                />
                <button
                  disabled={pwSaving || pwCashier.length < 8}
                  onClick={() => resetPassword("cashier", pwCashier)}
                  style={{
                    marginTop: 10,
                    width: "100%",
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.25)",
                    fontWeight: 900,
                    opacity: pwSaving || pwCashier.length < 8 ? 0.6 : 1,
                    cursor: pwSaving || pwCashier.length < 8 ? "not-allowed" : "pointer",
                  }}
                >
                  {pwSaving ? "SAVING..." : "RESET CASHIER PASSWORD"}
                </button>
              </div>

              {/* Reset owner (self) */}
              <div style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: 12 }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>Change Owner Password</div>
                <input
                  type="password"
                  value={pwOwner}
                  onChange={(e) => setPwOwner(e.target.value)}
                  placeholder="New owner password (min 8 chars)"
                  style={{
                    width: "100%",
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(0,0,0,0.35)",
                    color: "#fff",
                  }}
                />
                <button
                  disabled={pwSaving || pwOwner.length < 8}
                  onClick={() => resetPassword("owner", pwOwner)}
                  style={{
                    marginTop: 10,
                    width: "100%",
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.25)",
                    fontWeight: 900,
                    opacity: pwSaving || pwOwner.length < 8 ? 0.6 : 1,
                    cursor: pwSaving || pwOwner.length < 8 ? "not-allowed" : "pointer",
                  }}
                >
                  {pwSaving ? "SAVING..." : "CHANGE OWNER PASSWORD"}
                </button>
              </div>
            </div>
          </div>

        

        {/* Main KPIs */}
        <div className="section" style={{ marginTop: 16 }}>
          <div className="sectionHeader">SUMMARY</div>

          <div style={{ padding: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <div style={cardStyle()}>
                <div style={{ color: "#888" }}>Total Sales (Selected Range)</div>
                <div style={{ fontSize: 26, fontWeight: 900 }}>{fmtMoney(totalSales)}</div>
                <div style={{ color: "#888" }}>{orders.length} orders</div>
              </div>

              <div style={cardStyle()}>
                <div style={{ color: "#888" }}>Cash</div>
                <div style={{ fontSize: 22, fontWeight: 900 }}>{fmtMoney(paymentSplit.cash)}</div>
              </div>

              <div style={cardStyle()}>
                <div style={{ color: "#888" }}>GCash</div>
                <div style={{ fontSize: 22, fontWeight: 900 }}>{fmtMoney(paymentSplit.gcash)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Branch + Top Items */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12, marginTop: 16 }}>
          <div className="section">
            <div className="sectionHeader">TODAY’S SALES</div>

            <div style={{ padding: 14 }}>
              <h2 style={{ marginTop: 0 }}>Sales by Branch (click to drill down)</h2>

              {salesByBranch.length === 0 ? (
                <div style={{ color: "#888" }}>No sales in this range.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {salesByBranch.map((x) => {
                    const selected = selectedBranchId === x.branch_id;
                    return (
                      <button
                        key={x.branch_id}
                        onClick={() => {
                          setSelectedOrderId(null);
                          setSelectedBranchId(selected ? null : x.branch_id);
                        }}
                        style={{
                          ...rowBtnStyle(),
                          borderColor: selected ? "#fff" : "#444",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                          <div>
                            <div style={{ fontWeight: 900 }}>{x.name}</div>
                            <div style={{ color: "#aaa", fontSize: 12 }}>{x.count} orders</div>
                          </div>
                          <div style={{ fontWeight: 900 }}>{fmtMoney(x.total)}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="section">
            <div className="sectionHeader">BEST SELLERS</div>

            <div style={{ padding: 14 }}>
              <h2 style={{ marginTop: 0 }}>Top Items (Selected Range)</h2>

              {topItems.length === 0 ? (
                <div style={{ color: "#888" }}>No items yet.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {topItems.map((x, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        border: "1px solid rgba(255,255,255,0.14)",
                        borderRadius: 14,
                        padding: 12,
                        background: "rgba(255,255,255,0.06)",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 900 }}>{x.name}</div>
                        <div style={{ color: "#aaa", fontSize: 12 }}>Qty: {x.qty}</div>
                      </div>
                      <div style={{ fontWeight: 900 }}>{fmtMoney(x.amount)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Orders + Order Details */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12, marginTop: 16 }}>
          <div className="section">
            <div className="sectionHeader">ORDERS</div>

            <div style={{ padding: 14 }}>
              <h2 style={{ marginTop: 0 }}>
                Orders{" "}
                {selectedBranchId ? `— ${branchNameById.get(selectedBranchId) ?? selectedBranchId}` : "(All branches)"}
              </h2>

              {filteredOrders.length === 0 ? (
                <div style={{ color: "#888" }}>No orders.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {filteredOrders
                    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
                    .map((o) => {
                      const selected = selectedOrderId === o.id;
                      return (
                        <button
                          key={o.id}
                          onClick={() => setSelectedOrderId(selected ? null : o.id)}
                          style={{
                            ...rowBtnStyle(),
                            borderColor: selected ? "#fff" : "#444",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                            <div>
                              <div style={{ fontWeight: 900 }}>
                                {branchNameById.get(o.branch_id) ?? o.branch_id} • {o.payment_type}
                              </div>
                              <div style={{ color: "#aaa", fontSize: 12 }}>
                                {new Date(o.created_at).toLocaleString()} • {o.id.slice(0, 8)}
                              </div>
                            </div>
                            <div style={{ fontWeight: 900 }}>{fmtMoney(o.total_amount)}</div>
                          </div>
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          </div>

          <div className="section">
            <div className="sectionHeader">ORDER DETAILS</div>

            <div style={{ padding: 14 }}>
              <h2 style={{ marginTop: 0 }}>Order Details</h2>

              {!selectedOrderId ? (
                <div style={{ color: "#888" }}>Click an order to view its items.</div>
              ) : (
                <>
                  <div style={{ color: "#aaa", fontSize: 12, marginBottom: 8 }}>
                    Order ID: <span style={{ color: "#fff" }}>{selectedOrderId}</span>
                  </div>

                  <button
                    onClick={() => startVoidAndReplace(selectedOrderId)}
                    disabled={replaceSaving}
                    style={{
                      width: "100%",
                      marginBottom: 12,
                      padding: 10,
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.2)",
                      fontWeight: 900,
                      cursor: "pointer",
                      opacity: replaceSaving ? 0.6 : 1,
                      }}
                  >
                  VOID + REPLACE ORDER
                  </button>

                  {orderLinesForSelectedOrder.length === 0 ? (
                    <div style={{ color: "#888" }}>No lines found.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {orderLinesForSelectedOrder.map((l, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            border: "1px solid rgba(255,255,255,0.14)",
                            borderRadius: 14,
                            padding: 12,
                            background: "rgba(255,255,255,0.06)",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 900 }}>{l.menu_items?.name ?? "Unknown"}</div>
                            <div style={{ color: "#aaa", fontSize: 12 }}>Qty: {l.qty}</div>
                          </div>
                          <div style={{ fontWeight: 900 }}>{fmtMoney(l.line_total)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  
                  {replaceMode ? (
                    <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 12 }}>
                      <div style={{ fontWeight: 900, marginBottom: 6 }}>Replacement Editor</div>

                      <div style={{ display: "grid", gap: 8 }}>
                        {replaceLines.map((l) => (
                          <div key={l.menu_item_id}
                            style={{
                              border: "1px solid rgba(255,255,255,0.12)",
                              borderRadius: 12,
                              padding: 10,
                              display: "grid",
                              gridTemplateColumns: "1fr auto",
                              gap: 10,
                              alignItems: "center",
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 900 }}>{l.name}</div>
                              <div style={{ color: "#aaa", fontSize: 12 }}>
                                ₱{l.unit_price.toFixed(2)} × {l.qty} = ₱{(l.unit_price*l.qty).toFixed(2)}
                              </div>
                            </div>

                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={() => repDec(l.menu_item_id)}>−</button>
                              <button onClick={() => repInc(l.menu_item_id)}>+</button>
                              <button onClick={() => repRemove(l.menu_item_id)}>Remove</button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div style={{ marginTop: 10, fontWeight: 900 }}>
                        Total: ₱{replaceTotal.toFixed(2)}
                      </div>

                      <input
                        value={voidReason}
                        onChange={(e)=>setVoidReason(e.target.value)}
                        placeholder="Void reason"
                        style={{
                          width:"100%",
                          marginTop:10,
                          padding:10,
                          borderRadius:10
                        }}
                      />

                      <div style={{ display:"flex", gap:10, marginTop:10 }}>
                        <button onClick={saveReplacementDraft}>Save Draft</button>
                        <button onClick={finalizeReplacement}>Finalize Replacement</button>
                      </div>
                    </div>
                  ) : null}

                </>
              )}
            </div>
          </div>
        </div>
      </>
    ) : null}

    {/* ✅ THIS closing div is REQUIRED for <div className="page"> */}
  </div>
);

}

/* ---------- simple styles ---------- */

function btnStyle(primary?: boolean): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: primary ? "1px solid #fff" : "1px solid #444",
    background: primary ? "#111" : "transparent",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
  };
}

function inputStyle(): React.CSSProperties {
  return {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #444",
    background: "#111",
    color: "#fff",
  };
}

function cardStyle(): React.CSSProperties {
  return {
    border: "1px solid #444",
    borderRadius: 12,
    padding: 12,
    background: "transparent",
  };
}

function panelStyle(): React.CSSProperties {
  return {
    border: "1px solid #444",
    borderRadius: 12,
    padding: 12,
    background: "transparent",
  };
}

function rowBtnStyle(): React.CSSProperties {
  return {
    textAlign: "left",
    width: "100%",
    padding: 10,
    borderRadius: 12,
    border: "1px solid #444",
    background: "transparent",
    color: "#fff",
    cursor: "pointer",
  };
}


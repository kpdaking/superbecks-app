"use client";


import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import "./ui.css";

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


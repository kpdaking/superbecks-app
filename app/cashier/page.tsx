"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import styles from "./cashier.module.css";


type MenuItem = {
  id: string;
  name: string;
  category: string | null;
  price: number;
};

type CartLine = {
  id: string;
  name: string;
  price: number;
  qty: number;
};

async function getMyProfile() {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData.user) throw new Error("Login required");

  const { data: prof, error: profErr } = await supabase
    .from("profiles")
    .select("role, branch_id")
    .eq("user_id", authData.user.id)
    .single();

  if (profErr) throw new Error(profErr.message);
  return { userId: authData.user.id, role: prof.role as string, branchId: prof.branch_id as string | null };
}

export default function CashierPage() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payment, setPayment] = useState<"CASH" | "GCASH">("CASH");
  const [saving, setSaving] = useState(false);
  const [branchId, setBranchId] = useState<string | null>(null);

  // Load profile + menu
  useEffect(() => {
    (async () => {
      try {
        const p = await getMyProfile();
        if (p.role !== "cashier") {
          setErrorMsg("Not a cashier account.");
          return;
        }
        setBranchId(p.branchId);

        const { data, error } = await supabase
          .from("menu_items")
          .select("id,name,category,price")
          .eq("is_active", true)
          .order("category", { ascending: true })
          .order("name", { ascending: true });

        if (error) setErrorMsg(error.message);
        else setMenu((data ?? []) as MenuItem[]);
      } catch (e: any) {
        setErrorMsg(e?.message || "Login required");
      }
    })();
  }, []);

  const meals = useMemo(
    () => menu.filter((m) => (m.category ?? "").toLowerCase() === "meals"),
    [menu]
  );
  const addons = useMemo(
    () => menu.filter((m) => (m.category ?? "").toLowerCase() === "add-ons"),
    [menu]
  );

  const total = useMemo(() => cart.reduce((sum, l) => sum + l.price * l.qty, 0), [cart]);

  const addToCart = (item: MenuItem) => {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.id === item.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { id: item.id, name: item.name, price: item.price, qty: 1 }];
    });
  };

  const inc = (id: string) => setCart((prev) => prev.map((l) => (l.id === id ? { ...l, qty: l.qty + 1 } : l)));

  const dec = (id: string) =>
    setCart((prev) =>
      prev
        .map((l) => (l.id === id ? { ...l, qty: l.qty - 1 } : l))
        .filter((l) => l.qty > 0)
    );

  const clear = () => setCart([]);

  const placeOrder = async () => {
    if (cart.length === 0) return;
    if (!branchId) {
      alert("No branch assigned to this cashier.");
      return;
    }

    setSaving(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData.user;
      if (!user) throw new Error("Login required");

      const totalAmount = Number(total.toFixed(2));

      // Insert order header
      const { data: order, error: orderErr } = await supabase
        .from("orders")
        .insert({
          branch_id: branchId,
          created_by: user.id,
          payment_type: payment,
          status: "NEW",
          total_amount: totalAmount,
        })
        .select("id")
        .single();

      if (orderErr) throw new Error(orderErr.message);

      // Insert order lines
      const lines = cart.map((l) => ({
        order_id: order.id,
        menu_item_id: l.id,
        qty: l.qty,
        unit_price: Number(l.price.toFixed(2)),
        line_total: Number((l.price * l.qty).toFixed(2)),
      }));

      const { error: linesErr } = await supabase.from("order_lines").insert(lines);
      if (linesErr) throw new Error(linesErr.message);

      alert("Order saved ✅");
      clear();
    } catch (e: any) {
      alert("Failed to save order: " + (e?.message || e.toString()));
    } finally {
      setSaving(false);
    }
  };

  return (
  <div className={styles.page}>
    <div className={styles.topBar}>
      <div className={styles.brand}>
        <img className={styles.logo} src="/superbecks-logo.png" alt="Superbecks" />
        <div>SUPERBECKS</div>
      </div>

      <div className={styles.pill}>
        Branch: {branchId ? "Assigned" : "Not assigned"}
      </div>
    </div>

    <div className={styles.wrap}>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>CASHIER</div>

        <div className={styles.sectionBody}>
          <div className={styles.small} style={{ marginBottom: 10 }}>
            Tap meals/add-ons • Payment: Cash or GCash
          </div>

          {errorMsg ? (
            <div className={styles.error} style={{ marginBottom: 12 }}>
              <b>Error:</b> {errorMsg}{" "}
              {errorMsg.toLowerCase().includes("login") ? (
                <span>
                  — go to <a href="/login">/login</a>
                </span>
              ) : null}
            </div>
          ) : null}

          <div className={styles.grid2}>
            {/* Left: Menu */}
            <div className={styles.panelGrid}>
              <div className={styles.card}>
                <div style={{ fontWeight: 900, marginBottom: 10 }}>Meals</div>
                <div className={styles.menuGrid}>
                  {meals.map((m) => (
                    <button key={m.id} onClick={() => addToCart(m)} className={styles.itemBtn}>
                      {m.name}
                      <div className={styles.price}>₱{Number(m.price).toFixed(2)}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.card}>
                <div style={{ fontWeight: 900, marginBottom: 10 }}>Add-ons</div>
                <div className={styles.menuGrid}>
                  {addons.map((m) => (
                    <button key={m.id} onClick={() => addToCart(m)} className={styles.itemBtn}>
                      {m.name}
                      <div className={styles.price}>₱{Number(m.price).toFixed(2)}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: Cart */}
            <div className={styles.card}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Order Summary</div>
              <div className={styles.small} style={{ marginBottom: 8 }}>
                Branch: {branchId ? "Assigned" : "Not assigned"}
              </div>

              {cart.length === 0 ? (
                <p className={styles.small}>No items yet.</p>
              ) : (
                <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                  {cart.map((l) => (
                    <div
                      key={l.id}
                      className={styles.rowBtn}
                      style={{ cursor: "default" }}
                    >
                      <div className={styles.rowLine}>
                        <div>
                          <div style={{ fontWeight: 900 }}>{l.name}</div>
                          <div className={styles.small}>
                            ₱{Number(l.price).toFixed(2)} × {l.qty} = ₱{(l.price * l.qty).toFixed(2)}
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            onClick={() => dec(l.id)}
                            className={styles.pillBtn}
                            style={{ padding: "6px 10px" }}
                          >
                            −
                          </button>
                          <button
                            onClick={() => inc(l.id)}
                            className={styles.pillBtn}
                            style={{ padding: "6px 10px" }}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <hr style={{ margin: "12px 0", borderColor: "rgba(255,255,255,0.12)" }} />

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18 }}>
                <strong>Total</strong>
                <strong>₱{total.toFixed(2)}</strong>
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                <button
                  onClick={() => setPayment("CASH")}
                  className={`${styles.pillBtn} ${payment === "CASH" ? styles.pillBtnActive : ""}`}
                >
                  CASH
                </button>
                <button
                  onClick={() => setPayment("GCASH")}
                  className={`${styles.pillBtn} ${payment === "GCASH" ? styles.pillBtnActive : ""}`}
                >
                  GCASH
                </button>
              </div>

              <button
                disabled={cart.length === 0 || saving}
                onClick={placeOrder}
                className={styles.cta}
              >
                {saving ? "SAVING..." : "PLACE ORDER"}
              </button>

              <button
                disabled={cart.length === 0}
                onClick={clear}
                className={styles.clearBtn}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

}

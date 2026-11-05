// TenantScopeSelector — the top-bar scope control. Replaces the former visual-only "All Branches" chip with a real
// dropdown: "All Branches" (platform-wide, the default) plus every salon. Selecting one sets the shared scope, which
// re-scopes the Overview aggregate to that tenant. The tenant list reuses the existing lightweight tenants endpoint
// (hwApi.listTenants -> {id,name,code}[]), so there is no new backend. Lazy-loads on first open; closes on outside click.
import { useEffect, useRef, useState } from "react";
import { hwApi } from "../api/superAdminHardwarePackagesApi";
import { useScope } from "./ScopeContext";

type TenantOpt = { id: string; name: string; code: string | null };

const PIN = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 21s-6-5.686-6-10a6 6 0 0 1 12 0c0 4.314-6 10-6 10z" />
    <circle cx="12" cy="11" r="2" />
  </svg>
);
const CHEV = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

function optStyle(active: boolean): React.CSSProperties {
  return {
    all: "unset",
    display: "block",
    boxSizing: "border-box",
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 13,
    lineHeight: 1.3,
    color: "var(--ink,#2A2118)",
    background: active ? "var(--g1,#F6EFE2)" : "transparent",
    fontWeight: active ? 700 : 500,
  };
}

export function TenantScopeSelector() {
  const { tenantId, tenantName, setScope, clear } = useScope();
  const [open, setOpen] = useState(false);
  const [tenants, setTenants] = useState<TenantOpt[] | null>(null);
  const [err, setErr] = useState(false);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Lazy-load the salon list the first time the menu opens (reuses the existing tenants endpoint — no new backend).
  useEffect(() => {
    if (!open || tenants !== null) return;
    hwApi
      .listTenants()
      .then((t) => setTenants(t))
      .catch(() => {
        setErr(true);
        setTenants([]);
      });
  }, [open, tenants]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const list = (tenants ?? []).filter(
    (t) => !filter || t.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div
      className="branchsel !px-2 sm:!px-[12px] "
      ref={ref}
      style={{ position: "relative" }}
      title={
        tenantId ? `Scope: ${tenantName}` : "Scope: all branches (Super Admin)"
      }
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="gap-0.5 sm:gap-2"
        style={{
          all: "unset",
          display: "flex",
          alignItems: "center",
          width: "100%",
          cursor: "pointer",
        }}
      >
        {PIN}
        <div>
          <div className="bs-t hidden sm:flex">{tenantName || "All Branches"}</div>
          <div className="bs-s hidden sm:flex">{tenantId ? "Scoped view" : "Super Admin"}</div>
        </div>
        {CHEV}
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            minWidth: 248,
            maxHeight: 360,
            overflow: "auto",
            background: "#fff",
            border: "1px solid var(--line,#E7DFD3)",
            borderRadius: 12,
            boxShadow: "0 14px 32px rgba(42,33,24,.18)",
            zIndex: 60,
            padding: 6,
          }}
        >
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter salons…"
            autoFocus
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "7px 9px",
              marginBottom: 6,
              borderRadius: 8,
              border: "1px solid var(--line,#E7DFD3)",
              fontSize: 13,
            }}
          />
          <button
            type="button"
            onClick={() => {
              clear();
              setOpen(false);
            }}
            style={optStyle(!tenantId)}
          >
            All Branches <span style={{ opacity: 0.55 }}>· Platform-wide</span>
          </button>
          <div
            style={{
              height: 1,
              background: "var(--line,#E7DFD3)",
              margin: "6px 4px",
            }}
          />
          {tenants === null ? (
            <div style={{ padding: 8, opacity: 0.6, fontSize: 13 }}>
              Loading salons…
            </div>
          ) : err ? (
            <div style={{ padding: 8, opacity: 0.6, fontSize: 13 }}>
              Couldn't load salons
            </div>
          ) : list.length === 0 ? (
            <div style={{ padding: 8, opacity: 0.6, fontSize: 13 }}>
              No salons match
            </div>
          ) : (
            list.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setScope(t.id, t.name);
                  setOpen(false);
                }}
                style={optStyle(tenantId === t.id)}
              >
                {t.name}
                {t.code ? (
                  <span style={{ opacity: 0.5 }}> · {t.code}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

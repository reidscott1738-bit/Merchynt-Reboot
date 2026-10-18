"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export type HeatPoint = { lat: number; lng: number; status: "found" | "not_found" | "failed"; rank: number | null; change?: "improved" | "worsened" | "unchanged" | "incomparable" };

export function colorFor(p: { status: string; rank: number | null }) {
  if (p.status === "failed") return "#94a3b8";
  if (p.status === "not_found" || p.rank == null) return "#dc2626";
  if (p.rank <= 3) return "#16a34a";
  if (p.rank <= 10) return "#f59e0b";
  return "#ea580c";
}

/** Grid ranking map. Tiles come from OpenStreetMap; point colors encode the observed rank. */
export function RankingHeatmap({ center, points, radiusKm }: { center: { lat: number; lng: number }; points: HeatPoint[]; radiusKm: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !ref.current) return;
      map = L.map(ref.current, { scrollWheelZoom: false }).setView([center.lat, center.lng], radiusKm > 15 ? 10 : radiusKm > 6 ? 11 : 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap contributors" }).addTo(map);
      for (const p of points) {
        const label = p.status === "failed" ? "?" : p.status === "not_found" || p.rank == null ? "20+" : String(p.rank);
        const icon = L.divIcon({
          className: "",
          html: `<div style="background:${colorFor(p)};color:#fff;border-radius:9999px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font:600 12px system-ui;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${label}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });
        L.marker([p.lat, p.lng], { icon, title: `Rank ${label}${p.change ? ` (${p.change})` : ""}` }).addTo(map);
      }
      L.circleMarker([center.lat, center.lng], { radius: 5, color: "#1d4ed8" }).addTo(map).bindTooltip("Audit center");
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [center.lat, center.lng, points, radiusKm]);
  return <div ref={ref} className="h-[460px] w-full rounded-lg border border-slate-200" role="img" aria-label="Map of ranking results per grid point" />;
}

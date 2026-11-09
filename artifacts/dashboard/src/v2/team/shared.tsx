import type { CSSProperties, ReactNode } from "react";
import type { V2ScrumTeamView, V2SprintFacts } from "@workspace/api-client-react";
import { GlassCard, SectionTitle, V2_BAD, V2_GOOD, V2_WARN } from "../ui";

export type ScrumView = V2ScrumTeamView;
export const MUTED = "rgba(255,255,255,0.70)";
export const GREY = "#9AA1AE";
export const PINK = "rgb(246,135,189)";
export const CHART_H = 160;
export const COL_W = 92;

export const BIG: CSSProperties = { fontFamily: "'MuseoModerno', sans-serif", fontWeight: 600, fontSize: 36, lineHeight: "44px" };
export const SMALL: CSSProperties = { fontSize: 13, color: MUTED };

export interface Comparison {
  /** Sprints of the "recent" side, as the backend compares them. */
  recent: V2SprintFacts[];
  /** Previous side when it is part of `sprints` (window 6/12 full); null otherwise. */
  previous: V2SprintFacts[] | null;
  /** "los 3 sprints anteriores" / "los 3 anteriores". */
  previousLabel: string;
  hasComparison: boolean;
}

/**
 * Mirrors the backend trend split: 6/12 with enough closed sprints -> halves of `sprints`;
 * 3 -> all displayed vs the 3 closed before them (not in `sprints`); fewer sprints than the
 * window -> everything is recent and there is no previous side.
 */
export function comparison(v: ScrumView): Comparison {
  const realRate = v.trends.find((t) => t.key === "realRate");
  const hasComparison = realRate != null && realRate.before !== null;
  const { sprints, windowSprints } = v;
  if (!hasComparison) return { recent: sprints, previous: null, previousLabel: "sin dato previo", hasComparison };
  if (windowSprints === 3) return { recent: sprints, previous: null, previousLabel: "los 3 sprints anteriores", hasComparison };
  const h = windowSprints / 2;
  if (sprints.length < windowSprints) return { recent: sprints, previous: null, previousLabel: "sin dato previo", hasComparison: false };
  return { recent: sprints.slice(-h), previous: sprints.slice(-2 * h, -h), previousLabel: `los ${h} anteriores`, hasComparison };
}

export function rateColor(rate: number | null): string {
  if (rate == null) return MUTED;
  return rate >= 80 ? V2_GOOD : rate >= 50 ? V2_WARN : V2_BAD;
}

export const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const shortName = (s: V2SprintFacts) => {
  const m = /(\d+)\s*$/.exec(s.name);
  return m ? `S${m[1]}` : s.name;
};

export function Legend({ items }: { items: { color: string; label: string; outline?: boolean }[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13, color: MUTED }}>
      {items.map((i) => (
        <span key={i.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            aria-hidden="true"
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              background: i.outline ? "transparent" : i.color,
              border: i.outline ? `1px solid ${i.color}` : undefined,
            }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function Section({
  id,
  title,
  subtitle,
  legend,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  legend?: ReactNode;
  children: ReactNode;
}) {
  return (
    <GlassCard aria-labelledby={id}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <SectionTitle id={id}>{title}</SectionTitle>
          {subtitle && <p style={{ fontSize: 14, color: MUTED }}>{subtitle}</p>}
        </div>
        {legend}
      </div>
      {children}
    </GlassCard>
  );
}

export function MiniCard({ label, children, note }: { label: string; children: ReactNode; note: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: 16,
        borderRadius: 12,
        border: "1px solid var(--nxt-glass-border-1)",
      }}
    >
      <span style={SMALL}>{label}</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>{children}</span>
      <span style={SMALL}>{note}</span>
    </div>
  );
}

export const MINI_GRID: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 };

/** Scrolls inside its box so charts keep their size at 390 px. */
export function Scroll({ children }: { children: ReactNode }) {
  return <div style={{ overflowX: "auto", paddingBottom: 4 }}>{children}</div>;
}

/** "Tablero Sprint 117" -> "Sprint 117". */
export const sprintLabel = (name: string) => {
  const m = /(Sprint\s+\d+)\s*$/i.exec(name);
  return m ? m[1] : name;
};

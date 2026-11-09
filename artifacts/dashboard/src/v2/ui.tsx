import type { CSSProperties, ReactNode } from "react";
import type { V2Thresholds } from "@workspace/api-client-react";
import { fmtNum } from "./format";

export const V2_GOOD = "#5FD39A";
export const V2_BAD = "#FF8A80";
export const V2_WARN = "#FFB366";
const MUTED = "rgba(255,255,255,0.70)";

export function GlassCard({
  children,
  style,
  as: Tag = "section",
  ...rest
}: {
  children: ReactNode;
  style?: CSSProperties;
  as?: "section" | "article" | "div";
  "aria-labelledby"?: string;
  "aria-label"?: string;
}) {
  return (
    <Tag
      {...rest}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 24,
        borderRadius: 16,
        background: "var(--nxt-glass-1)",
        border: "1px solid var(--nxt-glass-border-1)",
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} style={{ fontSize: 20, lineHeight: "28px" }}>
      {children}
    </h2>
  );
}

/**
 * Delta con color por favorabilidad. betterWhen: "up" = subir es bueno, "down" = bajar es bueno.
 * null/0 -> apagado (muted).
 */
export function DeltaText({
  value,
  unit,
  betterWhen,
  children,
}: {
  value: number | null | undefined;
  unit?: string;
  betterWhen: "up" | "down";
  children?: ReactNode;
}) {
  const none = value == null || !Number.isFinite(value) || value === 0;
  const good = !none && (betterWhen === "up" ? value! > 0 : value! < 0);
  const color = none ? MUTED : good ? V2_GOOD : V2_BAD;
  let text: ReactNode = children;
  if (text == null) {
    if (value == null || !Number.isFinite(value)) text = "sin dato previo";
    else {
      const body = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(Math.abs(value));
      text = `${value > 0 ? "+" : value < 0 ? "−" : ""}${body}${unit ? ` ${unit}` : ""}`;
    }
  }
  return <span style={{ fontSize: 13, fontWeight: 500, color }}>{text}</span>;
}

const BAND: Record<string, { label: string; color: string; bg: string }> = {
  alta: { label: "alta", color: V2_GOOD, bg: "rgba(95,211,154,0.14)" },
  media: { label: "media", color: V2_WARN, bg: "rgba(255,179,102,0.14)" },
  baja: { label: "baja", color: V2_BAD, bg: "rgba(255,138,128,0.14)" },
};

/** "alta hasta 8 pp de desvío, media hasta 12 pp, baja sobre 12 pp" from sprintPredictability. */
export function predictabilityText(t: Pick<V2Thresholds, "predictabilityGood" | "predictabilityWarning">): string {
  const g = fmtNum(t.predictabilityGood);
  const w = fmtNum(t.predictabilityWarning);
  return `alta hasta ${g} pp de desvío, media hasta ${w} pp, baja sobre ${w} pp`;
}

export function BandPill({
  band,
  min,
  max,
  thresholds,
}: {
  band: "alta" | "media" | "baja" | null | undefined;
  min?: number | null;
  max?: number | null;
  /** The thresholds the band was computed with (the project's effective ones). */
  thresholds: Pick<V2Thresholds, "predictabilityGood" | "predictabilityWarning"> | null | undefined;
}) {
  if (!band) return <span style={{ fontSize: 12, color: MUTED }}>Predictibilidad sin dato</span>;
  const b = BAND[band];
  const fmt = (n: number) => `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(n)}%`;
  const range = min != null && max != null ? ` · ${fmt(min)} a ${fmt(max)}` : "";
  return (
    <span
      title={thresholds ? `Variación del cumplimiento entre sprints: ${predictabilityText(thresholds)}.` : "Variación del cumplimiento entre sprints."}
      style={{
        alignSelf: "flex-start",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        background: b.bg,
        fontSize: 12,
        fontWeight: 500,
        color: b.color,
      }}
    >
      Predictibilidad {b.label}
      {range}
    </span>
  );
}

export function WindowToggle<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label ?? "Ventana"} style={{ display: "inline-flex", gap: 4 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              border: "1px solid var(--nxt-glass-border-1)",
              background: on ? "var(--nxt-primary-container)" : "transparent",
              color: on ? "var(--nxt-on-primary-container)" : MUTED,
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

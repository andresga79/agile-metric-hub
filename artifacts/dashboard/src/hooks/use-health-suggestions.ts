import { useState, useEffect } from "react";
import { getAuthToken } from "@/lib/auth";

export interface Suggestion {
  area: string;
  label: string;
  value: string;
  status: "critical" | "warning" | "good";
  diagnosis: string;
  actions: string[];
}

interface RawHealth {
  throughput: number;
  avgCycleTime: number;
  avgLeadTime: number;
  cfr: number;
  wipRatio: number;
  predictability: number;
  bugCount: number;
  resolvedCount: number;
  inProgressCount: number;
  totalIssues: number;
}

// Fallback copy of artifacts/api-server/src/routes/admin/constants.ts DEFAULT_HEALTH_THRESHOLDS,
// used only until the /api/admin/metric-thresholds fetch below resolves. blocked is a percentage
// of WIP (blocked / inProgressCount * 100), not an absolute issue count.
const DEFAULT_THRESHOLDS = {
  cycleTime: { good: 15, warning: 25 },
  leadTime: { good: 25, warning: 35 },
  throughput: { good: 10, warning: 5 },
  wipRatio: { good: 30, warning: 50 },
  cfr: { good: 10, warning: 25 },
  predictability: { good: 70, warning: 40 },
  flowEfficiency: { good: 25, warning: 15 },
  blocked: { good: 0, warning: 15 },
};

export function useHealthSuggestions(projectId: string | undefined, period: string) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [flowHealthScore, setFlowHealthScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;

    const token = getAuthToken();
    const headers = { Authorization: `Bearer ${token}` };

    Promise.all([
      fetch(`/api/projects/${projectId}/health/${period}`, { headers }).then((r) => r.json()),
      fetch(`/api/projects/${projectId}/analytics/${period}`, { headers }).then((r) => r.json()),
      fetch(`/api/admin/metric-thresholds`, { headers }).then((r) => r.json()).catch(() => [] as any[]),
      fetch(`/api/admin/metric-thresholds/project/${projectId}`, { headers }).then((r) => r.json()).catch(() => [] as any[]),
    ])
      .then(([healthData, analyticsData, thresholds, projectOverrides]) => {
        const raw: RawHealth = healthData.raw;
        const analytics = analyticsData;
        const result: Suggestion[] = [];

        const flowHealthDimension = Array.isArray(healthData.dimensions)
          ? healthData.dimensions.find((d: { name: string }) => d.name === "Flow Health Score")
          : undefined;
        setFlowHealthScore(typeof flowHealthDimension?.value === "number" ? flowHealthDimension.value : null);

        const mergedThresholds: Record<string, { good: number; warning: number }> = {};
        for (const key of Object.keys(DEFAULT_THRESHOLDS)) {
          mergedThresholds[key] = { ...DEFAULT_THRESHOLDS[key as keyof typeof DEFAULT_THRESHOLDS] };
        }
        // Global admin defaults first, then this project's overrides (if any) win.
        for (const source of [thresholds, projectOverrides]) {
          if (!Array.isArray(source)) continue;
          for (const t of source) {
            if (t.metric && t.goodValue !== undefined && t.warningValue !== undefined) {
              mergedThresholds[t.metric] = {
                good: Number(t.goodValue),
                warning: Number(t.warningValue),
              };
            }
          }
        }

        const isLowerBetter = (metric: string) =>
          ["cycleTime", "leadTime", "cfr", "wipRatio", "blocked", "flowLoad", "wipAging"].includes(metric);

        const evalMetric = (
          area: string,
          label: string,
          rawValue: number | null | undefined,
          threshold: { good: number; warning: number },
          diagnosisTemplate: (val: number, threshold: number) => string,
          actionsList: string[],
          unit = ""
        ) => {
          if (rawValue === null || rawValue === undefined) return;
          const isLower = isLowerBetter(area);
          const status: "critical" | "warning" | "good" =
            isLower
              ? rawValue <= threshold.good ? "good" : rawValue <= threshold.warning ? "warning" : "critical"
              : rawValue >= threshold.good ? "good" : rawValue >= threshold.warning ? "warning" : "critical";
          const thresholdLabel = isLower
            ? `≤${threshold.good}${unit}`
            : `≥${threshold.good}${unit}`;
          result.push({
            area,
            label,
            value: `${rawValue.toFixed(1)}${unit}`,
            status,
            diagnosis: diagnosisTemplate(rawValue, threshold.good),
            // A "good" metric still shows its card (confirmation matters), but doesn't get a list of
            // "here's how to improve it" actions — there's nothing to fix, so suggesting fixes here
            // reads as noise and undercuts trust in the ones that actually matter.
            actions: status === "good" ? [] : actionsList,
          });
        };

        // --- Cycle Time (mean, not median — the Resumen tab shows P50 for this same metric;
        // labeled explicitly so the two don't read as contradictory) ---
        evalMetric(
          "cycleTime", "Cycle Time (promedio)", raw.avgCycleTime, mergedThresholds.cycleTime,
          (v, t) => v > t
            ? `El cycle time promedio es de ${v.toFixed(1)}d, superando el umbral recomendado de ${t}d. Los issues tardan demasiado en completarse una vez iniciados.`
            : `El cycle time promedio de ${v.toFixed(1)}d está dentro del rango saludable (≤${t}d).`,
          [
            "Limitar el WIP a 3-4 items por columna para reducir el multitasking.",
            "Identificar el estado del flujo con mayor tiempo de permanencia y optimizarlo.",
            "Dividir historias grandes (>5 SP) en tareas más pequeñas y accionables.",
            "Implementar políticas de \"Done\" más estrictas para reducir retrabajo.",
          ]
        );

        // --- Lead Time ---
        evalMetric(
          "leadTime", "Lead Time (promedio)", raw.avgLeadTime, mergedThresholds.leadTime,
          (v, t) => v > t
            ? `El lead time promedio es de ${v.toFixed(1)}d, superando el umbral recomendado de ${t}d. Desde que se crea un issue hasta que se entrega pasa demasiado tiempo.`
            : `El lead time promedio de ${v.toFixed(1)}d está dentro del rango saludable (≤${t}d).`,
          [
            "Revisar cuánto tiempo pasan los issues en el backlog antes de empezarlos — un cycle time sano con lead time alto suele significar demasiada espera previa al arranque.",
            "Priorizar y refinar el backlog con más frecuencia para reducir el tiempo de espera antes de iniciar el trabajo.",
            "Acortar el tiempo entre creación y priorización de nuevos issues.",
          ]
        );

        // --- Throughput ---
        evalMetric(
          "throughput", "Throughput", raw.throughput, mergedThresholds.throughput,
          (v, t) => v < t
            ? `El throughput es de ${v.toFixed(1)} issues/semana, por debajo del objetivo de ${t}/semana. El equipo está entregando menos de lo esperado.`
            : `El throughput de ${v.toFixed(1)} issues/semana se mantiene en un nivel saludable (≥${t}/semana).`,
          [
            "Revisar impedimentos que estén bloqueando el progreso del equipo.",
            "Hacer swarm en historias críticas en lugar de asignación individual.",
            "Evaluar si el alcance de las historias es adecuado o necesitan dividirse.",
            "Verificar si hubo días festivos, ausencias o ceremonias extendidas en el período.",
          ]
        );

        // --- WIP Balance ---
        evalMetric(
          "wipRatio", "WIP Balance", raw.wipRatio, mergedThresholds.wipRatio,
          (v, t) => v > t
            ? `El ${v.toFixed(0)}% de los issues están en progreso, superando el límite recomendado de ${t}%. Hay demasiados frentes abiertos simultáneamente.`
            : `Solo el ${v.toFixed(0)}% de los issues están en progreso, el equipo mantiene un WIP controlado (≤${t}%).`,
          [
            "Aplicar \"Stop starting, start finishing\": terminar lo iniciado antes de empezar algo nuevo.",
            "Establecer límites de WIP explícitos por columna en el tablero.",
            "Priorizar la finalización de items en progreso antes de traer nuevos al sprint.",
          ]
        );

        // --- Quality (CFR) ---
        evalMetric(
          "cfr", "Calidad (CFR)", raw.cfr, mergedThresholds.cfr,
          (v, t) => v > t
            ? `La tasa de fallo (CFR) es del ${v.toFixed(1)}%, superando el ${t}% recomendado. El ${raw.bugCount} de ${raw.resolvedCount} issues resueltos fueron bugs.`
            : `La tasa de fallo (CFR) del ${v.toFixed(1)}% está dentro del rango saludable (≤${t}%).`,
          [
            "Implementar code reviews obligatorios para todas las historias antes de pasar a Done.",
            "Aumentar la cobertura de tests automatizados, especialmente en las áreas con más bugs.",
            "Realizar análisis de causa raíz (RCA) para bugs recurrentes.",
            "Mejorar la definición de \"Ready\" con criterios de aceptación más claros y validables.",
          ]
        );

        // --- Predictability ---
        evalMetric(
          "predictability", "Predictabilidad", raw.predictability, mergedThresholds.predictability,
          (v, t) => v < t
            ? `La predictabilidad es de ${v.toFixed(0)}/100, por debajo del mínimo recomendado de ${t}. La variación semanal del throughput es alta.`
            : `La predictabilidad de ${v.toFixed(0)}/100 es buena (≥${t}). El equipo mantiene un ritmo consistente semana a semana.`,
          [
            "Estandarizar el tamaño de las historias usando una métrica común (puntos de historia o tamaño).",
            "Mejorar la estimación usando datos históricos en lugar de juicio experto.",
            "Reducir la variabilidad del flujo limitando interrupciones externas durante el sprint.",
          ]
        );

        // --- Flow Efficiency ---
        const flowEff = analytics?.flowEfficiency;
        if (flowEff !== undefined && flowEff !== null) {
          evalMetric(
            "flowEfficiency", "Eficiencia de Flujo", flowEff, mergedThresholds.flowEfficiency,
            (v, t) => v < t
              ? `La eficiencia de flujo es del ${v.toFixed(0)}%, por debajo del ${t}% recomendado. Los issues pasan demasiado tiempo en espera.`
              : `La eficiencia de flujo del ${v.toFixed(0)}% es saludable (≥${t}%). El tiempo activo vs espera es adecuado.`,
            [
              "Identificar los estados con mayor tiempo de espera y reducir las transiciones innecesarias.",
              "Automatizar procesos manuales como despliegues, pruebas de regresión y notificaciones.",
              "Mejorar la colaboración entre roles para reducir traspasos y tiempos muertos.",
            ]
          );
        }

        // --- Blocked Issues (as % of current WIP) ---
        // Two things this used to get wrong:
        // 1. It counted every issue that was EVER blocked in the last 90 days (analytics.blockedIssues),
        //    not just issues blocked right now — so a project with 0 active blocks could still show up
        //    as "Crítico" here. Filtering to isCurrentlyBlocked matches what the Resumen tab's
        //    "Bloqueos Activos" card already does.
        // 2. It divided by raw.inProgressCount (from this page's own /health endpoint, scoped to the
        //    selected period) while Resumen divides by analytics.wipAging.length (a wider, unscoped
        //    "currently in progress" list) — same project, same moment, two different WIP counts.
        //    Using wipAging here keeps both tabs in agreement.
        const blockedIssues: { isCurrentlyBlocked: boolean }[] = Array.isArray(analytics?.blockedIssues) ? analytics.blockedIssues : [];
        const blockedCount = blockedIssues.filter((b) => b.isCurrentlyBlocked).length;
        const wipForBlocked = Array.isArray(analytics?.wipAging) ? analytics.wipAging.length : 0;
        if (wipForBlocked > 0) {
          const blockedPct = (blockedCount / wipForBlocked) * 100;
          evalMetric(
            "blocked", "Issues Bloqueados", blockedPct, mergedThresholds.blocked,
            (v) => blockedCount === 0
              ? `Ningún issue en curso está bloqueado actualmente (0 de ${wipForBlocked}).`
              : v > mergedThresholds.blocked.warning
                ? `${blockedCount} de ${wipForBlocked} issues en curso (${v.toFixed(0)}%) están bloqueados ahora mismo. Los bloqueos prolongados detienen el flujo y acumulan deuda.`
                : `${blockedCount} de ${wipForBlocked} issues en curso (${v.toFixed(0)}%) están bloqueados ahora mismo, dentro del rango esperado.`,
            [
              "Establecer un proceso claro de escalado de bloqueos con tiempos máximos por nivel.",
              "Asignar un facilitador para resolver bloqueos críticos (>2 días).",
              "Documentar las causas de bloqueo para identificar patrones y prevenir recurrencias.",
            ],
            "%"
          );
        }

        // Sort: critical first, then warning, then good
        const order = { critical: 0, warning: 1, good: 2 };
        result.sort((a, b) => order[a.status] - order[b.status]);

        setSuggestions(result);
        setLoading(false);
      })
      .catch(() => {
        setFlowHealthScore(null);
        setLoading(false);
      });
  }, [projectId, period]);

  return { suggestions, flowHealthScore, loading };
}

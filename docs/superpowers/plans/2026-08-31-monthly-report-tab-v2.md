# Tab "Informe" v2 (capa editorial) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acercar el tab "Informe" al mockup editorial compartido por el usuario — masthead, KPI con severidad, narrativa por sprint, funcionalidades destacadas, cuello de botella estructural, y una sección nueva de "Próximos pasos" — reusando al máximo datos y patrones ya existentes de la v1.

**Architecture:** Toda regla de decisión con umbral (qué insight mostrar, si hay un cuello de botella estructural, qué pasos accionables corresponden) vive en funciones puras nuevas en `artifacts/api-server/src/lib/report-insights.ts`, testeadas con vitest. `detectStructuralBottleneck` se invoca dentro de `/analytics/:period` (ya calcula `timeInStatus` ahí mismo). `buildNextSteps` se invoca dentro de `/report-insights` (insights, sprint activo y release readiness ya están disponibles ahí). La única pieza que NO es una regla de negocio con umbral —tomar el bloqueo con más días bloqueado— se compone en el frontend sobre datos que el hook ya trae de `/analytics/:period`, porque el frontend (`artifacts/dashboard`) no puede importar código de `artifacts/api-server` (paquetes separados del monorepo) y duplicar ahí las ~250 líneas de detección de bloqueos de `analytics.ts` violaría DRY sin necesidad. Ningún endpoint nuevo se agrega al `Promise.all` de `useReportData`.

**Tech Stack:** TypeScript 5.9, Express 5, vitest, React + react-i18next, Drizzle ORM.

**Spec:** `docs/superpowers/specs/2026-08-31-monthly-report-tab-v2-editorial-design.md`

## Global Constraints

- Working directory para todas las tareas: el worktree ya existente
  `/home/andres/agile-metric-hub/.claude/worktrees/monthly-report-tab`
  (rama `worktree-monthly-report-tab`) — **no crear un worktree nuevo**, este
  plan continúa directamente sobre el trabajo de la v1 (13 tareas, ya
  committeadas ahí, sin mergear a `main`).
- No se agrega ningún endpoint nuevo al `Promise.all` de `useReportData` —
  todo lo nuevo viaja dentro de `/analytics/:period` y `/report-insights`,
  que el hook ya consume.
- Sin fuentes/colores nuevos — todo usa `Card`/tokens ya definidos en
  `artifacts/dashboard/src/components/ui/card.tsx` y el resto del theme.
- No se fabrican datos que no existen (fecha de release explícita, WIP aging
  por issue individual, curación manual de features) — ver "Fuera de
  alcance" en el spec.
- `pnpm run typecheck` y `pnpm --filter @workspace/api-server test` deben
  quedar limpios al final de cada tarea que toque código.

---

### Task 1: `detectStructuralBottleneck` — función pura + tests

**Files:**
- Modify: `artifacts/api-server/src/lib/report-insights.ts`
- Test: `artifacts/api-server/src/lib/__tests__/report-insights.test.ts`

**Interfaces:**
- Consumes: nada nuevo (recibe el mismo shape `{status, avgDays, issueCount}[]`
  que ya devuelve `computeTimeInStatus` en `analytics.ts`).
- Produces: `StructuralBottleneck` interface, `detectStructuralBottleneck(timeInStatus)`
  — usado por Task 3.

- [ ] **Step 1: Escribir los tests (deben fallar primero)**

Agregar al final de `artifacts/api-server/src/lib/__tests__/report-insights.test.ts`:

```ts
import { detectStructuralBottleneck } from "../report-insights";

describe("detectStructuralBottleneck", () => {
  it("flags the status with the largest weighted share of flow time", () => {
    const timeInStatus = [
      { status: "TO DO", avgDays: 137.0, issueCount: 166 },
      { status: "Ready for DEV", avgDays: 24.6, issueCount: 87 },
      { status: "Ready for QA", avgDays: 14.1, issueCount: 35 },
    ];
    const result = detectStructuralBottleneck(timeInStatus);
    expect(result).not.toBeNull();
    expect(result?.status).toBe("TO DO");
    expect(result?.sharePercent).toBeGreaterThan(50);
  });

  it("returns null when time is spread evenly across statuses (no clear bottleneck)", () => {
    const timeInStatus = [
      { status: "A", avgDays: 10, issueCount: 20 },
      { status: "B", avgDays: 10, issueCount: 20 },
      { status: "C", avgDays: 10, issueCount: 20 },
    ];
    expect(detectStructuralBottleneck(timeInStatus)).toBeNull();
  });

  it("returns null when the top status has too few issues to call it structural", () => {
    const timeInStatus = [
      { status: "Rare edge case", avgDays: 500, issueCount: 1 },
      { status: "TO DO", avgDays: 10, issueCount: 100 },
      { status: "DONE", avgDays: 5, issueCount: 100 },
    ];
    expect(detectStructuralBottleneck(timeInStatus)).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(detectStructuralBottleneck([])).toBeNull();
  });
});
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

Run: `pnpm --filter @workspace/api-server test -- report-insights`
Expected: FAIL con `detectStructuralBottleneck is not a function` (o import error).

- [ ] **Step 3: Implementar**

Agregar a `artifacts/api-server/src/lib/report-insights.ts` (después de `detectThresholdCrossing`):

```ts
export interface StructuralBottleneck {
  type: "structuralBottleneck";
  status: string;
  avgDays: number;
  issueCount: number;
  sharePercent: number;
}

// A status only counts as a "structural bottleneck" (worth a sentence in the report) if it
// both dominates the weighted flow time AND has enough issues behind it - a single outlier
// issue stuck for months would otherwise look like a systemic problem.
const BOTTLENECK_MIN_SHARE_PERCENT = 15;
const BOTTLENECK_MIN_ISSUE_COUNT = 3;

export function detectStructuralBottleneck(
  timeInStatus: { status: string; avgDays: number; issueCount: number }[]
): StructuralBottleneck | null {
  if (timeInStatus.length === 0) return null;

  const weighted = timeInStatus.map((s) => ({ ...s, weight: s.avgDays * s.issueCount }));
  const totalWeight = weighted.reduce((sum, s) => sum + s.weight, 0);
  if (totalWeight <= 0) return null;

  const top = weighted.reduce((max, s) => (s.weight > max.weight ? s : max));
  const sharePercent = (top.weight / totalWeight) * 100;

  if (sharePercent < BOTTLENECK_MIN_SHARE_PERCENT) return null;
  if (top.issueCount < BOTTLENECK_MIN_ISSUE_COUNT) return null;

  return {
    type: "structuralBottleneck",
    status: top.status,
    avgDays: top.avgDays,
    issueCount: top.issueCount,
    sharePercent,
  };
}
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

Run: `pnpm --filter @workspace/api-server test -- report-insights`
Expected: PASS (12 tests: 8 existentes + 4 nuevos).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/report-insights.ts artifacts/api-server/src/lib/__tests__/report-insights.test.ts
git commit -m "feat: add detectStructuralBottleneck pure function with tests"
```

---

### Task 2: `buildNextSteps` — función pura + tests (sin el ítem de bloqueos)

**Files:**
- Modify: `artifacts/api-server/src/lib/report-insights.ts`
- Test: `artifacts/api-server/src/lib/__tests__/report-insights.test.ts`

**Interfaces:**
- Consumes: `CompletionDropInsight`, `ThresholdCrossingInsight` (ya definidos en este archivo).
- Produces: `NextStep` interface, `buildNextSteps(input)` — usado por Task 4.
  **No incluye el bloqueo más antiguo** (ver nota de arquitectura arriba) —
  ese ítem lo antepone el frontend en Task 7.

- [ ] **Step 1: Escribir los tests (deben fallar primero)**

Agregar al final de `artifacts/api-server/src/lib/__tests__/report-insights.test.ts`:

```ts
import { buildNextSteps } from "../report-insights";

describe("buildNextSteps", () => {
  const baseInput = {
    activeSprint: null as { sprintName: string; completionRate: number; endDate: string | null } | null,
    insights: [] as (CompletionDropInsight | ThresholdCrossingInsight)[],
    releaseReadinessConfigured: false,
    releaseEpicsPendingCount: 0,
  };

  it("returns an empty list when there is nothing to report", () => {
    expect(buildNextSteps(baseInput)).toEqual([]);
  });

  it("adds one item per insight", () => {
    const drop: CompletionDropInsight = {
      type: "completionDrop",
      previousSprintName: "S111",
      previousCompletionRate: 92.2,
      currentSprintName: "S112",
      currentCompletionRate: 66.7,
      dropPoints: 25.5,
    };
    const result = buildNextSteps({ ...baseInput, insights: [drop] });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("completionDrop");
    expect(result[0].text).toContain("S111");
    expect(result[0].text).toContain("S112");
  });

  it("adds an active-sprint item with its completion rate", () => {
    const result = buildNextSteps({
      ...baseInput,
      activeSprint: { sprintName: "Tablero Sprint 113", completionRate: 15.2, endDate: "2026-09-04T00:00:00.000Z" },
    });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("activeSprint");
    expect(result[0].text).toContain("Tablero Sprint 113");
    expect(result[0].text).toContain("15.2");
  });

  it("adds a generic production item when release readiness is configured and something is pending, without inventing a date", () => {
    const result = buildNextSteps({
      ...baseInput,
      releaseReadinessConfigured: true,
      releaseEpicsPendingCount: 2,
    });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("productionReady");
    expect(result[0].text).not.toMatch(/\d{1,2}\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)/i);
  });

  it("omits the production item when configured but nothing is pending", () => {
    const result = buildNextSteps({
      ...baseInput,
      releaseReadinessConfigured: true,
      releaseEpicsPendingCount: 0,
    });
    expect(result).toEqual([]);
  });

  it("combines all applicable items in a fixed order: insights, sprint, production", () => {
    const crossing: ThresholdCrossingInsight = {
      type: "thresholdCrossing",
      metric: "cycleTime",
      previousValue: 13.1,
      currentValue: 38.1,
      fromBand: "warning",
      toBand: "critical",
    };
    const result = buildNextSteps({
      activeSprint: { sprintName: "S113", completionRate: 10, endDate: null },
      insights: [crossing],
      releaseReadinessConfigured: true,
      releaseEpicsPendingCount: 1,
    });
    expect(result.map((r) => r.type)).toEqual(["thresholdCrossing", "activeSprint", "productionReady"]);
  });
});
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

Run: `pnpm --filter @workspace/api-server test -- report-insights`
Expected: FAIL con `buildNextSteps is not a function`.

- [ ] **Step 3: Implementar**

Agregar a `artifacts/api-server/src/lib/report-insights.ts` (al final del archivo):

```ts
export interface NextStep {
  type: "completionDrop" | "thresholdCrossing" | "activeSprint" | "productionReady";
  text: string;
}

export function buildNextSteps(input: {
  activeSprint: { sprintName: string; completionRate: number; endDate: string | null } | null;
  insights: (CompletionDropInsight | ThresholdCrossingInsight)[];
  releaseReadinessConfigured: boolean;
  releaseEpicsPendingCount: number;
}): NextStep[] {
  const steps: NextStep[] = [];

  for (const insight of input.insights) {
    if (insight.type === "completionDrop") {
      steps.push({
        type: "completionDrop",
        text: `Revisar en retro la caída de finalización de ${insight.previousSprintName} (${insight.previousCompletionRate.toFixed(1)}%) a ${insight.currentSprintName} (${insight.currentCompletionRate.toFixed(1)}%).`,
      });
    } else {
      const metricLabel = insight.metric === "cycleTime" ? "Cycle Time" : "Lead Time";
      steps.push({
        type: "thresholdCrossing",
        text: `Atender el cruce a estado crítico de ${metricLabel}: pasó de ${insight.previousValue.toFixed(1)}d a ${insight.currentValue.toFixed(1)}d.`,
      });
    }
  }

  if (input.activeSprint) {
    const endText = input.activeSprint.endDate
      ? ` (cierra ${new Date(input.activeSprint.endDate).toLocaleDateString("es-AR", { day: "numeric", month: "short" })})`
      : "";
    steps.push({
      type: "activeSprint",
      text: `Seguimiento de ${input.activeSprint.sprintName}${endText}: ${input.activeSprint.completionRate.toFixed(1)}% completado a la fecha.`,
    });
  }

  if (input.releaseReadinessConfigured && input.releaseEpicsPendingCount > 0) {
    steps.push({
      type: "productionReady",
      text: `Hay ${input.releaseEpicsPendingCount} release(s) en preparación — ver "Próximos pasos a producción".`,
    });
  }

  return steps;
}
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

Run: `pnpm --filter @workspace/api-server test -- report-insights`
Expected: PASS (18 tests: 12 de Task 1 + 6 nuevos).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/report-insights.ts artifacts/api-server/src/lib/__tests__/report-insights.test.ts
git commit -m "feat: add buildNextSteps pure function with tests"
```

---

### Task 3: Agregar `structuralBottleneck` a `/analytics/:period`

**Files:**
- Modify: `artifacts/api-server/src/routes/analytics.ts`

**Interfaces:**
- Consumes: `detectStructuralBottleneck` (Task 1).
- Produces: la respuesta de `GET /projects/:id/analytics/:period` ahora
  incluye `structuralBottleneck: StructuralBottleneck | null` junto a
  `timeInStatus` — consumido por Task 6.

- [ ] **Step 1: Importar `detectStructuralBottleneck`**

En `artifacts/api-server/src/routes/analytics.ts`, agregar al bloque de
imports del tope del archivo (junto a los demás imports de `../lib/*`):

```ts
import { detectStructuralBottleneck } from "../lib/report-insights";
```

- [ ] **Step 2: Calcular el bottleneck justo después de `timeInStatus`**

Ubicar esta línea existente (dentro del handler de la ruta, sección "Time in Status (#9)"):

```ts
    const timeInStatus = await computeTimeInStatus(timeInStatusIssues, boardStatusNames);
```

Agregar inmediatamente después:

```ts
    const structuralBottleneck = detectStructuralBottleneck(timeInStatus);
```

- [ ] **Step 3: Incluir el campo en la respuesta**

Ubicar el `res.json({...})` final de este handler:

```ts
    res.json({
      projectId,
      period,
      compareTo,
      fetchedAt: cacheTimestamp ? new Date(cacheTimestamp).toISOString() : null,
      ...metrics,
      wipAging: wipAgingTop,
      wipAgingTotal,
      wipAgingCounts,
      blockedIssues,
      timeInStatus,
      previousPeriod,
    });
```

Agregar `structuralBottleneck,` (por ejemplo, después de `timeInStatus,`):

```ts
    res.json({
      projectId,
      period,
      compareTo,
      fetchedAt: cacheTimestamp ? new Date(cacheTimestamp).toISOString() : null,
      ...metrics,
      wipAging: wipAgingTop,
      wipAgingTotal,
      wipAgingCounts,
      blockedIssues,
      timeInStatus,
      structuralBottleneck,
      previousPeriod,
    });
```

- [ ] **Step 4: Typecheck**

Run: `pnpm run typecheck`
Expected: sin errores.

- [ ] **Step 5: Correr el test suite backend**

Run: `pnpm --filter @workspace/api-server test`
Expected: todos los tests pasan, sin regresiones (no hay tests de ruta HTTP
para `/analytics` en este proyecto — solo se verifica que nada más se rompió).

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/analytics.ts
git commit -m "feat: add structuralBottleneck to /analytics/:period response"
```

---

### Task 4: Extender `/report-insights` con `nextSteps` y `featuredIssues` + extraer `getProjectReleaseReadiness`

**Files:**
- Modify: `artifacts/api-server/src/routes/release-readiness.ts` (extraer función reusable)
- Modify: `artifacts/api-server/src/routes/report-insights.ts` (nuevo shape de respuesta)

**Interfaces:**
- Consumes: `buildNextSteps` (Task 2), `getStoryPoints` de `../lib/jira` (ya existe).
- Produces: `GET /projects/:id/report-insights` ahora devuelve
  `{ insights: (CompletionDropInsight|ThresholdCrossingInsight)[], nextSteps: NextStep[], featuredIssues: {key:string; summary:string; assignee:string|null; storyPoints:number}[] }`
  en vez de solo `Insight[]` — **cambio de shape, no aditivo**. Usado por Task 6.
- Produces: `getProjectReleaseReadiness(projectId: string): Promise<{configured:false}|{configured:true; epics: {issueKey:string; summary:string; description:string|null; status:string; statusCategory:string; assignee:string|null; jiraUpdatedAt:string; linkedIssueKeys:string[]}[]}>`
  — usado por el propio `release-readiness.ts` y por `report-insights.ts`.

- [ ] **Step 1: Extraer `getProjectReleaseReadiness` en `release-readiness.ts`**

En `artifacts/api-server/src/routes/release-readiness.ts`, reemplazar el cuerpo actual del handler `GET /projects/:projectId/release-readiness` (la query completa de `keywords`/`matchConditions`/`epics`) por una función exportada que el propio handler llama:

```ts
export async function getProjectReleaseReadiness(projectId: string) {
  const keywords = await db
    .select({ keyword: projectReleaseKeywordsTable.keyword })
    .from(projectReleaseKeywordsTable)
    .where(eq(projectReleaseKeywordsTable.projectId, projectId));

  if (keywords.length === 0) {
    return { configured: false as const };
  }

  const matchConditions = keywords.flatMap((k) => [
    ilike(releaseEpicsTable.summary, `%${k.keyword}%`),
    ilike(releaseEpicsTable.description, `%${k.keyword}%`),
  ]);

  const epics = await db
    .select()
    .from(releaseEpicsTable)
    .where(or(...matchConditions))
    .orderBy(desc(releaseEpicsTable.jiraUpdatedAt))
    .limit(5);

  return {
    configured: true as const,
    epics: epics.map((e) => ({
      issueKey: e.issueKey,
      summary: e.summary,
      description: e.description,
      status: e.status,
      statusCategory: e.statusCategory,
      assignee: e.assignee,
      jiraUpdatedAt: e.jiraUpdatedAt.toISOString(),
      linkedIssueKeys: extractLinkedIssueKeys(e.description),
    })),
  };
}
```

Y el handler existente queda:

```ts
router.get(
  "/projects/:projectId/release-readiness",
  requireAuth,
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0]! : req.params.projectId!;
    res.json(await getProjectReleaseReadiness(projectId));
  }
);
```

- [ ] **Step 2: Typecheck tras la extracción**

Run: `pnpm run typecheck`
Expected: sin errores.

- [ ] **Step 3: Reescribir el handler de `/report-insights`**

En `artifacts/api-server/src/routes/report-insights.ts`, reemplazar los imports del tope del archivo por:

```ts
import { Router, type IRouter } from "express";
import { requireAuth, requireSectionView } from "../middleware/auth";
import {
  getJiraSprints,
  getSprintIssues,
  getProjectBoardType,
  getResolvedJiraIssuesInRange,
  getEffectiveIssueType,
  getStoryPoints,
  type JiraIssue,
} from "../lib/jira";
import { computeSprintMetrics } from "./sprint-metrics";
import { computePeriodMetrics } from "./analytics";
import { getPortfolioAllowedIssueTypes } from "../lib/portfolio-metric-settings";
import { getEffectiveThresholds } from "../lib/health-thresholds";
import {
  detectCompletionDrop,
  detectThresholdCrossing,
  buildNextSteps,
  type CompletionDropInsight,
  type ThresholdCrossingInsight,
} from "../lib/report-insights";
import { getProjectReleaseReadiness } from "./release-readiness";
```

Reemplazar el cuerpo completo del handler `GET /projects/:projectId/report-insights` (todo lo que hay entre `async (req, res): Promise<void> => {` y su `}` de cierre, incluyendo el `res.json(insights)` final) por:

```ts
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0]! : req.params.projectId!;
    const insights: (CompletionDropInsight | ThresholdCrossingInsight)[] = [];
    let activeSprintForNextSteps: { sprintName: string; completionRate: number; endDate: string | null } | null = null;

    // --- Completion drop between the last two closed sprints ---
    const boardType = await getProjectBoardType(projectId);
    if (boardType === "scrum") {
      const sprints = await getJiraSprints(projectId, 50);
      const relevant = [...sprints]
        .filter((s) => s.state === "closed" || s.state === "active")
        .sort((a, b) => {
          const aEnd = a.endDate ? new Date(a.endDate).getTime() : 0;
          const bEnd = b.endDate ? new Date(b.endDate).getTime() : 0;
          return aEnd - bEnd;
        })
        .slice(-3);

      if (relevant.length >= 2) {
        const allowedIssueTypes = await getPortfolioAllowedIssueTypes();
        const summaries = await Promise.all(
          relevant.map(async (s) => {
            const issues = await getSprintIssues(s.id);
            const metric = await computeSprintMetrics(s, issues, allowedIssueTypes, sprints);
            return { name: s.name, state: s.state as "closed" | "active", completionRate: metric.completionRate };
          })
        );
        const drop = detectCompletionDrop(summaries);
        if (drop) insights.push(drop);

        const active = summaries.find((s) => s.state === "active");
        if (active) {
          const activeRaw = sprints.find((s) => s.name === active.name);
          activeSprintForNextSteps = {
            sprintName: active.name,
            completionRate: active.completionRate,
            endDate: activeRaw?.endDate ?? null,
          };
        }
      }
    }

    // --- Cycle/lead time threshold crossing (current 1m vs previous 1m) ---
    const periodDays = 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);
    const allowedIssueTypes = await getPortfolioAllowedIssueTypes();

    const currentIssues = await getResolvedJiraIssuesInRange(projectId, periodDays, 0, { includeChangelog: true }).catch(
      () => [] as JiraIssue[]
    );
    const prevStart = new Date(startDate.getTime() - periodDays * 24 * 60 * 60 * 1000);
    const prevIssues = await getResolvedJiraIssuesInRange(projectId, periodDays * 2, periodDays, {
      includeChangelog: true,
    }).catch(() => [] as JiraIssue[]);

    const currentFiltered = currentIssues.filter((i) => allowedIssueTypes.includes(getEffectiveIssueType(i)));
    const prevFiltered = prevIssues.filter((i) => allowedIssueTypes.includes(getEffectiveIssueType(i)));

    if (currentFiltered.length > 0 && prevFiltered.length > 0) {
      const current = await computePeriodMetrics(currentFiltered, startDate);
      const previous = await computePeriodMetrics(prevFiltered, prevStart, startDate);
      const thresholds = await getEffectiveThresholds(projectId);

      const cycleCrossing = detectThresholdCrossing(
        "cycleTime", current.avgCycleTime, previous.avgCycleTime, thresholds["cycleTime"]
      );
      if (cycleCrossing) insights.push(cycleCrossing);

      const leadCrossing = detectThresholdCrossing(
        "leadTime", current.avgLeadTime, previous.avgLeadTime, thresholds["leadTime"]
      );
      if (leadCrossing) insights.push(leadCrossing);
    }

    // --- Featured functionality: top resolved issues by story points this period ---
    const featuredIssues = currentFiltered
      .map((i) => ({
        key: i.key,
        summary: i.fields.summary,
        assignee: i.fields.assignee?.displayName ?? null,
        storyPoints: getStoryPoints(i),
      }))
      .filter((i) => i.storyPoints > 0)
      .sort((a, b) => b.storyPoints - a.storyPoints)
      .slice(0, 4);

    // --- Next steps: insights + active sprint progress + release readiness ---
    const releaseReadiness = await getProjectReleaseReadiness(projectId);
    const releaseEpicsPendingCount = releaseReadiness.configured
      ? releaseReadiness.epics.filter((e) => e.statusCategory !== "done").length
      : 0;

    const nextSteps = buildNextSteps({
      activeSprint: activeSprintForNextSteps,
      insights,
      releaseReadinessConfigured: releaseReadiness.configured,
      releaseEpicsPendingCount,
    });

    res.json({ insights, nextSteps, featuredIssues });
  }
```

- [ ] **Step 4: Typecheck**

Run: `pnpm run typecheck`
Expected: sin errores.

- [ ] **Step 5: Correr el test suite completo**

Run: `pnpm --filter @workspace/api-server test`
Expected: todos los tests pasan, sin regresiones.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/release-readiness.ts artifacts/api-server/src/routes/report-insights.ts
git commit -m "feat: extend /report-insights with next steps and featured issues"
```

---

### Task 5: Agregar claves i18n nuevas

**Files:**
- Modify: `artifacts/dashboard/src/i18n/locales/es.json`
- Modify: `artifacts/dashboard/src/i18n/locales/en.json`

**Interfaces:**
- Produces: claves `page.report.advancesTitle`, `page.report.featuredTitle`,
  `page.report.nextStepsTitle`, `page.report.scopeNoteTitle`,
  `page.report.scopeNoteBody`, `page.report.oldestBlockerBadge`,
  `page.report.oldestBlockerStep`, `page.report.reopenedLabel`,
  `page.report.carryoverLabel` — consumidas por Task 7.

- [ ] **Step 1: Agregar las claves a `es.json`**

Agregar, junto a las demás claves `page.report.*` existentes (después de
`"page.report.flowIssues": "Issues",`):

```json
  "page.report.advancesTitle": "Avances y funcionalidades",
  "page.report.featuredTitle": "Funcionalidades destacadas del período",
  "page.report.nextStepsTitle": "Próximos pasos",
  "page.report.scopeNoteTitle": "Nota de alcance",
  "page.report.scopeNoteBody": "El \"Flow Health Score\" de esta plataforma combina throughput, cycle time y tasa de rechazo QA normalizados contra los umbrales configurados en Admin → Health. No mide DORA real — no hay señal de deploys/CI.",
  "page.report.oldestBlockerBadge": "Más antiguo del período",
  "page.report.oldestBlockerStep": "Desbloquear {{key}} — \"{{summary}}\", el bloqueo más antiguo del período ({{days}}d).",
  "page.report.reopenedLabel": "Reabiertos",
  "page.report.carryoverLabel": "Carryover",
```

- [ ] **Step 2: Agregar el equivalente en inglés a `en.json`**

```json
  "page.report.advancesTitle": "Progress and features",
  "page.report.featuredTitle": "Featured functionality this period",
  "page.report.nextStepsTitle": "Next steps",
  "page.report.scopeNoteTitle": "Scope note",
  "page.report.scopeNoteBody": "This platform's \"Flow Health Score\" combines throughput, cycle time and QA rejection rate normalized against the thresholds configured in Admin → Health. It does not measure real DORA metrics — there is no deploy/CI signal.",
  "page.report.oldestBlockerBadge": "Oldest this period",
  "page.report.oldestBlockerStep": "Unblock {{key}} — \"{{summary}}\", the oldest blocker this period ({{days}}d).",
  "page.report.reopenedLabel": "Reopened",
  "page.report.carryoverLabel": "Carryover",
```

- [ ] **Step 3: Validar JSON y typecheck**

Run: `python3 -c "import json; json.load(open('artifacts/dashboard/src/i18n/locales/es.json')); json.load(open('artifacts/dashboard/src/i18n/locales/en.json')); print('ok')"`
Expected: `ok`

Run: `pnpm run typecheck`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add artifacts/dashboard/src/i18n/locales/es.json artifacts/dashboard/src/i18n/locales/en.json
git commit -m "feat: add i18n keys for the editorial report sections"
```

---

### Task 6: Actualizar `use-report-data.ts` para los nuevos shapes de `/analytics` y `/report-insights`

**Files:**
- Modify: `artifacts/dashboard/src/hooks/use-report-data.ts`

**Interfaces:**
- Consumes: nuevo campo `structuralBottleneck` en `/analytics/:period`
  (Task 3), nuevo shape de `/report-insights` (Task 4).
- Produces: `useReportData` ahora también devuelve `structuralBottleneck`,
  `nextSteps`, `featuredIssues`, `healthDimensions` — consumido por Task 7.

- [ ] **Step 1: Agregar los nuevos estados y actualizar el destructuring de la respuesta**

En `artifacts/dashboard/src/hooks/use-report-data.ts`, agregar junto a los
demás `useState`:

```ts
  const [structuralBottleneck, setStructuralBottleneck] = useState<any | null>(null);
  const [nextSteps, setNextSteps] = useState<any[]>([]);
  const [featuredIssues, setFeaturedIssues] = useState<any[]>([]);
  const [healthDimensions, setHealthDimensions] = useState<any[]>([]);
```

Reemplazar la línea:

```ts
        setInsights(Array.isArray(insightRows) ? insightRows : []);
```

por:

```ts
        setInsights(Array.isArray(insightRows?.insights) ? insightRows.insights : []);
        setNextSteps(Array.isArray(insightRows?.nextSteps) ? insightRows.nextSteps : []);
        setFeaturedIssues(Array.isArray(insightRows?.featuredIssues) ? insightRows.featuredIssues : []);
        setStructuralBottleneck(analytics?.structuralBottleneck ?? null);
        setHealthDimensions(Array.isArray(health?.dimensions) ? health.dimensions : []);
```

Y actualizar el `return` final para incluir los cuatro campos nuevos:

```ts
  return {
    loading, error, cfdData, members, timeInStatus, healthScore, qaRejectionRate,
    blockedIssues, sprints, sprintGoal, releaseReadiness, insights,
    structuralBottleneck, nextSteps, featuredIssues, healthDimensions,
  };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add artifacts/dashboard/src/hooks/use-report-data.ts
git commit -m "feat: expose bottleneck, next steps, featured issues and health dimensions from useReportData"
```

---

### Task 7: Reescribir `project-report.tsx` con el layout editorial

**Files:**
- Modify: `artifacts/dashboard/src/pages/project-report.tsx` (reescritura completa)

**Interfaces:**
- Consumes: `useReportData` extendido (Task 6), i18n keys de Task 5.

Nota: esta tarea también corrige un bug preexistente de la v1 — el bloque de
bloqueos usaba `b.issueKey`, pero el endpoint `/analytics/:period` devuelve
el campo como `b.key` (ver `artifacts/api-server/src/routes/analytics.ts:526`),
así que el key del issue nunca se mostraba (quedaba vacío). Se corrige de
paso al reescribir esa sección.

- [ ] **Step 1: Reemplazar el contenido completo del archivo**

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link } from "wouter";
import { useGetProject, getGetProjectQueryKey, useGetProjectMetrics, getGetProjectMetricsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Users } from "lucide-react";
import CfdChart from "@/components/cfd-chart";
import { getAuthToken } from "@/lib/auth";
import { ProjectTabs } from "@/components/project-tabs";
import { useReportData } from "@/hooks/use-report-data";

type Period = "1m" | "3m";

// Same 0-100 banding convention project-health.tsx uses for its dimension scores:
// >=70 good, >=40 warning, below that critical.
function dimensionBand(value: number | undefined): "critical" | "warning" | "good" | null {
  if (typeof value !== "number") return null;
  if (value >= 70) return "good";
  if (value >= 40) return "warning";
  return "critical";
}

const BAND_CLASSES: Record<"critical" | "warning" | "good", string> = {
  critical: "bg-destructive/10 text-destructive",
  warning: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  good: "bg-green-500/10 text-green-600 dark:text-green-400",
};

function Kpi({ label, value, dimensionValue }: { label: string; value: string; dimensionValue?: number }) {
  const band = dimensionBand(dimensionValue);
  return (
    <div className="border border-border rounded p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold">{value}</div>
      {band && (
        <span className={`inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${BAND_CLASSES[band]}`}>
          {band}
        </span>
      )}
    </div>
  );
}

export default function ProjectReport() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const [period, setPeriod] = useState<Period>("1m");
  const token = getAuthToken();

  const { data: project } = useGetProject(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId!) },
  });
  const { data: metrics } = useGetProjectMetrics(projectId!, period, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectMetricsQueryKey(projectId!, period) },
  });

  const {
    loading, error, cfdData, members, timeInStatus, healthScore, qaRejectionRate,
    blockedIssues, sprints, sprintGoal, releaseReadiness, insights,
    structuralBottleneck, nextSteps, featuredIssues, healthDimensions,
  } = useReportData(projectId, period);

  if (loading) return <div>{t("common.loading")}</div>;
  if (!project) return <div>{t("page.team.notFound")}</div>;
  if (error) return <div>{error}</div>;

  const sortedTimeInStatus = [...timeInStatus].sort((a: any, b: any) => b.avgDays - a.avgDays);
  const topMembers = [...(members ?? [])].sort((a: any, b: any) => b.issuesResolved - a.issuesResolved).slice(0, 5);
  const closedSprints = [...sprints].filter((s: any) => s.state === "closed");
  const activeSprint = sprints.find((s: any) => s.state === "active");
  const sortedBlockedIssues = [...blockedIssues].sort((a: any, b: any) => b.totalDays - a.totalDays);

  const dimensionValue = (name: string) => healthDimensions.find((d: any) => d.name === name)?.value;

  // The oldest-blocker step is a plain sort-and-pick, not a threshold rule, so it's composed
  // here from data the hook already has, rather than duplicating blockedIssues detection
  // (~250 lines in analytics.ts, DB-backed manual overrides) inside /report-insights just to
  // reuse it. See the plan's Task 7 note for the full reasoning.
  const oldestBlockerStep = sortedBlockedIssues[0]
    ? [{
        type: "oldestBlocker",
        text: t("page.report.oldestBlockerStep", {
          key: sortedBlockedIssues[0].key,
          summary: sortedBlockedIssues[0].summary,
          days: sortedBlockedIssues[0].totalDays?.toFixed(1),
        }),
      }]
    : [];
  const allNextSteps = [...oldestBlockerStep, ...nextSteps];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
              <ArrowLeft size={14} />
              {project.name}
            </Link>
          </div>
          <p className="text-xs font-mono uppercase tracking-wide text-primary mb-1">
            {project.key} · {project.boardType === "scrum" ? "Scrum" : "Kanban"} · Software
          </p>
          <h1 className="text-2xl font-bold tracking-tight">{t("page.report.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("page.report.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-background border border-border rounded-md p-1">
            {(["1m", "3m"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ProjectTabs projectId={projectId!} active="report" />

      <Card>
        <CardHeader>
          <CardTitle>{project.name} — {t("page.report.reportTitle")}</CardTitle>
          <p className="text-xs text-muted-foreground">{period.toUpperCase()} · {new Date().toLocaleDateString()}</p>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Kpi label={t("page.report.throughput")} value={`${metrics?.throughput?.toFixed(1) ?? "—"} /wk`} dimensionValue={dimensionValue("Throughput")} />
          <Kpi label={t("page.report.cycleTime")} value={`${metrics?.cycleTime?.toFixed(1) ?? "—"}d`} dimensionValue={dimensionValue("Cycle Time")} />
          <Kpi label={t("page.report.leadTime")} value={`${metrics?.leadTime?.toFixed(1) ?? "—"}d`} dimensionValue={dimensionValue("Lead Time")} />
          <Kpi label={t("page.report.resolved")} value={`${metrics?.resolvedCount ?? "—"}`} />
          <Kpi label={t("page.report.healthScore")} value={`${healthScore ?? "—"}${healthScore !== null ? "/100" : ""}`} dimensionValue={dimensionValue("Flow Health Score")} />
          <Kpi label={t("page.report.qaRejectionRate")} value={`${qaRejectionRate ?? "—"}${qaRejectionRate !== null ? "%" : ""}`} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>01 · {t("page.report.advancesTitle")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {[...closedSprints, ...(activeSprint ? [activeSprint] : [])].map((s: any) => (
            <div key={s.sprintId}>
              <h3 className="text-sm font-bold mb-1">
                {s.sprintName} {s.state === "active" ? "— en curso" : "— cerrado"}
              </h3>
              {s.state === "closed" ? (
                <p className="text-sm text-muted-foreground">
                  {s.completedStoryPoints} de {s.totalStoryPoints} SP completados ({s.completionRate.toFixed(1)}%), cycle time {s.avgCycleTimeDays?.toFixed(1) ?? "—"}d
                  {s.reopenedCount > 0 ? `, ${s.reopenedCount} reabierto(s)` : ""}
                  {s.carryoverCount > 0 ? `, carryover de ${s.carryoverCount} issues (${s.carryoverStoryPoints} SP) al sprint siguiente` : ""}.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {s.completedIssues} de {s.totalIssues} issues resueltos ({s.completionRate.toFixed(1)}%) hasta la fecha.
                </p>
              )}
            </div>
          ))}

          {sprintGoal && (
            <div className="border-l-2 border-primary pl-3">
              <p className="text-sm"><strong>{t("page.report.sprintGoal")}</strong> ({sprintGoal.sprintName}): {sprintGoal.goal}</p>
            </div>
          )}

          {featuredIssues.length > 0 && (
            <div>
              <h3 className="text-sm font-bold mb-1">{t("page.report.featuredTitle")}</h3>
              <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                {featuredIssues.map((f: any) => (
                  <li key={f.key}>
                    <strong className="text-foreground">{f.key}</strong> — {f.summary}
                    {f.assignee ? ` (${f.assignee})` : ""} · {f.storyPoints} SP
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>02 · {t("page.report.decisionsTitle")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="border border-border rounded p-3 bg-muted/30">
            <p className="text-xs font-semibold mb-1">{t("page.report.scopeNoteTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("page.report.scopeNoteBody")}</p>
          </div>
          {insights.map((insight: any, i: number) =>
            insight.type === "completionDrop" ? (
              <p key={i} className="text-sm border-l-2 border-destructive pl-3">
                {insight.previousSprintName} ({insight.previousCompletionRate.toFixed(1)}%) → {insight.currentSprintName} ({insight.currentCompletionRate.toFixed(1)}%): caída de {insight.dropPoints.toFixed(1)} puntos en finalización.
              </p>
            ) : (
              <p key={i} className="text-sm border-l-2 border-destructive pl-3">
                {insight.metric === "cycleTime" ? t("page.report.cycleTime") : t("page.report.leadTime")} pasó de {insight.previousValue.toFixed(1)}d a {insight.currentValue.toFixed(1)}d — cruzó a estado crítico.
              </p>
            )
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>03 · {t("page.report.blockersTitle")}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {sortedBlockedIssues.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("page.report.blockersEmpty")}</p>
          ) : (
            <div className="space-y-2">
              {sortedBlockedIssues.map((b: any, i: number) => (
                <div key={b.key} className="border-l-2 border-destructive pl-3 text-sm">
                  <div className="font-medium">
                    {b.key} — {b.summary}
                    {i === 0 && (
                      <span className="ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
                        {t("page.report.oldestBlockerBadge")}
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground">{b.flagReason ?? ""}</div>
                  <div className="text-xs text-muted-foreground">{b.totalDays?.toFixed(1)}d bloqueado</div>
                </div>
              ))}
            </div>
          )}
          {structuralBottleneck && (
            <p className="text-sm text-muted-foreground pt-2">
              El estado <strong className="text-foreground">"{structuralBottleneck.status}"</strong> concentra el {structuralBottleneck.sharePercent.toFixed(0)}% del tiempo total de flujo del período ({structuralBottleneck.avgDays.toFixed(1)}d promedio, {structuralBottleneck.issueCount} issues).
            </p>
          )}
        </CardContent>
      </Card>

      {allNextSteps.length > 0 && (
        <Card>
          <CardHeader><CardTitle>04 · {t("page.report.nextStepsTitle")}</CardTitle></CardHeader>
          <CardContent>
            <ol className="text-sm space-y-2 list-decimal pl-5">
              {allNextSteps.map((step: any, i: number) => (
                <li key={i}>{step.text}</li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {releaseReadiness?.configured && releaseReadiness.epics.length > 0 && (
        <Card>
          <CardHeader><CardTitle>05 · {t("page.report.productionTitle")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {releaseReadiness.epics.map((e) => (
              <div key={e.issueKey} className="border-l-2 border-primary pl-3 text-sm">
                <div className="font-medium">{e.issueKey} — {e.summary}</div>
                <div className="text-xs text-muted-foreground">{e.status}{e.assignee ? ` · ${e.assignee}` : ""}</div>
                {e.linkedIssueKeys.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {t("page.report.productionLinkedIssues")}: {e.linkedIssueKeys.join(", ")}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {cfdData.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("page.report.cfdTitle")}</CardTitle></CardHeader>
          <CardContent className="h-[200px]"><CfdChart data={cfdData} /></CardContent>
        </Card>
      )}

      {topMembers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1"><Users size={14} />{t("page.report.membersTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 text-muted-foreground font-medium">{t("page.report.memberName")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.memberResolved")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.memberCycle")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.memberPoints")}</th>
                </tr>
              </thead>
              <tbody>
                {topMembers.map((m: any) => (
                  <tr key={m.accountId} className="border-b border-border/50">
                    <td className="py-1 font-medium">{m.displayName}</td>
                    <td className="py-1 text-right">{m.issuesResolved}</td>
                    <td className="py-1 text-right">{m.avgCycleTime?.toFixed(1) ?? "—"}d</td>
                    <td className="py-1 text-right">{m.storyPoints ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {closedSprints.length > 0 && (
        <Card>
          <CardHeader><CardTitle>06 · {t("page.report.sprintsTitle")}</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 text-muted-foreground font-medium">Sprint</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">SP</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">%</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">Cycle Time</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.reopenedLabel")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.carryoverLabel")}</th>
                </tr>
              </thead>
              <tbody>
                {closedSprints.map((s: any) => (
                  <tr key={s.sprintId} className="border-b border-border/50">
                    <td className="py-1 font-medium">{s.sprintName}</td>
                    <td className="py-1 text-right">{s.completedStoryPoints}/{s.totalStoryPoints}</td>
                    <td className="py-1 text-right">{s.completionRate.toFixed(1)}%</td>
                    <td className="py-1 text-right">{s.avgCycleTimeDays?.toFixed(1) ?? "—"}d</td>
                    <td className="py-1 text-right">{s.reopenedCount}</td>
                    <td className="py-1 text-right">{s.carryoverCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {sortedTimeInStatus.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("page.report.flowTitle")}</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 text-muted-foreground font-medium">{t("page.report.flowStatus")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.flowAvgDays")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.flowIssues")}</th>
                </tr>
              </thead>
              <tbody>
                {sortedTimeInStatus.slice(0, 6).map((entry: any) => (
                  <tr key={entry.status} className="border-b border-border/50">
                    <td className="py-1 font-medium">{entry.status}</td>
                    <td className="py-1 text-right">{entry.avgDays.toFixed(1)}d</td>
                    <td className="py-1 text-right">{entry.issueCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: sin errores. Si `project.key`/`project.boardType` no existen en el
tipo devuelto por `useGetProject` (confirmar contra el tipo real generado en
`lib/api-client-react`), ajustar a los nombres de campo reales — no inventar
un shape. (El endpoint `GET /projects/:id`, verificado por `curl` en esta
misma sesión, sí devuelve `key` y `boardType` en el JSON — solo falta
confirmar que el tipo generado del cliente los expone igual.)

- [ ] **Step 3: Commit**

```bash
git add artifacts/dashboard/src/pages/project-report.tsx
git commit -m "feat: redesign report tab with editorial layout, bottleneck, next steps and featured issues"
```

---

### Task 8: Regresión completa y verificación visual

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Typecheck completo**

Run: `pnpm run typecheck`
Expected: sin errores en todo el workspace.

- [ ] **Step 2: Test suite backend completo**

Run: `pnpm --filter @workspace/api-server test`
Expected: todos los tests pasan, sin regresiones.

- [ ] **Step 3: Lint**

Run: `pnpm run lint`
Expected: 0 errores, warnings en la línea base (~114) o por debajo.

- [ ] **Step 4: Rebuild y verificación visual**

Run (desde el worktree, reusando el volumen de datos existente — ver
`.superpowers/sdd/2026-08-31-monthly-report-tab/progress.md` de la v1 para
el contexto de por qué se usa `-p agile-metric-hub`):
`docker compose -p agile-metric-hub up -d --build`

Navegar a `/projects/10003/report` (Olimpo, Scrum) y confirmar:
- Masthead con eyebrow `OLP · Scrum · Software`.
- KPI tiles con badge de severidad en Throughput/Cycle Time/Lead Time/Health Score.
- Sección 01 con párrafo por sprint (incluyendo reabiertos/carryover si
  corresponde) + funcionalidades destacadas.
- Sección 02 con nota de alcance + insights existentes.
- Sección 03 con bloqueos ordenados, badge "más antiguo" en el primero, y
  el key del issue visible (confirmar que ya no está vacío — bug de la v1
  corregido en Task 7) + párrafo de cuello de botella si aplica.
- Sección 04 "Próximos pasos" con el ítem de bloqueo más antiguo primero
  (compuesto en frontend) seguido de los ítems del backend.
- Sección 05 (producción) y 06 (sprints, con columnas Reabiertos/Carryover)
  sin cambios de comportamiento respecto a v1.
- Toggle de tema oscuro: confirmar que los nuevos badges/colores siguen
  siendo legibles (no blanco-sobre-blanco / negro-sobre-negro).

Navegar a `/projects/10650/report` (STRIDER AI, Kanban) y confirmar que
sigue sin crashear (regresión del bug arreglado post-v1) y que las
secciones que no aplican (avances por sprint, próximos pasos si no hay
nada que decir) simplemente no aparecen.

- [ ] **Step 5: No commit — verificación final**

Si algo no calza con lo esperado, volver a la tarea correspondiente, no
parchear ad-hoc en este paso.

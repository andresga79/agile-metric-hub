# Filtro por sprint en el resumen del proyecto (Fase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En proyectos Scrum, reemplazar el toggle 1M/3M de la página resumen del
proyecto (`/projects/:id`) por un selector de rango de sprints ("Últimos 2" /
"Últimos 6"), y hacer que el gráfico de throughput trend agrupe por sprint en
vez de por semana calendario. Kanban no cambia.

**Architecture:** Un nuevo helper puro en `lib/jira.ts` resuelve cuántos días
hacia atrás cubren los últimos N sprints **cerrados**; ese número de días se
inyecta en el mismo pipeline de `metrics.ts` que ya existe (sin tocar
`getJiraIssuesForProject`, que sigue recibiendo un `periodDays` como siempre).
Un segundo helper puro arma los buckets del gráfico por sprint en vez de por
semana. El frontend gana un componente compartido que decide qué selector
mostrar según `project.boardType`.

**Tech Stack:** Express 5 + TypeScript (backend), React + Recharts (frontend),
Zod/OpenAPI + Orval (contrato tipado), Vitest (tests).

## Alcance de este plan vs. el spec aprobado

El [spec](../specs/2026-08-10-filtro-por-sprint-design.md) aprueba el cambio
para **todas** las sub-páginas del proyecto. Este plan implementa **solo la
página resumen/Health** (`/projects/:id`, endpoint
`/projects/:projectId/metrics/:period`) como Fase 1 — es la unidad concreta
que disparó el pedido y la más compleja (gráfico con bucketing propio).
Durante la investigación de este plan se confirmó que las 8 rutas restantes
**no son mecánicamente iguales** entre sí: `issues-by-week.ts` usa un query
param con su propio mapa de período (no el path param `:period` ni
`VALID_PERIODS`), `targets.ts` persiste `period` como valor de fila en la base
de datos (no es un filtro de lectura), y `evolution.ts`/`forecast.ts` usan el
período solo indirectamente o no lo usan para ventana de datos. Cada una
necesita su propio análisis antes de poder escribirse sin placeholders — se
va a hacer como un plan de Fase 2 separado una vez que esta fase esté
validada en producción.

## Global Constraints

- Cap global de 90 días de lookback en Jira (`JIRA_MAX_LOOKBACK_DAYS`,
  `capLookbackDays` en `jira.ts`) — no se toca ni se sube; si la ventana de N
  sprints supera 90 días, `getJiraIssuesForProject` la recorta en silencio como
  ya hace hoy para 3M. No es un bug nuevo, es el comportamiento existente.
- `pnpm install --frozen-lockfile` si se tocan dependencias (no aplica en este
  plan — no se agregan dependencias nuevas).
- `pnpm run typecheck` y `pnpm --filter @workspace/api-server test` deben
  pasar limpios antes de cada commit.
- No pushear salvo pedido explícito (política del proyecto, `CLAUDE.md`).
- Kanban (`boardType !== "scrum"`) no cambia de comportamiento en ningún punto
  de este plan.

---

### Task 1: `resolveSprintWindowDays` — días equivalentes a los últimos N sprints cerrados

**Files:**
- Modify: `artifacts/api-server/src/lib/jira.ts` (agregar función nueva, cerca
  de `getJiraSprints`, cualquier punto después de la definición de
  `JiraSprint` en la línea 572)
- Test: `artifacts/api-server/src/lib/__tests__/metrics-logic.test.ts`

**Interfaces:**
- Produces: `export function resolveSprintWindowDays(sprints: JiraSprint[], sprintCount: number): number | null`
  — `null` significa "no hay sprints cerrados todavía, usar el fallback de
  días por defecto" (lo consume Task 3).

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `metrics-logic.test.ts` (reutiliza el `makeSprint` que ya
existe en el archivo, línea 74):

```ts
describe("resolveSprintWindowDays", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const daysAgo = (n: number) => new Date(now - n * DAY).toISOString();

  it("returns null when there are no closed sprints", () => {
    const sprints = [
      makeSprint({ id: 1, name: "Sprint 1", state: "active", startDate: daysAgo(5) }),
    ];
    expect(resolveSprintWindowDays(sprints, 2)).toBeNull();
  });

  it("computes days back to the start of the earliest of the last N closed sprints", () => {
    const sprints = [
      makeSprint({ id: 1, name: "Sprint 1", state: "closed", startDate: daysAgo(60), endDate: daysAgo(46) }),
      makeSprint({ id: 2, name: "Sprint 2", state: "closed", startDate: daysAgo(45), endDate: daysAgo(31) }),
      makeSprint({ id: 3, name: "Sprint 3", state: "closed", startDate: daysAgo(30), endDate: daysAgo(16) }),
      makeSprint({ id: 4, name: "Sprint 4", state: "active", startDate: daysAgo(15) }),
    ];
    // Last 2 CLOSED sprints by end date = Sprint 3 (ends 16d ago) and Sprint 2 (ends 31d ago).
    // Earliest start among those two = Sprint 2's start, 45 days ago.
    const days = resolveSprintWindowDays(sprints, 2);
    expect(days).not.toBeNull();
    expect(days!).toBeGreaterThanOrEqual(44);
    expect(days!).toBeLessThanOrEqual(46);
  });

  it("ignores sprints without a startDate when picking the earliest", () => {
    const sprints = [
      makeSprint({ id: 1, name: "Sprint 1", state: "closed", endDate: daysAgo(40) }), // no startDate
    ];
    expect(resolveSprintWindowDays(sprints, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm --filter @workspace/api-server test -- -t resolveSprintWindowDays`
Expected: FAIL — `resolveSprintWindowDays is not a function` / import error
(todavía no existe ni está exportado).

- [ ] **Step 3: Agregar el import en el test file**

En el bloque de import de `metrics-logic.test.ts` (línea 2-14), agregar
`resolveSprintWindowDays` junto a `isCarryoverIssue`:

```ts
import {
  mapIssueType,
  getEffectiveIssueType,
  isIssueDone,
  isIssueInProgress,
  isQaStatus,
  getStoryPoints,
  findQaRejections,
  computeQaRejectionRate,
  isCarryoverIssue,
  resolveSprintWindowDays,
  type JiraIssue,
  type JiraSprint,
} from "../jira";
```

- [ ] **Step 4: Implementar la función mínima**

En `jira.ts`, después de `isCarryoverIssue` (línea 628):

```ts
/** Days from now back to the start of the earliest sprint among the last
 * `sprintCount` CLOSED sprints (by end date). Returns null when there are no
 * closed sprints, or the earliest candidate has no startDate — callers should
 * fall back to a default day-based window in that case. */
export function resolveSprintWindowDays(
  sprints: JiraSprint[],
  sprintCount: number
): number | null {
  const closed = sprints
    .filter((s) => s.state === "closed")
    .sort((a, b) => (sprintEndTime(b) ?? 0) - (sprintEndTime(a) ?? 0))
    .slice(0, sprintCount);

  if (closed.length === 0) return null;

  const earliest = closed[closed.length - 1];
  if (!earliest.startDate) return null;

  const startMs = new Date(earliest.startDate).getTime();
  if (Number.isNaN(startMs)) return null;

  return Math.max(1, Math.ceil((Date.now() - startMs) / (24 * 60 * 60 * 1000)));
}
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `pnpm --filter @workspace/api-server test -- -t resolveSprintWindowDays`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/lib/jira.ts artifacts/api-server/src/lib/__tests__/metrics-logic.test.ts
git commit -m "feat: add resolveSprintWindowDays to size a metrics window from closed sprints"
```

---

### Task 2: `buildSprintVelocityBuckets` — agrupar throughput por sprint en vez de por semana

**Files:**
- Modify: `artifacts/api-server/src/lib/jira.ts`
- Test: `artifacts/api-server/src/lib/__tests__/metrics-logic.test.ts`

**Interfaces:**
- Consumes: `getStoryPoints(issue: JiraIssue): number` (ya existe en el mismo
  archivo, línea 137)
- Produces: `export function buildSprintVelocityBuckets(resolved: JiraIssue[], resolvedMap: Map<string, Date>, closedSprints: JiraSprint[]): { label: string; value: number }[]`
  — consumido por Task 3 dentro de `buildWeeklyVelocity` en `metrics.ts`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `metrics-logic.test.ts`:

```ts
describe("buildSprintVelocityBuckets", () => {
  it("buckets resolved issues by sprint window, oldest sprint first", () => {
    const sprint1 = makeSprint({ id: 1, name: "Sprint 1", startDate: "2026-06-01T00:00:00.000Z", endDate: "2026-06-14T00:00:00.000Z" });
    const sprint2 = makeSprint({ id: 2, name: "Sprint 2", startDate: "2026-06-15T00:00:00.000Z", endDate: "2026-06-28T00:00:00.000Z" });

    const issueA = makeIssue({ id: "1", key: "A", fields: { customfield_10016: 3 } });
    const issueB = makeIssue({ id: "2", key: "B", fields: { customfield_10016: 5 } });
    const issueC = makeIssue({ id: "3", key: "C", fields: { customfield_10016: 2 } });

    const resolvedMap = new Map<string, Date>([
      ["1", new Date("2026-06-10T00:00:00.000Z")], // falls in sprint1
      ["2", new Date("2026-06-20T00:00:00.000Z")], // falls in sprint2
      ["3", new Date("2026-06-22T00:00:00.000Z")], // falls in sprint2
    ]);

    // Pass sprints out of chronological order to confirm the function re-sorts them.
    const buckets = buildSprintVelocityBuckets([issueA, issueB, issueC], resolvedMap, [sprint2, sprint1]);

    expect(buckets).toEqual([
      { label: "Sprint 1", value: 3 },
      { label: "Sprint 2", value: 7 },
    ]);
  });

  it("gives a sprint with no resolved issues a value of 0", () => {
    const sprint1 = makeSprint({ id: 1, name: "Sprint 1", startDate: "2026-06-01T00:00:00.000Z", endDate: "2026-06-14T00:00:00.000Z" });
    const buckets = buildSprintVelocityBuckets([], new Map(), [sprint1]);
    expect(buckets).toEqual([{ label: "Sprint 1", value: 0 }]);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm --filter @workspace/api-server test -- -t buildSprintVelocityBuckets`
Expected: FAIL — import error, la función no existe todavía.

- [ ] **Step 3: Agregar el import**

Sumar `buildSprintVelocityBuckets` al mismo bloque de import del Task 1, Step 3.

- [ ] **Step 4: Implementar la función mínima**

En `jira.ts`, después de `resolveSprintWindowDays`:

```ts
/** Groups resolved issues into one bucket per sprint (chronological order),
 * summing story points resolved within each sprint's [startDate, endDate]
 * window. Mirrors the shape buildWeeklyVelocity produces for the weekly
 * (kanban / non-sprint-window) case, so the frontend chart doesn't need to
 * know which mode produced the data. */
export function buildSprintVelocityBuckets(
  resolved: JiraIssue[],
  resolvedMap: Map<string, Date>,
  closedSprints: JiraSprint[]
): { label: string; value: number }[] {
  const chronological = [...closedSprints].sort((a, b) => {
    const aStart = a.startDate ? new Date(a.startDate).getTime() : 0;
    const bStart = b.startDate ? new Date(b.startDate).getTime() : 0;
    return aStart - bStart;
  });

  return chronological.map((sprint) => {
    const start = sprint.startDate ? new Date(sprint.startDate).getTime() : -Infinity;
    const endRaw = sprint.endDate ?? sprint.completeDate ?? null;
    const end = endRaw ? new Date(endRaw).getTime() : Infinity;

    const value = resolved.reduce((sum, issue) => {
      const resolvedAt = resolvedMap.get(issue.id);
      if (!resolvedAt) return sum;
      const t = resolvedAt.getTime();
      if (t < start || t > end) return sum;
      return sum + getStoryPoints(issue);
    }, 0);

    return { label: sprint.name, value };
  });
}
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `pnpm --filter @workspace/api-server test -- -t buildSprintVelocityBuckets`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/lib/jira.ts artifacts/api-server/src/lib/__tests__/metrics-logic.test.ts
git commit -m "feat: add buildSprintVelocityBuckets to bucket throughput by sprint"
```

---

### Task 3: Conectar los helpers en la ruta `/projects/:projectId/metrics/:period`

**Files:**
- Modify: `artifacts/api-server/src/routes/metrics.ts`

**Interfaces:**
- Consumes: `resolveSprintWindowDays`, `buildSprintVelocityBuckets` (Task 1/2),
  `getJiraSprints`, `getProjectBoardType`, `periodToDays` (ya importados)
- Produces: la ruta acepta ahora tokens `"1m" | "3m" | "<N>s"` (ej. `"2s"`,
  `"6s"`) en el path param `:period`; el JSON de respuesta cambia el campo
  `week` por `label` dentro de `velocityByWeek` (consumido por Task 5/6 en el
  frontend).

**Nota de secuenciamiento:** hoy `boardType` y `sprints` se piden en paralelo
con `issues` dentro del mismo `Promise.all` (línea 264-271). Para poder decidir
cuántos días de `issues` pedir (según si el request es un rango de sprints),
`boardType`/`sprints` tienen que resolverse **antes** de pedir `issues`. Esto
vuelve secuencial ese único punto (issues espera a boardType+sprints); el resto
del paralelismo (listJiraProjects, portfolioRows, allowedIssueTypes) no cambia.

- [ ] **Step 1: Expandir la validación de período**

Reemplazar en `metrics.ts` (líneas 31-36):

```ts
const VALID_PERIODS = ["1m", "3m"] as const;
type Period = (typeof VALID_PERIODS)[number];

function isValidPeriod(p: string): p is Period {
  return (VALID_PERIODS as readonly string[]).includes(p);
}
```

por:

```ts
const VALID_PERIODS = ["1m", "3m"] as const;
type Period = (typeof VALID_PERIODS)[number];

// "<N>s" = últimos N sprints CERRADOS (solo válido para proyectos Scrum; ver
// resolveSprintWindowDays). Ej: "2s", "6s".
const SPRINT_WINDOW_RE = /^(\d+)s$/;

function isValidPeriod(p: string): boolean {
  return (VALID_PERIODS as readonly string[]).includes(p) || SPRINT_WINDOW_RE.test(p);
}

function parseSprintWindowToken(p: string): number | null {
  const match = SPRINT_WINDOW_RE.exec(p);
  return match ? Number(match[1]) : null;
}
```

- [ ] **Step 2: Actualizar el mensaje de error de validación**

En el handler de la ruta (línea 259-262):

```ts
if (!isValidPeriod(period)) {
  res.status(400).json({ error: "Invalid period. Use 1m, 3m, or Ns (e.g. 2s, 6s) for Scrum projects." });
  return;
}
```

- [ ] **Step 3: Resolver boardType/sprints antes de pedir issues**

Reemplazar el `Promise.all` de las líneas 264-271:

```ts
const [allProjects, issues, boardType, sprints, portfolioRows, allowedIssueTypes] = await Promise.all([
  listJiraProjects(),
  getJiraIssuesForProject(projectId, periodToDays(period), { includeChangelog: true }),
  getProjectBoardType(projectId),
  getJiraSprints(projectId),
  db.select().from(portfolioCacheTable),
  getPortfolioAllowedIssueTypes(),
]);
```

por:

```ts
const [allProjects, boardType, sprints, portfolioRows, allowedIssueTypes] = await Promise.all([
  listJiraProjects(),
  getProjectBoardType(projectId),
  getJiraSprints(projectId),
  db.select().from(portfolioCacheTable),
  getPortfolioAllowedIssueTypes(),
]);

const sprintWindowCount = boardType === "scrum" ? parseSprintWindowToken(period) : null;
const periodDays = sprintWindowCount !== null
  ? resolveSprintWindowDays(sprints, sprintWindowCount) ?? periodToDays("1m")
  : periodToDays(period);

const issues = await getJiraIssuesForProject(projectId, periodDays, { includeChangelog: true });
```

- [ ] **Step 4: Pasar `sprintWindowCount` a `computeMetrics`**

Cambiar la firma de `computeMetrics` (línea 63-70):

```ts
async function computeMetrics(
  issues: JiraIssue[],
  period: Period,
  projectId: string,
  boardType: ProjectBoardType,
  sprints: JiraSprint[],
  allowedIssueTypes: string[]
) {
```

por:

```ts
async function computeMetrics(
  issues: JiraIssue[],
  period: string,
  projectId: string,
  boardType: ProjectBoardType,
  sprints: JiraSprint[],
  allowedIssueTypes: string[],
  sprintWindowCount: number | null
) {
```

(El tipo de `period` pasa de `Period` a `string` porque ahora puede ser un
token `"2s"`/`"6s"` que no pertenece a `VALID_PERIODS`; el valor solo se usa
para el passthrough en la respuesta, no para lógica de branching.)

Y actualizar el call site (línea 319):

```ts
const metrics = await computeMetrics(unique, period, projectId, boardType, sprints, allowedIssueTypes);
```

por:

```ts
const metrics = await computeMetrics(unique, period, projectId, boardType, sprints, allowedIssueTypes, sprintWindowCount);
```

- [ ] **Step 5: Usar `sprintWindowCount` dentro de `computeMetrics` para elegir el bucketing**

Dentro de `computeMetrics`, la línea existente:

```ts
const velocityByWeek = buildWeeklyVelocity(resolved, resolvedMap, periodDays, isScrum);
```

pasa a:

```ts
const velocityByWeek = sprintWindowCount !== null
  ? buildSprintVelocityBuckets(resolved, resolvedMap, completedSprints)
  : buildWeeklyVelocity(resolved, resolvedMap, periodDays, isScrum);
```

(`completedSprints` ya existe más arriba en la misma función, línea 98-101 —
filtra `sprints` por `completeDate >= startDate`, que con el nuevo
`periodDays` calculado en el Step 3 coincide exactamente con los sprints
elegidos por `resolveSprintWindowDays`, así que no hace falta duplicar el
filtro.)

Agregar el import en el bloque de imports de `jira.ts` (línea 2-22):
`resolveSprintWindowDays` y `buildSprintVelocityBuckets` junto a `getJiraSprints`.

- [ ] **Step 6: Renombrar el campo `week` → `label` en `buildWeeklyVelocity`**

En `buildWeeklyVelocity` (línea 194-224), cambiar la firma y el push final:

```ts
function buildWeeklyVelocity(
  resolved: JiraIssue[],
  resolvedMap: Map<string, Date>,
  periodDays: number,
  isScrum: boolean
): { label: string; value: number }[] {
```

y dentro del loop, `result.push({ week: label, value: sp });` pasa a
`result.push({ label, value: sp });` (la variable local sigue llamándose
`label` como hoy, línea 219, solo cambia la clave del objeto).

- [ ] **Step 7: Typecheck**

Run: `pnpm run typecheck`
Expected: sin errores. (Nota: el contrato OpenAPI todavía dice `week` en
`WeeklyDataPoint` — Task 4 lo actualiza; hasta entonces el tipo generado del
cliente puede quedar desalineado, así que este typecheck se corre otra vez al
final del Task 4.)

- [ ] **Step 8: Correr los tests existentes de métricas**

Run: `pnpm --filter @workspace/api-server test`
Expected: los 28 tests previos siguen pasando (no debería haber roto nada, el
cambio es aditivo para kanban/período clásico).

- [ ] **Step 9: Commit**

```bash
git add artifacts/api-server/src/routes/metrics.ts
git commit -m "feat: resolve sprint-based windows and bucket throughput trend by sprint for scrum"
```

---

### Task 4: Contrato OpenAPI + regeneración del cliente tipado

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

**Interfaces:**
- Produces: `getGetProjectMetricsQueryKey`, `useGetProjectMetrics` regenerados
  con el nuevo shape de `WeeklyDataPoint` (`label` en vez de `week`) —
  consumido por Task 6.

- [ ] **Step 1: Renombrar el campo en `WeeklyDataPoint`**

En `lib/api-spec/openapi.yaml` (líneas 988-995):

```yaml
    WeeklyDataPoint:
      type: object
      required: [week, value]
      properties:
        week:
          type: string
        value:
          type: number
```

por:

```yaml
    WeeklyDataPoint:
      type: object
      required: [label, value]
      properties:
        label:
          type: string
          description: "Bucket label — calendar week (kanban / non-sprint window) or sprint name (scrum sprint window)"
        value:
          type: number
```

(Verificado: `WeeklyDataPoint` solo se referencia una vez en todo el spec,
línea 974 (`ProjectMetrics.velocityByWeek`) — este rename no afecta otros
endpoints.)

- [ ] **Step 2: Documentar los nuevos tokens de período en el endpoint de metrics**

En el path `/projects/{projectId}/metrics/{period}` (línea 141), reemplazar el
`$ref` compartido `PeriodPath` (línea 150) por un parámetro inline específico
de este endpoint — **no tocar** el `PeriodPath` compartido (lo referencian 8
endpoints más que no soportan estos tokens todavía):

```yaml
      parameters:
        - $ref: "#/components/parameters/ProjectId"
        - name: period
          in: path
          required: true
          schema:
            type: string
            enum: ["1m", "3m", "2s", "6s"]
          description: >
            Time window. "1m"/"3m" = últimos 30/90 días (kanban, o scrum sin
            selector de sprint). "Ns" = últimos N sprints CERRADOS (solo
            scrum); si el proyecto no tiene sprints cerrados aún, cae a "1m".
```

- [ ] **Step 3: Regenerar el cliente**

Run: `pnpm --filter @workspace/api-spec orval` (o el script equivalente que
usa el proyecto para correr Orval — confirmar el nombre exacto con
`cat lib/api-spec/package.json | grep -A3 '"scripts"'` si el comando de arriba
no existe).
Expected: se regeneran archivos en `lib/api-client-react/src/generated/` con
`label` en vez de `week` para el tipo `WeeklyDataPoint`.

- [ ] **Step 4: Typecheck completo del workspace**

Run: `pnpm run typecheck`
Expected: sin errores. Si el frontend todavía usa `week` en algún lado
(Task 6 no se hizo todavía), va a fallar acá — es esperado, se resuelve en el
Task 6.

- [ ] **Step 5: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated
git commit -m "feat: add sprint-window tokens and rename week to label in the metrics API contract"
```

---

### Task 5: Componente compartido `<TimeWindowFilter>`

**Files:**
- Create: `artifacts/dashboard/src/components/time-window-filter.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type TimeWindow = "1m" | "3m" | "2s" | "6s";
  export function TimeWindowFilter(props: {
    boardType: "scrum" | "kanban" | "simple";
    value: TimeWindow;
    onChange: (value: TimeWindow) => void;
  }): JSX.Element
  ```
  consumido por Task 6 (`project-detail.tsx`).

- [ ] **Step 1: Crear el componente**

```tsx
export type TimeWindow = "1m" | "3m" | "2s" | "6s";

const KANBAN_OPTIONS: { value: TimeWindow; label: string }[] = [
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
];

const SCRUM_OPTIONS: { value: TimeWindow; label: string }[] = [
  { value: "2s", label: "Últimos 2" },
  { value: "6s", label: "Últimos 6" },
];

export function TimeWindowFilter({
  boardType,
  value,
  onChange,
}: {
  boardType: "scrum" | "kanban" | "simple";
  value: TimeWindow;
  onChange: (value: TimeWindow) => void;
}) {
  const options = boardType === "scrum" ? SCRUM_OPTIONS : KANBAN_OPTIONS;

  return (
    <div className="flex bg-background border border-border rounded-md p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${
            value === opt.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
```

(Estilo copiado 1:1 del toggle existente en `project-detail.tsx:194-206` para
no introducir un cambio visual — solo se extrae y se parametriza.)

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: sin errores (componente nuevo, todavía nadie lo importa).

- [ ] **Step 3: Commit**

```bash
git add artifacts/dashboard/src/components/time-window-filter.tsx
git commit -m "feat: add shared TimeWindowFilter component (month toggle for kanban, sprint range for scrum)"
```

---

### Task 6: Conectar `project-detail.tsx` al nuevo filtro

**Files:**
- Modify: `artifacts/dashboard/src/pages/project-detail.tsx`

**Interfaces:**
- Consumes: `TimeWindowFilter`, `type TimeWindow` (Task 5)

- [ ] **Step 1: Reemplazar el tipo local `Period` y el estado**

Borrar la línea 15 (`type Period = "1m" | "3m";`) y el import correspondiente
no hace falta (no había import, era un tipo local). Agregar el import del
componente compartido junto a los demás imports (línea 13):

```tsx
import { TimeWindowFilter, type TimeWindow } from "@/components/time-window-filter";
```

Cambiar la línea 44:

```tsx
const [period, setPeriod] = useState<Period>("1m");
```

por:

```tsx
const [period, setPeriod] = useState<TimeWindow>("1m");
```

- [ ] **Step 2: Reemplazar el toggle inline por el componente compartido**

Reemplazar el bloque de las líneas 194-206:

```tsx
<div className="flex bg-background border border-border rounded-md p-1">
  {(['1m', '3m'] as Period[]).map((p) => (
    <button
      key={p}
      onClick={() => setPeriod(p)}
      className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${
        period === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {p.toUpperCase()}
    </button>
  ))}
</div>
```

por:

```tsx
<TimeWindowFilter
  boardType={project?.boardType ?? "kanban"}
  value={period}
  onChange={setPeriod}
/>
```

- [ ] **Step 3: Reiniciar `period` a un valor válido cuando cambia el board type**

Como el proyecto se carga async (`loadingProject`), el default `"1m"` es
válido para ambos board types así que no hace falta un `useEffect` de reset —
"1m" sigue siendo una opción válida incluso para scrum (fallback cuando no hay
sprints cerrados, ver Task 3). No se agrega código extra acá.

- [ ] **Step 4: Actualizar el tipo de `sparklineData` en `MetricCard`**

En la firma de `MetricCard` (línea 367):

```tsx
sparklineData?: { week: string; value: number }[];
```

por:

```tsx
sparklineData?: { label: string; value: number }[];
```

- [ ] **Step 5: Actualizar el `dataKey` del eje X del gráfico grande**

En el `AreaChart` de las líneas 256-273, la línea:

```tsx
<XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
```

pasa a:

```tsx
<XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
```

- [ ] **Step 6: Typecheck**

Run: `pnpm run typecheck`
Expected: sin errores en `artifacts/dashboard`.

- [ ] **Step 7: Commit**

```bash
git add artifacts/dashboard/src/pages/project-detail.tsx
git commit -m "feat: wire project summary page to the sprint-range filter for scrum projects"
```

---

### Task 7: Verificación end-to-end y cierre

**Files:** ninguno (solo verificación manual, sin cambios de código)

- [ ] **Step 1: Rebuild completo**

Run: `docker compose up -d --build`
Expected: los 3 contenedores (`agile_metrics_api`, `agile_metrics_web`,
`agile_metrics_db`) arrancan sin error. `curl localhost:8000/api/healthz` →
`{"status":"ok"}`.

- [ ] **Step 2: Verificar el proyecto scrum (10003) con curl**

Con un token real (`TOKEN`, obtenido vía login):

```bash
curl -s localhost:8000/api/projects/10003/metrics/2s -H "Authorization: Bearer $TOKEN" | jq '.velocityByWeek, .boardType, .isScrum'
```

Expected: `boardType: "scrum"`, `isScrum: true`, `velocityByWeek` con como
máximo 2 elementos, cada uno `{ label: "Sprint N", value: <story points> }`
(no fechas de semana).

- [ ] **Step 3: Verificar el proyecto kanban (10013) de control con curl**

```bash
curl -s localhost:8000/api/projects/10013/metrics/1m -H "Authorization: Bearer $TOKEN" | jq '.velocityByWeek, .boardType'
```

Expected: `boardType: "kanban"`, `velocityByWeek` con `label` siendo fechas
tipo "Aug 3" (formato semanal sin cambios respecto a antes del plan).

- [ ] **Step 4: Verificar el caso borde — proyecto scrum sin sprints cerrados**

Si no hay un proyecto real en ese estado, simular con
`curl -s localhost:8000/api/projects/10003/metrics/6s ...` con un
`sprintCount` mayor a los sprints cerrados disponibles y confirmar que
`resolveSprintWindowDays` no devuelve un array vacío sorpresivo — debería
devolver todos los sprints cerrados disponibles (esto ya lo cubre el
`.slice(0, sprintCount)`, que no falla si `sprintCount` > longitud).

- [ ] **Step 5: Confirmar visualmente en el navegador**

Abrir `http://localhost/projects/10003`. Confirmar:
- El selector muestra "Últimos 2" / "Últimos 6" (no "1M"/"3M").
- El gráfico de throughput trend tiene sprints en el eje X (nombres tipo
  "Sprint 42"), no fechas de semana.
- Cambiar entre "Últimos 2" y "Últimos 6" actualiza el gráfico.
- Abrir `http://localhost/projects/10013` (kanban) y confirmar que el
  selector sigue mostrando "1M"/"3M" y el gráfico sigue por semana, sin
  cambios visuales.

- [ ] **Step 6: Correr la suite completa una última vez**

Run: `pnpm run typecheck && pnpm run lint && pnpm --filter @workspace/api-server test`
Expected: typecheck limpio, lint en el baseline conocido (0 errores), todos
los tests pasan.

- [ ] **Step 7: Actualizar `SESSION_LOG.md`**

Agregar una entrada nueva (siguiente número de sección) documentando: qué se
cambió, los commits, y que el alcance de esta fase fue **solo la página
resumen/Health** — las 8 sub-páginas restantes (team, analytics, issues,
targets, blocked-KPI, QA rejected, report) quedan para una Fase 2 con su
propio plan, porque cada una tiene una variación distinta del filtro period
(algunas usan query param en vez de path param, `targets.ts` persiste
`period` como valor de fila en la base de datos, `evolution.ts`/`forecast.ts`
usan el período solo indirectamente y quedan fuera de alcance por diseño —
ver la sección "Fuera de alcance" del spec).

```bash
git add SESSION_LOG.md
git commit -m "docs: log Fase 1 del filtro por sprint (resumen del proyecto)"
```

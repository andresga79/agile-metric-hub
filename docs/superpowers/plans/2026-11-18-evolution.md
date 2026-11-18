# Evolución por sprint e informe anual 2026 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pestaña "Evolución" (Scrum) con métricas por sprint/mes/trimestre de 2026 desde filas guardadas e inmutables, hitos y bloque antes/después; backfill único de OLP desde el 2026-01-01.

**Architecture:** Funciones puras en `lib/evolution.ts` (asignación de entregas a sprints, percentiles con n mínimo, agregados, comparación por hito). Un servicio `lib/evolution-service.ts` junta Jira (alcance por sprint vía `getSprintIssuesOrThrow` + `computeSprintMetrics`; entregados por rango absoluto con changelog) y persiste en tres tablas nuevas vía `lib/evolution-store.ts`. Rutas: lectura por proyecto, hitos, y admin (backfill, congelar). El sync diario guarda los sprints recién cerrados. Frontend: página nueva con recharts y hook generado por orval.

**Tech Stack:** Express 5, TypeScript, Drizzle + Postgres (bootstrap `CREATE TABLE IF NOT EXISTS` en `api-server/src/index.ts`), vitest, OpenAPI + orval (`lib/api-spec`), React + react-query + recharts, i18n `artifacts/dashboard/src/i18n/locales/{es,en}.json`.

**Spec:** `docs/superpowers/specs/2026-11-18-evolution-design.md`

## Global Constraints

- Reglas de cada número = las de la tabla §4.1 de la spec; **no** se escriben reglas nuevas: alcance y % real/Rovo salen de `computeSprintMetrics` (`routes/sprint-metrics.ts`), entregas de `getDeliveryDate`, tiempos de `getLeadTimeDays` / `getCycleTimeDays`, tipos de `getPortfolioAllowedIssueTypes` + `getEffectiveIssueType`.
- Ventana de un sprint = `[startDate, completeDate ?? endDate)` (igual que `buildSprintVelocityBuckets`). Solo sprints `state === "closed"`.
- Sprint propio del proyecto ⇔ `sprint.originBoardId === getBoardId(projectId)`; sprints sin `originBoardId` cuentan como propios. Orden siempre por cierre, nunca por nombre.
- Percentiles con `percentileRounded` (`lib/stats.ts`, 1 decimal). P50 `null` si n < 3; P85 `null` si n < 5; promedio `null` si n = 0.
- Unidad principal issues; SP secundario. `ctN` (entregados con cycle time) siempre aparte de `delivered`.
- Mes/trimestre en zona **`America/Santiago`** sobre `delivered_at` (entregas) y `closed_at` (sprints).
- `FORMULA_VERSION = 1` (constante exportada de `lib/evolution.ts`).
- Filas con `frozen_at` no se reescriben nunca (ni backfill ni sync).
- Backfill de a **un sprint por vez**; un sprint que falla detiene el backfill y se informa: nunca se escribe una fila vacía.
- Lenguaje de UI: "desde el hito", nunca causal. Rovo siempre rotulado como referencia.
- Lectura gateada con `requireSectionView("sprints")`; escritura (backfill, freeze, hitos) solo admin (router `/admin` o `requireAdmin`). Solo Scrum (400 si no).
- Tablas nuevas: `CREATE TABLE IF NOT EXISTS` + schema Drizzle; sin `drizzle-kit push`; no se toca `metric_snapshots`.
- Al agregar campos a respuestas existentes no se quitan los viejos.
- Antes de cada commit: `pnpm run typecheck`, `pnpm --filter @workspace/api-server test`, `pnpm run lint` (0 errores, warnings ≤ 112).
- No pushear. Mensajes de commit con el porqué y terminados en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Entrega justo en el borde** (entregada en el instante exacto del cierre de un sprint y del inicio del siguiente, o en el hueco de fin de semana entre sprints) → cuenta en un solo sprint (el que la contiene en `[start, close)`) o en ninguno (`sprintId = null`), nunca en dos; sigue contando en su mes. *(test en Task 1)*
2. **Sprint compartido entre tableros** (OLI/ORINI "Tablero Sprint 42", originBoardId 15) → aparece en OLI y no en ORINI. *(test en Task 1)*
3. **Re-correr el backfill** sobre filas ya congeladas o ya guardadas → no duplica (upsert por clave única) y no toca congeladas. *(test en Task 2)*
4. **Jira falla a mitad del backfill** (sprint 5 de 23) → los 4 anteriores quedan guardados, el 5 no se escribe, la respuesta dice cuál falló y por qué. *(test en Task 3)*
5. **Hito en el primer sprint del año o posterior al último** → el lado vacío de la comparación vuelve con n = 0 y valores `null`; la UI muestra "—", no 0. *(test en Task 1, verificación visual en Task 5)*

---

### Task 1: Cálculo puro `lib/evolution.ts`

**Files:**
- Create: `artifacts/api-server/src/lib/evolution.ts`
- Modify: `artifacts/api-server/src/lib/jira.ts:792` (agregar `originBoardId?: number` a `JiraSprint`)
- Test: `artifacts/api-server/src/lib/__tests__/evolution.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const FORMULA_VERSION = 1;
  export interface EvolutionDelivery { issueKey: string; issueType: string; deliveredAt: Date;
    leadDays: number | null; cycleDays: number | null; storyPoints: number; assigneeId: string | null;
    sprintId: number | null; }
  export interface SprintWindow { sprintId: number; start: Date; close: Date; }
  export interface TimeSummary { n: number; p50: number | null; p85: number | null; avg: number | null; }
  export interface EvolutionSprintRow { projectId: string; sprintId: number; sprintName: string;
    startAt: Date; closedAt: Date;
    scopeIssues: number; scopeSp: number; plannedIssues: number; addedIssues: number; carryoverIssues: number;
    closedAtEndIssues: number; closedAtEndSp: number; realClosedPct: number | null; rovoPct: number;
    delivered: number; deliveredSp: number; people: number;
    ct: TimeSummary; lt: TimeSummary; formulaVersion: number; }
  export interface PeriodRow { period: string /* "2026-04" | "2026-Q2" */; sprints: number;
    realClosedPct: number | null; delivered: number; deliveredSp: number; people: number;
    ct: TimeSummary; lt: TimeSummary; }
  export interface ComparisonSide { sprints: number; realClosedMean: number | null; realClosedStdevPp: number | null;
    ctP85: number | null; ctN: number; ltP50: number | null; ltN: number; deliveredPerPersonPerSprint: number | null; }
  export function summarizeTimes(values: number[]): TimeSummary;
  export function assignDeliverySprint(deliveredAt: Date, windows: SprintWindow[]): number | null;
  export function ownSprints<T extends { originBoardId?: number }>(sprints: T[], boardId: number | null): T[];
  export function buildSprintRow(projectId: string, sprint: JiraSprint, metric: SprintMetric,
    deliveries: EvolutionDelivery[]): EvolutionSprintRow;   // deliveries ya filtradas a ese sprintId
  export function aggregateByPeriod(rows: EvolutionSprintRow[], deliveries: EvolutionDelivery[],
    by: "month" | "quarter"): PeriodRow[];
  export function compareAroundMilestone(rows: EvolutionSprintRow[], deliveries: EvolutionDelivery[],
    milestoneSprintStart: Date): { before: ComparisonSide; after: ComparisonSide };
  ```

- [ ] **Step 1: Write the failing tests** (`evolution.test.ts`, `describe` por función):
  - `summarizeTimes([])` → `{ n: 0, p50: null, p85: null, avg: null }`; `[4, 2]` → `p50: null, p85: null, avg: 3`; `[1,2,3]` → `p50: 2, p85: null`; `[1,2,3,4,10]` → `p50: 3, p85: 4`, `n: 5`.
  - `assignDeliverySprint`: windows `A=[2026-11-02T13:00Z, 2026-11-16T13:00Z)`, `B=[2026-11-16T13:31Z, 2026-11-27T21:00Z)`; entrega `2026-11-16T13:00Z` → `null` (borde exclusivo, hueco); `2026-11-16T13:31Z` → B; `2026-11-10` → A; `2026-12-30` → `null`.
  - `ownSprints`: sprints `[{id:4263, originBoardId:15}, {id:4267, originBoardId:1350}, {id:9}]` con boardId `1350` → ids `[4267, 9]`; con boardId `null` → los tres.
  - `buildSprintRow`: con un `SprintMetric` de prueba (`closedAtSprintEndIssues: 22`, `totalIssues: 38`, `closedAtSprintEndRate: 53`, `completionRate: 100`, `plannedIssues: 16`, `addedAfterPlanningCount: 22`, `carryoverCount: 14`) → `realClosedPct` = **22/38·100 redondeado a 1 decimal (57.9)** (issues, no SP), `rovoPct: 100`; 3 entregas de 2 asignados con cycle `[1, null, 3]` → `delivered: 3`, `people: 2`, `ct.n: 2`, `lt.n: 3`.
  - `aggregateByPeriod(by:"month")`: entrega `2026-05-01T02:00Z` cae en **"2026-04"** (Santiago, UTC-4); dos sprints con `realClosedPct` 50 y 70 que cierran en "2026-09" → `realClosedPct: 60`, `sprints: 2`; `by:"quarter"` etiqueta `"2026-Q2"`.
  - `compareAroundMilestone`: 3 filas antes (real 16, 50, 67) y 2 después (70, 76) → `before.sprints: 3`, `before.realClosedMean: 44.3`, `after.realClosedMean: 73`; `realClosedStdevPp` = desvío muestral redondeado a 1 decimal; hito anterior a todas las filas → `before` con `sprints: 0` y todos los valores `null`, `ctN: 0`.
- [ ] **Step 2: Run** `pnpm --filter @workspace/api-server test -- evolution` → FAIL (módulo no existe).
- [ ] **Step 3: Implement** las funciones en `lib/evolution.ts`. Mes en Santiago con `Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit" })`. `realClosedPct` de la fila = `closedAtSprintEndIssues / totalIssues` (issues; `null` si `totalIssues = 0`). Comparación: `before` = filas con `startAt < milestoneSprintStart`, `after` = el resto; tiempos agrupados sobre las entregas con `sprintId` de cada lado (no promedio de percentiles); `deliveredPerPersonPerSprint` = media de `delivered/people` sobre filas con `people > 0`.
- [ ] **Step 4: Run** el mismo comando → PASS; `pnpm run typecheck` → sin errores.
- [ ] **Step 5: Commit** `feat(evolution): pure per-sprint/period calculation and milestone comparison`.

### Task 2: Tablas y store `lib/evolution-store.ts`

**Files:**
- Create: `lib/db/src/schema/evolution.ts` (exportado desde `lib/db/src/schema/index.ts`)
- Modify: `artifacts/api-server/src/index.ts` (bootstrap, después de `metric_snapshots`, ~línea 164)
- Create: `artifacts/api-server/src/lib/evolution-store.ts`
- Test: `artifacts/api-server/src/lib/__tests__/evolution-store.test.ts`

**Interfaces:**
- Consumes: `EvolutionSprintRow`, `EvolutionDelivery`, `FORMULA_VERSION` (Task 1).
- Produces:
  ```ts
  // Tablas: evolution_sprints (UNIQUE project_id, sprint_id), evolution_deliveries (UNIQUE project_id, issue_key),
  // project_milestones (id serial). Columnas = campos de EvolutionSprintRow / EvolutionDelivery en snake_case
  // (TimeSummary aplanado: ct_n, ct_p50, ct_p85, ct_avg, lt_n, ...) + source TEXT ('backfill'|'on_close'),
  // computed_at, frozen_at NULL. project_milestones: project_id, sprint_id INT NULL, label, kind, note, created_by, created_at.
  export function toSprintRecord(row: EvolutionSprintRow, source: "backfill" | "on_close"): NewEvolutionSprint;
  export function fromSprintRecord(r: EvolutionSprint): EvolutionSprintRow;
  export async function upsertSprintRow(row: EvolutionSprintRow, source: "backfill" | "on_close"): Promise<"written" | "frozen">;
  export async function upsertDeliveries(projectId: string, ds: EvolutionDelivery[]): Promise<{ written: number; frozen: number }>;
  export async function readEvolution(projectId: string, from: Date, to: Date):
    Promise<{ rows: EvolutionSprintRow[]; deliveries: EvolutionDelivery[]; reconstructedAt: Date | null; frozenUntil: Date | null }>;
  export async function storedSprintIds(projectId: string): Promise<Set<number>>;
  export async function freezeUntil(projectId: string, until: Date): Promise<{ sprints: number; deliveries: number }>;
  export async function listMilestones(projectId: string): Promise<Milestone[]>;
  export async function addMilestone(m: NewMilestone): Promise<Milestone>;
  export async function deleteMilestone(projectId: string, id: number): Promise<boolean>;
  ```
- [ ] **Step 1: Write the failing tests** (puros, sin base): `toSprintRecord` → `fromSprintRecord` devuelve la misma fila (ida y vuelta, incluidos `null` en p50/p85); `toSprintRecord` pone `formula_version = FORMULA_VERSION` y `source`.
- [ ] **Step 2: Run** `pnpm --filter @workspace/api-server test -- evolution-store` → FAIL.
- [ ] **Step 3: Implement** schema, bootstrap y store. Upserts con `ON CONFLICT (...) DO UPDATE ... WHERE <tabla>.frozen_at IS NULL` (así congeladas nunca cambian); `upsertSprintRow` devuelve `"frozen"` si la fila existente está congelada.
- [ ] **Step 4: Run** tests → PASS; `docker compose up -d --build api` y comprobar con `psql` que existen las 3 tablas y que un upsert doble deja 1 fila (Review Focus 3).
- [ ] **Step 5: Commit** `feat(evolution): persisted per-sprint and per-delivery rows, milestones`.

### Task 3: Servicio de backfill y guardado al cierre

**Files:**
- Modify: `artifacts/api-server/src/lib/jira.ts` (nueva `getResolvedJiraIssuesBetween(projectId, from: Date, toExclusive: Date, { includeChangelog })` — mismo JQL y caché versionado que `getResolvedJiraIssuesInRange` (~línea 1930), clave `issues:<id>:between:v1:<fromISO>-<toISO>:changelog`; lanza en vez de devolver mock si Jira está configurado y falla)
- Create: `artifacts/api-server/src/lib/evolution-service.ts`
- Modify: `artifacts/api-server/src/lib/jira-cache.ts` (al final de `executeSync`, tras el portfolio, ~línea 273: `snapshotClosedSprints` para cada proyecto Scrum visible, en serie, con errores logueados y sumados a `syncFailedProjects`)
- Test: `artifacts/api-server/src/lib/__tests__/evolution-service.test.ts`

**Interfaces:**
- Consumes: Task 1 (`ownSprints`, `assignDeliverySprint`, `buildSprintRow`), Task 2 (`upsertSprintRow`, `upsertDeliveries`, `storedSprintIds`), `computeSprintMetrics` / `sprintScopeIssues` (`routes/sprint-metrics.ts`), `getSprintIssuesOrThrow`, `getJiraSprintsOrThrow`, `getBoardId`.
- Produces:
  ```ts
  export interface EvolutionDeps { /* las funciones de Jira y del store de arriba, inyectables para tests */ }
  export interface BackfillResult { projectId: string; written: number; frozen: number; skipped: number;
    failed: { sprintId: number; sprintName: string; error: string } | null; }
  export async function backfillProject(projectId: string, from: Date, deps?: EvolutionDeps): Promise<BackfillResult>;
  export async function snapshotClosedSprints(projectId: string, deps?: EvolutionDeps): Promise<BackfillResult>; // solo sprints sin fila
  ```
- [ ] **Step 1: Write the failing tests** con deps stubeadas (2 sprints propios + 1 ajeno, issues de prueba):
  - backfill escribe 2 filas (el ajeno no), en orden de cierre, `source: "backfill"`; las entregas llevan el `sprintId` de su ventana.
  - el sprint 2 de 3 lanza en `getSprintIssues` → `written: 1`, `failed.sprintId` = el 2, el 3 no se intenta, ninguna fila del 2 (Review Focus 4).
  - `snapshotClosedSprints` con el sprint 1 ya guardado → solo calcula el 2, `source: "on_close"`.
  - sprint con cierre anterior a `from` → no se procesa.
- [ ] **Step 2: Run** `pnpm --filter @workspace/api-server test -- evolution-service` → FAIL.
- [ ] **Step 3: Implement.** Por sprint: `getSprintIssuesOrThrow(id)` → `computeSprintMetrics(sprint, issues, allowedTypes, allSprints)`; entregas = `getResolvedJiraIssuesBetween(project, start, close, {includeChangelog:true})` filtradas por tipos permitidos y `getDeliveryDate !== null`, con `getLeadTimeDays` / `getCycleTimeDays`; `buildSprintRow`; persistir fila y entregas. Entregas fuera de toda ventana (huecos entre sprints) se guardan con `sprintId: null` en una pasada final por rango `[from, último cierre)`, para que los meses estén completos.
- [ ] **Step 4: Run** tests → PASS; suite completa verde.
- [ ] **Step 5: Commit** `feat(evolution): one-sprint-at-a-time backfill and snapshot on sprint close`.

### Task 4: Rutas y contrato

**Files:**
- Create: `artifacts/api-server/src/routes/evolution.ts`; registrar en `routes/index.ts`
- Create: `artifacts/api-server/src/routes/admin/evolution.ts`; registrar en `routes/admin.ts` (junto a `portfolioAdminRouter`)
- Modify: `lib/api-spec/openapi.yaml` (paths + schemas `Evolution*`, `Milestone*`), luego `pnpm --filter @workspace/api-spec codegen`
- Test: `artifacts/api-server/src/routes/__tests__/evolution.test.ts` (validación de query)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces (HTTP):
  - `GET /api/projects/:projectId/evolution?from=2026-01-01&to=2026-12-31&by=sprint|month|quarter&compare=<milestoneId>` → `{ by, rows: EvolutionSprintRow[] | PeriodRow[], milestones: Milestone[], comparison: { milestoneId, before: ComparisonSide, after: ComparisonSide } | null, meta: { formulaVersion, reconstructedAt, frozenUntil } }`. `by` inválido o fechas inválidas → 400; Kanban → 400. Lectura `requireSectionView("sprints")`.
  - `GET /api/projects/:projectId/milestones` (lectura `sprints`); `POST` `{ sprintId, label, kind, note? }` y `DELETE /:id` solo admin.
  - `POST /api/admin/evolution/backfill { projectId, from }` → `BackfillResult` (200 aunque `failed` venga lleno: el cliente lo muestra).
  - `POST /api/admin/evolution/freeze { projectId, until }` → `{ sprints, deliveries }`.
  - Hooks orval: `useGetProjectEvolution`, `useListProjectMilestones`, `useCreateProjectMilestone`, `useDeleteProjectMilestone`, `useRunEvolutionBackfill`.
- [ ] **Step 1: Write the failing test** de un parser exportado `parseEvolutionQuery(query)` → `{ from, to, by, compare }`: defaults `from = 2026-01-01`, `to = 2026-12-31`, `by = "sprint"`; `by=week` → error; `from > to` → error.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** rutas, contrato y codegen.
- [ ] **Step 4: Run** tests + typecheck → PASS. Rebuild (`docker compose up -d --build`) y `curl` con token: `GET .../10003/evolution` → 200 con `rows: []` antes del backfill; `GET .../10650/evolution` (Kanban) → 400; `POST /api/admin/evolution/backfill` como member → 403.
- [ ] **Step 5: Commit** `feat(evolution): read, milestone and admin backfill/freeze endpoints`.

### Task 5: Pestaña "Evolución"

**Files:**
- Create: `artifacts/dashboard/src/pages/project-evolution.tsx`
- Create: `artifacts/dashboard/src/lib/evolution-csv.ts` (+ test si el dashboard tiene vitest; si no, función pura simple)
- Modify: `artifacts/dashboard/src/App.tsx` (ruta `/projects/:projectId/evolution`, junto a `/sprints`)
- Modify: `artifacts/dashboard/src/components/project-tabs.tsx` (tab primaria `evolution` después de `delivery` en `PRIMARY_ORDER`; visible solo si `boardType === "scrum"` y `canAccessSection(role, "sprints")`)
- Modify: `artifacts/dashboard/src/i18n/locales/es.json`, `en.json` (`nav.evolution`, `page.evolution.*`)

**Interfaces:**
- Consumes: hooks de Task 4.

- [ ] **Step 1: Implement** la página según spec §4.6, en este orden:
  1. Selector de corte Sprint | Mes | Trimestre (año fijo 2026 con selector preparado) y selector de hito (default: el primero de tipo `rol`).
  2. Bloque antes/después: 4 métricas (`realClosedMean` ± `realClosedStdevPp`, `ctP85`, `ltP50`, `deliveredPerPersonPerSprint`) con n de cada lado; `null` → "—"; texto "desde el hito «label»".
  3. % real cerrado (barras) + Rovo (línea punteada, leyenda "Rovo (referencia)", tooltip `page.evolution.rovoNote` = "Rovo cuenta lo terminado después del cierre; en sprints viejos tiende a 100 %").
  4. CT P50/P85 y LT P50/P85: `LineChart` con `YAxis scale="log" domain={["auto","auto"]}` y `connectNulls={false}`; línea de meta desde `metrics.timeTargets` si existe.
  5. Entregados por sprint (barras, issues), personas en el tooltip.
  6. Hitos como `ReferenceLine x=<sprintName|period>` con etiqueta, en todos los gráficos.
  7. Tabla con las columnas de spec §4.6 y botón "Exportar CSV" (`evolution-csv.ts`, separador `;`, decimales con coma).
  8. Pie con `meta`: "Fuente: Jira · regla v{formulaVersion} · reconstruido el dd/mm · congelado hasta dd/mm".
  9. Estados: `isError` → "No se pudo cargar la evolución"; `rows: []` sin error → "Todavía no hay datos guardados; un admin debe correr la reconstrucción" con botón **Reconstruir 2026** solo para admin (`useRunEvolutionBackfill`), que muestra `failed` si viene.
  10. Admin: alta/baja de hitos (sprint, etiqueta, tipo) en la misma página.
- [ ] **Step 2: Verify** `pnpm run typecheck` y `pnpm run lint` (≤ 112 warnings); rebuild; en el navegador con OLP: la pestaña aparece en OLP y no en EXP; con la base vacía se ve el estado vacío y el botón (admin), no un error.
- [ ] **Step 3: Commit** `feat(evolution): Evolución tab with milestones, before/after, charts and CSV`.

### Task 6: Backfill real de OLP, verificación y documentación

**Files:**
- Modify: `METRICS.md` (sección nueva "Evolución": reglas §4.1, n mínimos, Santiago, inmutabilidad; corregir §Sprints/Capacity líneas ~90-94: una limpieza hecha después del cierre **sale** del alcance — es lo que hace el código)
- Modify: `CLAUDE.md` ("Run & Operate": conteo real de tests; "Architecture decisions": una línea sobre Evolución inmutable y % real como principal)
- Modify: memoria del proyecto (`project_evolution_2026.md`): estado y resultado de la verificación

- [ ] **Step 1:** Botón "Reconstruir 2026" (o `curl POST /api/admin/evolution/backfill {"projectId":"10003","from":"2026-01-01"}`) → `failed: null`, `written` = sprints de OLP cerrados en 2026 (96 → 118 = 23). Cargar hito "Llegada SM — Sprint 111" (`kind: "rol"`).
- [ ] **Step 2: Verify contra Sprints** — `curl /api/projects/10003/sprints/6s` vs `/evolution`: para 113–118, `scopeIssues = totalIssues`, `closedAtEndIssues = closedAtSprintEndIssues`, `rovoPct = completionRate` exactos; `ct.p50` = `medianCycleTimeDays` (diferencia ≤ 0,1 por redondeo). Cualquier diferencia mayor se explica o se corrige antes de seguir.
- [ ] **Step 3: Verify contra Jira/Rovo** — conector Rovo `sprint = <id>` (conteo total y `statusCategory = Done`) en 3 sprints (uno por trimestre, p. ej. 99, 106, 113): igual a alcance/Done hoy de la fila, menos los excluidos por tipo/limpieza, que se listan.
- [ ] **Step 4: Verify vs análisis preliminar** (`olp_year.json` del 2026-11-18): explicar diferencias (limpiezas de backlog excluidas, tipos filtrados). Anotar el antes/después final (100–110 vs 111–118) en la memoria.
- [ ] **Step 5:** Navegador: tabla, gráficos, hito en 111, CSV abre bien en Excel/Sheets.
- [ ] **Step 6:** Actualizar `METRICS.md`, `CLAUDE.md`, memoria; typecheck/tests/lint.
- [ ] **Step 7: Commit** `docs(evolution): formulas, verification against Sprints and Jira`.

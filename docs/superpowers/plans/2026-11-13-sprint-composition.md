# Composición del sprint por tipo de trabajo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar "Resumen de sprint" por una tarjeta "Composición del sprint" (Últimos 2 / 6 sprints cerrados) en Sprints y agregar "Mezcla esperada" en Capacidad.

**Architecture:** Una función pura `buildSprintComposition` en `api-server/src/lib/sprint-composition.ts` hace todo el cálculo; un endpoint nuevo `GET /projects/:projectId/sprint-composition/:window` junta los datos de Jira (issues por sprint + entregados por fecha para cycle time) y la llama. El frontend consume el hook generado por orval en dos lugares: la tarjeta de Sprints y una línea en Capacidad. El Resumen de sprint (front + back + contrato) se borra.

**Tech Stack:** Express 5, TypeScript, vitest, OpenAPI + orval (`lib/api-spec`), React + react-query + recharts, i18n con claves planas en `artifacts/dashboard/src/i18n/locales/{es,en}.json`.

**Spec:** `docs/superpowers/specs/2026-11-13-sprint-composition-design.md`

## Global Constraints

- Ventanas: solo `2s` y `6s` = últimos 2 / 6 sprints **cerrados**; el activo nunca entra. Otro valor → 400.
- Alcance de issues por sprint: tipos habilitados en Admin (`getPortfolioAllowedIssueTypes`) + `key.startsWith(projectKey + "-")` + fuera los `isNonDeliveryClosure` que ya están Done (misma regla que `sprintScopeIssues` / `loadSprintIssues`).
- Categorías por `getEffectiveIssueType`; orden fijo de filas: `Story, Bug, Task, Spike, Tech Debt`, después cualquier otro tipo habilitado en orden alfabético. Etiquetas: Historia (HU), Hotfix (Error), Tarea, Spike, Deuda técnica.
- "% real cerrado" por **issues**, pooled sobre la ventana, con `wasIssueDoneAt(issue, sprintCloseTime(sprint), categoryMap)`.
- Cycle P50/P85: issues de la categoría entregados (`getDeliveryDate`) dentro de `[startDate, completeDate ?? endDate)` de algún sprint cerrado de la ventana; menos de 3 → `null` ("—"). Redondeo a 1 decimal (`percentileRounded`).
- "Entró a mitad": `isAddedAfterPlanning(issue, sprint)`.
- Categoría sin issues en la ventana: no aparece.
- Mezcla esperada: punto medio de `recommendation.range.issues` × `issueShare/100` de Últimos 6, redondeado; margen hotfix = `addedAfterPlanningPerSprint` de la fila `Bug`, solo si ≥ 1; sin `recommendation` no se muestra nada.
- Lectura gateada con `requireSectionView("sprints", "capacity")`; solo proyectos Scrum (400 si no).
- Textos en español en `es.json` con su par en `en.json`.
- Antes de cada commit: `pnpm run typecheck`, `pnpm --filter @workspace/api-server test`, `pnpm run lint` (0 errores, warnings ≤ 113).
- No pushear. Cada mensaje de commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Ventana con menos sprints cerrados que los pedidos** (equipo nuevo con 1 sprint, pide `6s`) → devuelve lo que hay, `sprintCount` refleja el número real, la UI dice "N sprints"; 0 sprints cerrados → `rows: []` y la tarjeta muestra estado vacío, no un error. *(test en Task 1)*
2. **Sprint cerrado sin issues en el alcance** (todo cancelado) → cuenta en el promedio por sprint como 0, no divide por cero ni lo saltea en silencio. *(test en Task 1)*
3. **Issue arrastrado** presente en 2 sprints de la ventana → cuenta en la composición de ambos (membresía por sprint) pero su cycle time una sola vez. *(test en Task 1)*
4. **Categoría con issues pero sin entregados** (o < 3) → P50/P85 `null`, la fila sigue apareciendo. *(test en Task 1)*
5. **Redondeo de la mezcla** que no suma exactamente el punto medio (p. ej. 20 × [58, 24, 12, 4, 2] %) → se muestra con "~" y se omiten categorías que redondean a 0. *(verificación visual en Task 4)*

---

### Task 1: Cálculo puro `buildSprintComposition`

**Files:**
- Create: `artifacts/api-server/src/lib/sprint-composition.ts`
- Test: `artifacts/api-server/src/lib/__tests__/sprint-composition.test.ts`

**Interfaces:**
- Produces:
```ts
export interface CompositionIssue {
  key: string;
  category: string;          // getEffectiveIssueType(issue)
  storyPoints: number;
  doneAtClose: boolean;
  addedAfterPlanning: boolean;
}
export interface CompositionSprintInput { sprintId: number; sprintName: string; issues: CompositionIssue[] }
export interface CompositionDelivered { key: string; category: string; cycleTimeDays: number | null }
export interface SprintCompositionRow {
  category: string;
  issueShare: number;                    // 0..100, 1 decimal
  issuesPerSprint: number;               // 1 decimal
  storyPointsPerSprint: number;          // 1 decimal
  realClosedRate: number | null;         // 0..100, 1 decimal; null si 0 issues (no ocurre: fila no existe)
  cycleP50: number | null;
  cycleP85: number | null;
  addedAfterPlanningRate: number;        // 0..100, 1 decimal
  addedAfterPlanningPerSprint: number;   // 1 decimal
}
export interface SprintCompositionSprint { sprintId: number; sprintName: string; totalIssues: number; shares: Record<string, number> }
export interface SprintComposition { sprintCount: number; totalIssues: number; rows: SprintCompositionRow[]; sprints: SprintCompositionSprint[] }
export const CATEGORY_ORDER = ["Story", "Bug", "Task", "Spike", "Tech Debt"] as const;
export function buildSprintComposition(sprints: CompositionSprintInput[], delivered: CompositionDelivered[]): SprintComposition;
```

- [ ] **Step 1: Write the failing tests** — `describe("buildSprintComposition")` con un helper `issue(category, opts)`:
  - `"shares and per-sprint averages over the window"`: sprint A = 3 Story + 1 Bug, sprint B = 1 Story + 3 Bug → rows `[Story, Bug]`; Story `issueShare` 50, `issuesPerSprint` 2; Bug igual; `sprintCount` 2, `totalIssues` 8; `sprints[0].shares.Story` 75.
  - `"realClosedRate is pooled by issues"`: Story 3 done de 4 en A, 0 de 1 en B → `realClosedRate` 60 (no 37.5).
  - `"addedAfterPlanning rate and per sprint"`: Bug con 3 de 4 `addedAfterPlanning` en 2 sprints → rate 75, perSprint 1.5.
  - `"cycle percentiles need 3 delivered"`: Story con 2 entregados → `cycleP50`/`cycleP85` null; con [2, 4, 6, 8] → P50 5, P85 7.1.
  - `"carried-over issue counts per sprint, cycle once"`: misma key `X-1` en A y B → `issuesPerSprint` cuenta 2 veces; `delivered` la trae una sola vez y el P50 lo refleja.
  - `"empty sprint counts as zero in the average"`: A con 2 Story, B sin issues → Story `issuesPerSprint` 1, `sprintCount` 2.
  - `"no sprints → empty"`: `[]` → `{ sprintCount: 0, totalIssues: 0, rows: [], sprints: [] }`.
  - `"row order is fixed, unknown types after, alphabetic"`: categorías `Zeta, Task, Story, Alpha` → `[Story, Task, Alpha, Zeta]`.
  - `"category with no issues is omitted"`: solo Story → una fila.
  - `"null cycle times are ignored"`: `cycleTimeDays: null` no cuenta para el mínimo de 3.

- [ ] **Step 2: Run to verify it fails**
  Run: `pnpm --filter @workspace/api-server test -- sprint-composition`
  Expected: FAIL, módulo no encontrado.

- [ ] **Step 3: Implement** en `lib/sprint-composition.ts`. Percentiles con `percentileRounded(values, 0.5 | 0.85)` de `lib/stats.ts`; redondear el resto con `Math.round(x * 10) / 10`. Sin imports de `jira.ts` (función pura).

- [ ] **Step 4: Run to verify it passes**
  Run: `pnpm --filter @workspace/api-server test -- sprint-composition`
  Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**
```bash
git add artifacts/api-server/src/lib/sprint-composition.ts artifacts/api-server/src/lib/__tests__/sprint-composition.test.ts
git commit -m "feat(sprints): pure sprint-composition calculation by work type"
```

### Task 2: Endpoint `GET /projects/:projectId/sprint-composition/:window` + contrato

**Files:**
- Create: `artifacts/api-server/src/routes/sprint-composition.ts`
- Modify: `artifacts/api-server/src/routes/index.ts` (registrar router, junto a `sprintSummaryRouter`)
- Modify: `lib/api-spec/openapi.yaml` (path nuevo junto a `/projects/{projectId}/sprints/{period}` + schemas)
- Regenerate: `lib/api-zod/src/generated/**`, `lib/api-client-react/src/generated/**` vía `pnpm --filter @workspace/api-spec run codegen`

**Interfaces:**
- Consumes: `buildSprintComposition`, `CompositionSprintInput`, `CompositionDelivered` (Task 1); de `lib/jira.ts`: `getJiraProject`, `getProjectBoardType`, `getJiraSprints`, `resolveSprintWindowDays`, `getSprintIssues`, `getEffectiveIssueType`, `getStoryPoints`, `isIssueDone`, `isNonDeliveryClosure`, `wasIssueDoneAt`, `sprintCloseTime`, `getStatusCategoryMap`, `isAddedAfterPlanning`, `getJiraIssuesForWindow`, `getDeliveryDate`, `getCycleTimeDays`; `getPortfolioAllowedIssueTypes`.
- Produces: `operationId: getProjectSprintComposition`, path param `window` enum `[2s, 6s]`; schemas `SprintComposition`, `SprintCompositionRow`, `SprintCompositionSprint` (mismos campos que Task 1; `shares` = `additionalProperties: number`). Hook generado: `useGetProjectSprintComposition(projectId, window)` + `getGetProjectSprintCompositionQueryKey`.

- [ ] **Step 1: Contrato.** Agregar path y schemas en `openapi.yaml` (200, 400 "no Scrum o ventana inválida", 404, `security: bearerAuth`, `tags: [metrics]`). Correr `pnpm --filter @workspace/api-spec run codegen`. Expected: termina sin error y `grep -r useGetProjectSprintComposition lib/api-client-react/src/generated` encuentra el hook.

- [ ] **Step 2: Implementar el router** con `requireAuth, requireSectionView("sprints", "capacity")`:
  1. `window` ∉ {`2s`,`6s`} → 400; proyecto inexistente → 404; `boardType !== "scrum"` → 400 (mismo mensaje que `sprint-metrics.ts`).
  2. `sprints = await getJiraSprints(projectId, 50)`; `resolveSprintWindowDays(sprints, window === "2s" ? 2 : 6)`; `null` → responder `buildSprintComposition([], [])`.
  3. Por cada sprint de `sprintsIncluded` (en orden cronológico): `getSprintIssues(s.id)` → filtro de alcance (Global Constraints) → `CompositionIssue` con `doneAtClose = wasIssueDoneAt(i, sprintCloseTime(s)!, categoryMap)`, `addedAfterPlanning = isAddedAfterPlanning(i, s)`.
  4. Entregados: `getJiraIssuesForWindow(projectId, days, { includeChangelog: true })`, dedupe por key, mismo filtro de tipo + clave de proyecto + `isIssueDone`, `getDeliveryDate` dentro de la ventana de algún sprint incluido (`[startDate, completeDate ?? endDate)`) → `CompositionDelivered` con `getCycleTimeDays`.
  5. `res.json(buildSprintComposition(inputs, delivered))`; errores de Jira → 500 con el patrón `try/catch` + `logger` que usa `routes/capacity.ts`.

- [ ] **Step 3: Registrar** en `routes/index.ts`, typecheck.
  Run: `pnpm run typecheck`
  Expected: sin errores.

- [ ] **Step 4: Verificar contra datos reales.** `docker compose up -d --build api`; login admin; luego
  `curl -s localhost:8000/api/projects/<OLP id>/sprint-composition/6s -H "Authorization: Bearer $T" | jq '{sprintCount,totalIssues,rows:[.rows[]|{category,issueShare,issuesPerSprint,realClosedRate,cycleP50,cycleP85,addedAfterPlanningRate}]}'`
  Expected: `sprintCount` 6, filas en orden fijo, `issueShare` suma ≈ 100. Cruzar `totalIssues` con la suma de `totalIssues` de los mismos 6 sprints de `GET /projects/<id>/sprints/3m` (puede diferir solo por issues de otros proyectos; anotar la diferencia). `.../sprint-composition/9s` → 400; proyecto Kanban → 400.

- [ ] **Step 5: Commit**
```bash
git add artifacts/api-server/src/routes/sprint-composition.ts artifacts/api-server/src/routes/index.ts lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react
git commit -m "feat(sprints): sprint-composition endpoint for the 2/6 closed-sprint cadences"
```

### Task 3: Tarjeta "Composición del sprint" en Sprints y baja del Resumen de sprint

**Files:**
- Create: `artifacts/dashboard/src/components/sprint-composition-card.tsx`
- Modify: `artifacts/dashboard/src/pages/project-sprints.tsx` (import línea 10, uso línea ~485)
- Delete: `artifacts/dashboard/src/components/sprint-summary-section.tsx`, `artifacts/api-server/src/routes/sprint-summary.ts`, `artifacts/api-server/src/lib/sprint-summary.ts`, `artifacts/api-server/src/lib/__tests__/sprint-summary.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts` (quitar `sprintSummaryRouter`), `lib/api-spec/openapi.yaml` (quitar path `/projects/{projectId}/sprint-summary/{sprintId}` y schemas `SprintSummary*` que nadie más referencie) + codegen
- Modify: `artifacts/dashboard/src/i18n/locales/es.json`, `en.json` (quitar `page.sprintSummary.*`, agregar `page.sprintComposition.*`)

**Interfaces:**
- Consumes: `useGetProjectSprintComposition`, `getGetProjectSprintCompositionQueryKey`, tipo `SprintComposition` (Task 2).
- Produces: `export function SprintCompositionCard({ projectId }: { projectId: string })`; `export const CATEGORY_LABEL_KEY: Record<string, string>` (Story → `page.sprintComposition.cat.story`, etc.; otros tipos muestran el nombre crudo) y `export const CATEGORY_COLOR: Record<string, string>` — Task 4 los reutiliza.

- [ ] **Step 1: Borrar el Resumen.** Antes de borrar `lib/sprint-summary.ts`, confirmar `grep -rn "sprint-summary" artifacts lib/api-spec --include=*.ts --include=*.tsx --include=*.yaml | grep -v generated` solo lista los archivos de este task. Borrar, quitar del router y del OpenAPI, codegen, quitar claves i18n.
  Run: `pnpm run typecheck && pnpm --filter @workspace/api-server test`
  Expected: verde; el conteo de tests baja en los de `sprint-summary.test.ts` y sube en los 10 de Task 1.

- [ ] **Step 2: Tarjeta.** `Card` con título "Composición del sprint", subtítulo "Promedio por sprint · {{count}} sprints cerrados ({{first}}–{{last}})", selector Últimos 2 / Últimos 6 (default `6s`, mismo estilo que `components/time-window-filter.tsx` opciones Scrum). Tabla con columnas: Tipo · % issues · Issues/sprint · SP/sprint · % real cerrado · Cycle P50 / P85 (`"6d / 11d"`, `"—"` si null) · Entró a mitad. Debajo, `BarChart` apilado de recharts con `sprints[]` (eje X = `sprintName`, una `Bar stackId="mix"` por categoría presente, valores = `shares`, en %). Nota al pie: "% real cerrado cuenta issues; la columna de la tabla de Sprints usa SP cuando hay." Estados: cargando (texto como el resto de la página), `rows.length === 0` → `EmptyState` "Todavía no hay sprints cerrados para calcular la composición".

- [ ] **Step 3: Montar** `<SprintCompositionCard projectId={project.id} />` donde estaba `<SprintSummarySection …/>`.

- [ ] **Step 4: Verificar.** `pnpm run typecheck && pnpm run lint` (warnings ≤ 113); `docker compose up -d --build`; abrir `http://localhost/projects/<OLP id>/sprints` y confirmar: no hay "Resumen de sprint", la tarjeta muestra los mismos números que el `curl` de Task 2, el toggle cambia a 2 sprints, la barra apilada suma 100 % por sprint. Captura de pantalla.

- [ ] **Step 5: Commit**
```bash
git add -A artifacts/dashboard/src artifacts/api-server/src lib/api-spec lib/api-zod lib/api-client-react
git commit -m "feat(sprints): Composición del sprint replaces Resumen de sprint"
```

### Task 4: "Mezcla esperada" en Capacidad

**Files:**
- Create: `artifacts/dashboard/src/lib/expected-mix.ts`
- Modify: `artifacts/dashboard/src/pages/project-capacity.tsx` (debajo de la grilla issues/SP de la tarjeta del sprint, ~línea 600)
- Modify: `es.json`, `en.json` (`page.capacity.expectedMix`, `page.capacity.hotfixMargin`)

**Interfaces:**
- Consumes: `useGetProjectSprintComposition(projectId, "6s")` (Task 2); `CATEGORY_LABEL_KEY` (Task 3); `data.recommendation.range.issues: [number, number]` de la respuesta de capacidad.
- Produces: `export function expectedMix(issueRange: [number, number], rows: { category: string; issueShare: number }[]): { category: string; issues: number }[]` — punto medio × share, `Math.round`, sin entradas en 0, mismo orden que `rows`.

- [ ] **Step 1: Implementar `expectedMix`** (sin runner de tests en el dashboard; el caso se verifica en Step 3).
- [ ] **Step 2: Renderizar** cuando hay `rec` y la composición tiene filas:
  - "Mezcla esperada (últimos 6 sprints): ~12 HU · ~5 hotfix · ~2 tareas · ~1 spike" (etiquetas cortas en i18n);
  - si la fila `Bug` tiene `addedAfterPlanningPerSprint >= 1`: "~{{n}} hotfix suelen entrar a mitad de sprint: conviene dejar ese margen libre" con `n = Math.round(...)`.
  Sin `rec` o sin filas → no se muestra nada.
- [ ] **Step 3: Verificar.** typecheck + lint; rebuild `web`; abrir Capacidad de OLP y comprobar a mano: punto medio del rango × `issueShare` del `curl` 6s = números mostrados; un proyecto con < 3 sprints cerrados no muestra la línea. Captura.
- [ ] **Step 4: Commit**
```bash
git add artifacts/dashboard/src
git commit -m "feat(capacity): expected work-type mix under the recommended commitment"
```

### Task 5: Documentación

**Files:**
- Modify: `METRICS.md` (sección nueva "Composición del sprint": fórmulas de cada columna, alcance, ventana; borrar "### Resumen de sprint (pestaña Resumen)", ~línea 235)
- Modify: `CLAUDE.md` (conteo de tests en "Run & Operate" al número real tras Task 3)

- [ ] **Step 1:** Escribir la sección con referencias `archivo` + función como el resto de `METRICS.md`.
- [ ] **Step 2:** `pnpm --filter @workspace/api-server test` y actualizar el número en `CLAUDE.md`.
- [ ] **Step 3: Commit**
```bash
git add METRICS.md CLAUDE.md
git commit -m "docs(metrics): sprint composition formulas"
```

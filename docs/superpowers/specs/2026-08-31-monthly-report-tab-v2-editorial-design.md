# Diseño: Tab "Informe" v2 — capa narrativa editorial

Fecha: 2026-08-31
Origen: el usuario compartió un mockup HTML ("Informe Olimpo — Agosto",
artifact `67a21b67`) con un layout editorial (masthead, KPI strip, 6 secciones
numeradas con prosa auto-generada) más rico que el tab "Informe" recién
shippeado (`docs/superpowers/specs/2026-08-31-monthly-report-tab-design.md`,
13 tareas, rama `worktree-monthly-report-tab`, sin mergear a `main` aún).
Este spec construye sobre ese trabajo — no lo reemplaza.

## Objetivo

Acercar el tab "Informe" al mockup, priorizando lo que ya podemos calcular con
datos existentes (o casi) por sobre paridad visual/de contenido total en esta
primera iteración.

## Decisiones tomadas en brainstorming

- **Visual**: se adapta la estructura editorial (masthead, KPI strip,
  secciones numeradas) a los tokens/`Card` que ya usa el resto del dashboard.
  No se introduce el sistema tipográfico del mockup (Fraunces/IBM Plex Mono)
  ni una paleta de color aparte — el tab Informe se mantiene visualmente
  consistente con el resto de la app.
- **Arquitectura**: toda la lógica de "narrativa" (qué mostrar, qué detectar)
  vive en funciones puras en `artifacts/api-server/src/lib/report-insights.ts`
  (mismo archivo de Task 7/8 de la v1), testeadas con vitest, expuestas por el
  endpoint ya existente `GET /projects/:id/report-insights`. El frontend
  compone el texto final (interpolación de números en oraciones) pero no
  recalcula nada — mismo patrón que ya sigue el resto del feature v1.
- **Sin endpoints nuevos en el hook de datos**: nada se agrega al `Promise.all`
  de `useReportData` — todo lo nuevo de esta iteración se agrega al payload
  de `/report-insights`, que el hook ya consume. Esto evita repetir el bug de
  Kanban resuelto post-v1 (una llamada nueva rechazando el `Promise.all`
  entero para proyectos que no aplican).

### Fuera de alcance de v1 de esta capa (decisión explícita)

- **WIP aging por issue individual** (qué issues específicos llevan más
  tiempo "en progreso" del esperado, con nombre y días) — mockup lo tiene
  ("OLP-3843 (45.3d)"), pero requiere cruzar changelog + thresholds por
  issue; se deja para una iteración futura.
- **"Funcionalidades destacadas" con curación manual y texto explicativo**
  (por qué importa cada feature) — el mockup tiene contexto humano
  ("en desarrollo paralelo por...", "en preparación"). v1 de esta capa usa
  una heurística automática (top N por story points resueltos en el
  período): sin curación, sin texto explicativo generado.
- **Fecha de release explícita en "Próximos pasos"** — el mockup menciona
  "Paso a producción RC-22 (2 sept)"; no existe un campo de fecha de release
  estructurado en `release_epics` ni en Jira RC tal como lo sincronizamos hoy
  (ver `release-readiness.ts` / schema `release_epics`). No se fabrica ese
  dato: el ítem de "Próximos pasos" relacionado a producción es genérico
  ("hay N release(s) en preparación — ver sección Producción"), sin fecha.
- **Cambio de tipografía/color system** (ver Decisiones arriba).

## Qué ya existe y no requiere trabajo nuevo

`GET /projects/:id/sprints/:period` (`sprint-metrics.ts`, exportado en Task 8
de v1) ya devuelve, por sprint, `reopenedCount`, `carryoverCount`,
`carryoverStoryPoints`, `carryoverRate` — el hook y la página v1 no los
destructuran/renderizan hoy. Esta iteración solo necesita mostrarlos, no
calcularlos.

## Cambios de backend

### 1. `detectStructuralBottleneck(timeInStatus)`

Nueva función pura en `lib/report-insights.ts`, junto a
`detectCompletionDrop`/`detectThresholdCrossing`.

```ts
export interface StructuralBottleneck {
  type: "structuralBottleneck";
  status: string;
  avgDays: number;
  issueCount: number;
  sharePercent: number; // % del tiempo total ponderado de flujo que concentra este estado
}

export function detectStructuralBottleneck(
  timeInStatus: { status: string; avgDays: number; issueCount: number }[]
): StructuralBottleneck | null
```

- Tiempo ponderado por estado = `avgDays * issueCount`. `sharePercent` =
  ese valor sobre la suma de todos los estados, ×100.
- No dispara si `issueCount` del estado ganador es menor a un mínimo (p.ej. 3)
  — evita destacar un estado con 1-2 issues aislados como si fuera un cuello
  de botella estructural.
- No dispara si `sharePercent < 15` — un reparto parejo entre estados no es
  "un cuello de botella", es flujo normal.

### 2. `buildNextSteps(input)`

Nueva función pura en `lib/report-insights.ts`. **No incluye el bloqueo más
antiguo** (corrección post brainstorming inicial, ver nota abajo) — cubre
solo los tipos que son genuina regla de decisión con umbral.

```ts
export interface NextStep {
  type: "completionDrop" | "thresholdCrossing" | "activeSprint" | "productionReady";
  text: string; // ya compuesto en español, listo para renderizar
}

export function buildNextSteps(input: {
  activeSprint: { sprintName: string; completionRate: number; endDate: string | null } | null;
  insights: (CompletionDropInsight | ThresholdCrossingInsight)[];
  releaseReadinessConfigured: boolean;
  releaseEpicsPendingCount: number; // epics no en categoría "done"
}): NextStep[]
```

Reglas (orden = orden de aparición en la lista):
1. Un ítem por cada insight en `insights` (reusa el texto ya generado por
   `detectCompletionDrop`/`detectThresholdCrossing`, reformulado como acción:
   "revisar en retro la caída de finalización..." / "atender el cruce de
   umbral en...").
2. Si hay sprint activo → un ítem con su nombre y % completado a la fecha.
3. Si `releaseReadinessConfigured && releaseEpicsPendingCount > 0` → un ítem
   genérico apuntando a la sección de Producción (sin fecha, ver "Fuera de
   alcance").

Devuelve `[]` si no hay nada que decir.

**Nota de corrección (post brainstorming, durante `writing-plans`):** el
diseño original de esta función incluía un cuarto tipo, `oldestBlocker`,
tomado de `blockedIssues`. Se descartó al escribir el plan de implementación
por dos motivos concretos: (1) la detección de bloqueos activos en
`analytics.ts` es ~250 líneas entrelazadas con lookups de overrides manuales
en DB, sobre un conjunto de issues distinto al de "resueltos en el período"
que ya se fetchea en esta ruta (bloqueos son casi siempre issues **no**
resueltos) — reimplementarla acá para reusar solo `{key, summary, totalDays}`
sería duplicar esa lógica sin necesidad; (2) el frontend (`artifacts/dashboard`)
no puede importar código de `artifacts/api-server` (paquetes separados del
monorepo), así que tampoco se puede compartir una función ahí. Como "tomar
el bloqueo con más días" es un simple `sort`+`[0]`, no una regla de negocio
con umbral, se resuelve componiéndolo en el frontend sobre `blockedIssues`
que el hook ya trae de `/analytics/:period` (sin fetch nuevo), y anteponiendo
ese ítem a la lista que devuelve `buildNextSteps`. Ver plan de implementación,
Tasks 2 y 7.

### 3. `detectStructuralBottleneck` se invoca en `/analytics/:period`, no en `/report-insights`

**Nota de corrección (post brainstorming, durante `writing-plans`):** el
diseño original asumía que `computePeriodMetrics` (ya llamado en
`/report-insights` para cycle/lead time) devolvía `timeInStatus` y
`blockedIssues`. No es así — esos campos se calculan en `analytics.ts` con
una función separada (`computeTimeInStatus`) y lógica de ruta inline, sobre
un conjunto de issues más amplio (`timeInStatusIssues`, no solo resueltos en
el período). Recalcularlos en `/report-insights` sería duplicar esa
preparación de datos. Se corrige así: `detectStructuralBottleneck` se llama
directamente dentro del handler de `/analytics/:period`, inmediatamente
después de que ese mismo handler calcula `timeInStatus` — sin fetch nuevo
(el hook ya consume `/analytics/:period`), y se agrega `structuralBottleneck`
a esa respuesta en vez de a la de `/report-insights`.

### 4. Bloque nuevo en la ruta `/report-insights` (featured issues + next steps)

Junto al bloque existente de cycle/lead time, agregar el cálculo de
`featuredIssues` reusando `currentFiltered` (ya fetcheado y filtrado por esa
misma ruta para cycle/lead time, sin segundo llamado a
`getResolvedJiraIssuesInRange`):

```ts
const featuredIssues = currentFiltered
  .map((i) => ({ key: i.key, summary: i.fields.summary, assignee: i.fields.assignee?.displayName ?? null, storyPoints: getStoryPoints(i) }))
  .filter((i) => i.storyPoints > 0)
  .sort((a, b) => b.storyPoints - a.storyPoints)
  .slice(0, 4);
```

El endpoint pasa a devolver una única respuesta compuesta en vez de solo
`Insight[]`:

```ts
{
  insights: (CompletionDropInsight | ThresholdCrossingInsight)[],
  nextSteps: NextStep[],
  featuredIssues: FeaturedIssue[],
}
```

(Cambio de shape de la respuesta — no es aditivo. El frontend de esta misma
iteración se actualiza en el mismo commit/PR, no hay período de convivencia
con clientes viejos. `structuralBottleneck` viaja en la respuesta de
`/analytics/:period`, no en esta.)

## Cambios de frontend

`project-report.tsx` se reestructura en 6 secciones numeradas
(`01`–`06`), usando `Card`/tokens existentes, sin fuentes/colores nuevos:

- **Masthead**: eyebrow (`{project.key} · {Scrum|Kanban} · Software`), título,
  subtítulo con rango de sprints cubiertos (se puede derivar de
  `sprints[0].startDate` / último sprint activo), meta a la derecha
  (nombre del proyecto, "sincronizado hace X").
- **KPI strip**: se mantienen las 6 métricas actuales, se les agrega un tag
  de severidad (`critical`/`warning`/`good`) reusando `getEffectiveThresholds`
  igual que ya hace `project-health.tsx` (mismo componente/lógica de
  banding, no uno nuevo).
- **01 Avances y funcionalidades**: párrafo por sprint (cerrados + activo)
  interpolando `completionRate`, `avgCycleTimeDays`, `reopenedCount`,
  `carryoverCount`/`carryoverStoryPoints` (ya en el payload de
  `/sprints/:period`) + objetivo del sprint (ya existía) + lista de
  `featuredIssues` (nuevo).
- **02 Decisiones importantes**: nota de alcance estática (texto fijo sobre
  qué es/no es el Flow Health Score, sin backend) + `insights[]` (sin cambio
  de lógica respecto a v1).
- **03 Bloqueos e impedimentos**: cards existentes, ordenadas por
  `totalDays` descendente, badge "más antiguo del período" en la primera +
  párrafo de `structuralBottleneck` si no es `null`.
- **04 Próximos pasos** (nueva sección): lista `nextSteps`, se omite toda
  la sección si `nextSteps.length === 0`.
- **05 Próximos pasos a producción**: sin cambios respecto a v1.
- **06 Detalle de sprints**: mismo table, se agregan columnas "Reabiertos" y
  "Carryover" (dato ya disponible en el payload).

## Testing

- Backend: tests unitarios (vitest, mismo archivo `report-insights.test.ts`)
  para `detectStructuralBottleneck` (reparto parejo → `null`; ganador con
  pocos issues → `null`; caso claro → resultado correcto) y `buildNextSteps`
  (0 bloqueos, 1 bloqueo, N bloqueos + insights + sprint activo + release
  pendiente, combinaciones vacías → `[]`).
- El bloque de `featuredIssues` se degrada a `[]` ante error (mismo patrón
  `.catch(() => [])` que ya usa el resto de la ruta) — no bloquea el resto
  del endpoint.
- Regresión manual: reverificar Olimpo (Scrum, con todos los datos) y
  STRIDER AI (Kanban, sin sprints/goal/producción) para confirmar que las
  secciones nuevas no rompen el caso Kanban recién arreglado (bug de
  `/sprints` 400 documentado en el ledger de la v1).

## Relación con el trabajo ya hecho

Este spec asume merge (o al menos disponibilidad) de la rama
`worktree-monthly-report-tab` (13 tareas, ver
`.superpowers/sdd/2026-08-31-monthly-report-tab/progress.md` en ese
worktree) — todo lo de esta iteración se construye encima de
`report-insights.ts`, `use-report-data.ts` y `project-report.tsx` tal como
quedaron ahí, no desde cero.

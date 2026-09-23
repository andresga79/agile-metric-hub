# Definición de Métricas — Agile Metric Hub

> Documenta **cómo se calcula realmente cada métrica en el código** (no la definición
> ideal de libro). El objetivo es que los números sean **defendibles**: que un líder
> técnico o scrum master pueda saber exactamente qué mide cada valor, con qué datos, y
> qué supuestos hay detrás. Las referencias apuntan a `archivo` + función (no a números de
> línea, que se desactualizan con cada cambio).
>
> Última actualización: 2026-09-23. Si cambiás una fórmula en el código, actualizá acá.

---

## Advertencias transversales (leer primero)

Estas afectan a **casi todas** las métricas:

1. **Ventana máxima de 90 días.** Todo fetch de issues a Jira está tope-ado a 90 días hacia
   atrás (`JIRA_MAX_LOOKBACK_DAYS`, `lib/jira.ts`). Los períodos son: **`1m` = 30 días**,
   **`3m` = 90 días**, y para Scrum **`2s` / `6s` = últimos 2 / 6 sprints cerrados** (desde el
   inicio exacto del sprint más viejo hasta el cierre del más reciente). Excepción: una ventana
   de sprints que pasa de 90 días (6 sprints + el activo suelen sumar 91–126) se completa con
   `getJiraIssuesForWindow` hasta `SPRINT_WINDOW_MAX_LOOKBACK_DAYS` (150), en vez de perder el
   principio del sprint más viejo. Para comparaciones históricas existe
   `getResolvedJiraIssuesInRange`, que también supera el tope.
2. **Cycle Time depende del changelog.** Si el fetch no pide `includeChangelog: true`, el
   Cycle Time cae en silencio a Lead Time (ver definición abajo). Los endpoints que muestran
   cycle time ya piden changelog; tenerlo presente si se agrega uno nuevo.
3. **Paginación y cobertura del fetch.** El `nextPageToken` de este Jira no avanza, así que
   todas las búsquedas paginan por clave (`searchAllByKey`: `ORDER BY key ASC` + `key > último`),
   en bloques semanales. Antes se cortaba en 100 issues por bloque sin aviso (DAT-1: OLI perdía 12
   en una semana). El flujo de no-resueltos incluye además los issues cuyo **cambio de categoría
   de estado** cayó en la ventana, porque en este sitio la mayoría de los issues terminados **no
   tienen `resolutiondate`** (OLI, 90 días: 599 terminados sin resolución vs 168 con).
4. **Umbrales desde Admin.** Los colores/scores comparan contra los umbrales configurados en
   **Admin → Health** (`getEffectiveThresholds`: default global + override por proyecto), que el
   frontend lee de `GET /api/thresholds` y `GET /api/projects/:id/thresholds` (hook
   `useThresholds`) — abiertos a cualquier rol, así admin y member ven los mismos colores. No
   están hardcodeados por pantalla (los defaults del frontend son solo fallback mientras cargan).
5. **Tipos de issue filtrados.** Portfolio y varias vistas solo cuentan los tipos permitidos
   en la config de Portfolio (`getPortfolioAllowedIssueTypes`, por defecto Story/Task/Bug).

---

## Definiciones base

**"Resuelto en el período"** — en toda la app significa: `isIssueDone(issue)` (categoría de
estado `"done"`, con fallback regex ES/EN si Jira no devuelve `statusCategory`) **Y** su fecha
de resolución `>= startDate` (y `< fin de la ventana` en ventanas de sprint y período anterior).
(`isIssueDone`, `lib/jira.ts`)

**Fecha de resolución** (`getResolutionDate`, `lib/jira.ts`) — en orden: (1) el campo
`resolutiondate`; (2) si no, la **última** transición del changelog hacia un estado "done";
(3) fallback final: el campo `updated`. El paso (2) no es un caso borde en este Jira: es el caso
mayoritario (ver advertencia 3).

**Story points** (`getStoryPoints`, `lib/jira.ts`) — el primero con valor entre
`customfield_10016`, `customfield_10028`, `customfield_10072`; si ninguno, `0`. ⚠️ Los IDs de
campo son específicos de esta instancia de Jira.

**`normalize(value, worst, best)`** (`lib/health-thresholds.ts`) — proyecta un valor crudo a
un score **0–100**. `worst` es el ancla del 0, `best` la del 100 (da igual cuál sea mayor: así
soporta métricas "mayor es mejor" y "menor es mejor"). Clampa el valor dentro del rango antes de
calcular, de modo que un valor peor que `worst` da 0 (no se "envuelve" a 100). En los usos de
Health, `worst = warningValue` y `best = goodValue` de Admin.

**Semana ISO** (`lib/iso-week.ts`) — única implementación, en UTC: `isoWeekLabel` ("2026-W39"),
`isoWeekStart` (lunes) e `isoWeek`. Antes había 5 copias y 3 daban la semana corrida en uno
en 2025/2026 (el 1/1/2026 salía "W00").

---

## Métricas de flujo

### Throughput
Issues resueltos por semana. `resolved.length / weeks`, con `weeks = ceil(periodDays/7)`.
(`routes/project-health.ts`; `/metrics` expone en cambio el **conteo total** del período como
`throughput`.) El KPI "Throughput /wk" del Reporte usa el valor semanal de `/health`
(`raw.throughput`), el mismo con el que se colorea su banda.
En el Resumen Ejecutivo la tarjeta "Throughput (90d)" es la **suma de `doneCount`** de los
proyectos visibles (los últimos 90 días).

### Cycle Time
Días desde que **empezó el trabajo activo** hasta la resolución. Inicio = **primera** transición
del changelog hacia un estado de categoría `"indeterminate"` (in-progress); fin = fecha de
resolución. (`getCycleTimeDays`, `lib/jira.ts`)
**Fallback:** si no hay changelog o no hay transición a in-progress, devuelve el Lead Time.
Se promedia sin ponderar sobre los issues resueltos.

### Lead Time
Días desde que se **creó** el issue hasta la resolución: `(resolved - created)`. Incluye el
tiempo en backlog. (`getLeadTimeDays`, `lib/jira.ts`)

### Percentiles (P50/P75/P85/P95)
Percentil por interpolación lineal sobre el arreglo ordenado de cycle/lead times.
(`computePercentiles`, `routes/metrics.ts`)

### Distribución de Cycle Time
Buckets semiabiertos `[min,max)`: `0-1d`, `1-3d`, `3-7d`, `7-14d`, `14d+`. (`buildCycleTimeDistribution`, `routes/metrics.ts`)

### WIP (Work In Progress)
Cantidad de issues actualmente en categoría `"indeterminate"` (`isIssueInProgress`). El conteo
usa **issues abiertos sin tope de fecha** (`getOpenIssuesForProject`), no solo los del período,
para no perder issues abiertos hace más de 90 días.

### WIP Balance / wipRatio
`(enProgreso / total) * 100`. (`routes/project-health.ts`) La dimensión "WIP Balance" del Health
es `normalize(wipRatio, warning, good)`.

### Flow Load (WIP / Throughput)
`WIP / throughput` — cuánto trabajo se acumula por cada unidad que sale. **Menor es mejor**
(>1 = entra más de lo que sale). En el Resumen: `totalWip / totalThroughput`.

### Flow Efficiency
`avgCycleTime / avgLeadTime * 100`. Qué proporción del lead time fue trabajo activo (vs espera).
(`computePeriodMetrics`, `routes/analytics.ts`) Usa promedios sin ponderar de los resueltos en la ventana.

### Time in Status (cuellos de botella)
Por issue, recorre el changelog sumando la duración en cada estado (desde `created`, cerrando en
la resolución o en "ahora" si sigue abierto). Por estado reporta `totalDays`, `avgDays`,
`medianDays`, `issueCount`; se ordena por `avgDays` descendente. (`computeTimeInStatus`,
`routes/analytics.ts`)

### WIP Aging
Antigüedad (días) de cada issue en progreso desde su **última** entrada a in-progress (fallback:
`created`). Buckets vía Admin (`wipAging`): `days >= warningValue` → **crítico**;
`>= (good+warning)/2` → **advertencia**; `>= goodValue` → **watch**. Los conteos se calculan
sobre la lista completa, no solo los items mostrados. (`getAlertLevel`, `routes/analytics.ts`)

### CFD (Diagrama de Flujo Acumulado)
Para cada día del período, cuenta cada issue como: `done` si ya estaba resuelto ese día; si no,
`inProgress` si ya había entrado a in-progress; si no, `todo`. Requiere changelog (si no, la
banda "En Progreso" queda siempre en 0). (`cfd.ts`)

---

## Entrega y predecibilidad

### Velocity
**Solo Scrum** (Kanban = `null`). `storyPointsTotal / sprintCount`, donde `sprintCount` = los
sprints de la ventana (`2s`/`6s`), o los sprints cerrados en el período, o estimado como 1 sprint
cada 14 días si no hay. (`computeMetrics`, `routes/metrics.ts`) En ventanas de sprint el gráfico
asigna cada issue al sprint en cuyo `[inicio, cierre)` se resolvió (`buildSprintVelocityBuckets`).
Por sprint individual (pestaña Sprints), la velocity = story points **completados al cierre**
(ver Sprint Completion Rate). Ambas vistas deberían dar ~lo mismo (OLI 6s: 65.3 vs 65.2).

### Sprint Completion Rate
Si el sprint tiene story points cargados: `(doneSp / totalSp) * 100`; si no, por conteo:
`(issuesCompletados / issuesTotales) * 100`. Los promedios de resumen solo incluyen sprints
**cerrados** (excluye el activo). (`computeSprintMetrics`, `routes/sprint-metrics.ts`)
"Completado" en un sprint **cerrado** = estaba en un estado "done" **al momento del cierre**
(`completeDate`, o `endDate`), reconstruido desde el changelog (`wasIssueDoneAt`, misma regla que
el reporte de sprint de Jira; sin changelog: done ahora y `resolutiondate <= cierre`). En el
sprint **activo** = `isIssueDone` actual. Antes se usaba el estado actual también para sprints
cerrados, así que lo arrastrado y terminado en sprints siguientes se le acreditaba a cada sprint
por el que pasó (los sprints viejos llegaban al ~100%). Evolution usa la misma regla.

### Predictability
`clamp(100 - (stddev / avg) * 50, 0, 100)` sobre el throughput semanal (solo semanas con
actividad). Cuanto más estable el throughput semana a semana, más alto. Default `50` si no hay
throughput. (`routes/project-health.ts`)

### Tendencias (velocity / throughput trend)
Comparación **primera mitad vs segunda mitad del mismo período** (no período-contra-período):
`((segunda - primera) / primera) * 100`. (`calculateTrend`, `routes/metrics.ts`) En `1m`/`3m` la
mitad se corta en el punto medio de la ventana; en `2s`/`6s` se comparan los **promedios por
sprint** de la primera mitad de los sprints contra la segunda, con los mismos buckets del gráfico
(`sprintWindowHalves`).
> El badge "vs período anterior" del **Reporte** (`/metrics?compareTo=true`) usa el mismo filtro
> que el período actual y que `/analytics`: done + resuelto dentro de `[inicio anterior, inicio
> actual)`.
> Nota: la tendencia "vs. período anterior" del **Resumen Ejecutivo** es distinta — esa sí
> compara los 90 días actuales contra los 90 anteriores (`portfolio-cache.ts`).

### Forecast — Monte Carlo (`forecast.ts`)
Simula (default 10 000, máx 50 000 corridas) cuántas semanas hasta alcanzar un objetivo,
muestreando al azar del throughput semanal histórico (semanas con valor >0; corte a 104 semanas).
Devuelve P50/P75/P85/P95 y una probabilidad. Requiere ≥3 issues resueltos. Ventana tope-ada a 90d.

### Forecast — proyección determinística (`predictive-forecast.ts`)
**No es Monte Carlo:** `remainingIssues / avgThroughput` (promedio de semanas con actividad),
con optimista/pesimista en P75/P25 del throughput semanal.

---

## Calidad

### CFR / "Quality" (Change Failure Rate — aproximado)
`(bugsResueltos / totalResueltos) * 100`. ⚠️ **No** es el Change Failure Rate real de DORA
(% de despliegues que fallan) — es la proporción de issues resueltos que son bugs; no hay datos
de despliegue. (`routes/project-health.ts`) La dimensión "Quality" = `normalize(cfr, warning, good)`.

### QA Rejection Rate (tasa de rechazo de QA)
`issuesRechazados / issuesQueEntraronAQA` (redondeado a 1 decimal). (`routes/qa-rejected.ts`)
- **Denominador:** issues únicos con ≥1 transición **hacia** un estado QA dentro del período.
- **Numerador:** issues únicos con una transición QA → estado de dev/backlog dentro del período.
- Ambos acotados a la ventana `[since, ahora)` — transiciones fuera del período no cuentan.

### Bug Rate (desde QA)
`bugsVinculados / issuesQueEntraronAQA`. Bugs vinculados vía `issuelinks` a los issues escaneados
(deduplicados). (`routes/qa-rejected.ts`)

### QA Impact Rate (impacto combinado)
`(issues rechazados ∪ issues con bug vinculado) / issuesQueEntraronAQA` — stories únicas que
fueron rechazadas **o** tienen un bug vinculado. (`routes/qa-rejected.ts`)
> Ojo: el `qaImpactRate` **por sprint** usa la **suma** (rechazados + bugs), no la unión — puede
> diferir levemente del overall.

### Reopened Count
Issues que entraron a un estado "done" y **después** salieron de done. (`countReopenedIssues`,
`lib/jira.ts`; detección por categoría con fallback regex ES/EN.)

### Blocked (bloqueos)
Se calcula el **tiempo bloqueado** por issue recorriendo transiciones de estado + campo `Flagged`
(abre intervalo al bloquearse, cierra al desbloquearse). Solo tipos Story/Task/Bug. Un issue
resuelto no puede estar "bloqueado ahora". (`routes/analytics.ts`) El **% bloqueado** del Health/
Resumen es `bloqueadosAhora / WIP` (currently-blocked sobre WIP, no sobre el historial).

---

## SLA

Compliance por prioridad, con base en **Lead Time** (no cycle time). Un issue "cumple" si
`leadTime <= objetivo` de su prioridad. `compliance% = (dentroDeSLA / total) * 100` por prioridad.
(`sla.ts`)
Objetivos configurables en Admin, mapeados por prioridad:

| Prioridad | Métrica Admin | Unidad | Default |
|---|---|---|---|
| Highest | `slaHighest` | **horas** | 4 |
| High | `slaHigh` | días | 1 |
| Medium | `slaMedium` | días | 3 |
| Low | `slaLow` | días | 5 |
| Lowest | `slaLowest` | días | 10 |

⚠️ `slaHighest` está en **horas** (se convierte con `/24`); el resto en días.

---

## Evolution (histórico)

- **Kanban (por semana):** filas de `metric_snapshots`, una por proyecto y semana ISO, escritas
  en cada sync. Solo se guardan semanas **completamente dentro** de la ventana de 90 días
  (`snapshotsFullyInWindow`): la semana del borde está parcialmente cubierta, y reescribirla cada
  día dejaba "congelado" el valor más truncado. ⚠️ Filas escritas antes del 2026-09-23 pueden
  tener ese daño (p. ej. OLP 2026-06-01/08/15 con throughput 0).
- **Scrum (por sprint):** `computeSprintSnapshot` sobre los issues del sprint, con la regla de
  "completado al cierre".

---

## Índices compuestos

### Flow Health Score (antes mal llamado "DORA Score")
`round( ( normalize(throughput) + normalize(cycleTime) + normalize(cfr) ) / 3 )` — promedio de
tres dimensiones normalizadas 0–100 contra los umbrales de Admin. (`routes/project-health.ts`)
⚠️ **No son las métricas DORA reales** (usa throughput de issues, no frecuencia de despliegue; y
CFR = bugs/resueltos). Es un índice de salud de **flujo** derivado solo de Jira. Alimenta la
tarjeta "Health Score (Flujo)" del Reporte y "Health Score Prom." del Resumen.

### KPIs del Resumen Ejecutivo
- **Proyectos en Riesgo** — conteo de proyectos en semáforo Rojo / Amarillo de la tabla. El
  semáforo por proyecto es el peor estado entre sus dimensiones (Flujo, Cycle Time, Lead Time,
  Entrega). (`dashboard.tsx`)
- **Health Score Prom.** — promedio del Flow Health Score entre proyectos visibles.
- **Tasa Rechazo QA Prom.** — promedio de la QA Rejection Rate entre proyectos visibles.
- **Tendencia "vs. período anterior"** — compara la ventana actual de 90 días contra la anterior
  (91–180 días atrás), usando `getResolvedJiraIssuesInRange`. Las flechas marcan mejora/empeora
  según si la métrica es "mayor es mejor" (throughput, health) o "menor es mejor" (cycle time,
  tasa de rechazo).

---

## Dónde vive cada cosa (referencia rápida)

| Área | Endpoint / archivo |
|---|---|
| Métricas base (throughput, cycle/lead, velocity, percentiles) | `routes/metrics.ts` |
| Health / Flow Health Score / predictability / CFR | `routes/project-health.ts` |
| Analíticas (flow efficiency, time in status, WIP aging, blocked, comparación) | `routes/analytics.ts` |
| QA rechazados (rejection/bug/impact rate) | `routes/qa-rejected.ts` |
| SLA | `routes/sla.ts` |
| Sprints (completion, reopened) | `routes/sprint-metrics.ts` |
| Forecast (Monte Carlo) | `routes/forecast.ts` |
| CFD | `routes/cfd.ts` |
| Resumen Ejecutivo / portfolio (health/QA/tendencias) | `lib/portfolio-cache.ts` + `routes/portfolio.ts` |
| Helpers compartidos (cycle/lead time, tipos, estados, thresholds) | `lib/jira.ts`, `lib/health-thresholds.ts` |

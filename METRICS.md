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
   tienen `resolutiondate`** (OLI, 90 días: 599 terminados sin resolución vs 168 con). La misma
   regla aplica a `getResolvedJiraIssuesInRange` (período anterior): antes solo miraba
   `resolutiondate` y el período anterior de OLI 1m contaba 49 en vez de 100.
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

### Qué cuenta como "resuelto" (cierres que no son entrega)
Throughput, lead/cycle time, SLA, forecast, portfolio y snapshots de Evolution cuentan solo trabajo
**entregado** (`getDeliveryDate` / `isNonDeliveryClosure`, `lib/jira.ts`). Quedan afuera los issues
de categoría done que son:
- **Cancelados**: estado `Cancelado` (o *cancel/descartad/anulad/won't do*), que Jira pone en
  categoría done.
- **Limpieza de backlog**: **sin asignado al cerrarse y todavía sin asignado** (se reconstruye el asignado al cierre desde el changelog; si estuvo asignado en cualquiera de los dos momentos cuenta como entrega: ORINI-509 se asignó, cerró y desasignó después; OLP-3954 se cerró sin asignado y se asignó después) y cuyo último paso a done vino desde un estado "por
  hacer" (ej. `TO DO → DONE`; no cuenta como limpieza si viene de un estado de QA o bloqueado),
  aunque alguna vez haya tocado in-progress. Caso real: OLP, 2026-10-14, ~25 issues de hasta 600
  días cerrados en bloque llevaron el lead time del mes de ~20 a 81 días.
Un issue **asignado** que se cierra directo desde TO DO (bugs rápidos) sí cuenta. Sin changelog no
hay evidencia de limpieza y cuenta (por eso toda consulta que alimenta estas métricas pide el
changelog, incluidos SLA y Forecast). El CFD sigue usando `getResolutionDate`: ahí el cierre es una
transición real.
**Sprints, Evolution por sprint y Capacity**: un cierre sin entrega que **ya estaba cerrado al
terminar el sprint** queda fuera del sprint (ni alcance ni completado). Si se limpió después, sigue
contando como alcance no completado en los sprints donde estuvo. Caso real: el board de OLI no toma
"Cancelado" como terminado, así que Jira arrastraba cada cancelado al sprint siguiente y la app lo
contaba como completado en todos (OLI-3629: sprints 46-49; 7 completados de más por sprint).
(`computeSprintMetrics`, `computeSprintSnapshot`, `loadSprintIssues` en `routes/capacity.ts`)

### Throughput
Issues resueltos por semana. `resolved.length / weeks`, con `weeks = ceil(periodDays/7)`.
(`routes/project-health.ts`; `/metrics` expone en cambio el **conteo total** del período como
`throughput`.) El KPI "Throughput /wk" del Reporte usa el valor semanal de `/health`
(`raw.throughput`), el mismo con el que se colorea su banda.
En el Resumen Ejecutivo la tarjeta "Throughput (90d)" es la **suma de `doneCount`** de los
proyectos visibles (los últimos 90 días).

### Cycle Time
Días desde que **empezó el trabajo que terminó en la entrega** hasta la resolución. Inicio =
primera transición del changelog hacia un estado de categoría `"indeterminate"` (in-progress)
**después de la última vuelta a backlog**: si el issue sale de in-progress hacia TO DO / Por hacer
/ Backlog / En Cola, el reloj se reinicia en el siguiente in-progress. Las colas del flujo ("Ready
for QA", "READY FOR APPROVE", "Ready for DEV", "Selected for Development") y "Blocked/Bloqueo" no
reinician. Fin = fecha de resolución. (`getCycleTimeDays` / `findWorkStartTransition`, `lib/jira.ts`)
Sin trabajo después de la última pausa (cerrado directo desde backlog) → cycle **null**; el lead
time sí cuenta. Motivo (2026-10-26): contar desde el primer inicio sumaba como trabajo el triage
de OLP (En Cola → En curso → TO DO en minutos al crear el issue) y los meses de pausa en backlog
(OLP-3751: 95 → 13 d; OLP 3m: 20.4 → 13.1 d; SP113 30.9 → 14.5 d).
La categoría de cada transición sale del **id del estado** (`to`/`from` del changelog), no del
nombre: los proyectos team-managed repiten nombres con otra categoría (en OLP "Ready for DEV" y
"Ready for QA" son colas, categoría new; en otros proyectos "READY FOR DEV" es indeterminate) y el
mapa por nombre dejaba ganar al último, así que OLP arrancaba el reloj al encolar (cycle 3m:
26.8 -> 20.4 d al corregirlo). Las búsquedas solo por nombre prefieren el estado global.
(`buildStatusCategoryMap`, `statusCategory`) Se respeta la configuración de cada proyecto en Jira:
si una cola quedó en categoría "In Progress", el ajuste va en el workflow de Jira, no en la app.
Caso: EXP (team-managed) tenía "READY" (cola entre Por hacer y En curso) como In Progress, el default
de Jira para columnas intermedias; se pasó a To Do el 2026-10-26 (cycle 3m: 12.7 -> 9.2 d). Tras un
cambio así, reiniciar la API (el mapa de categorías se cachea en memoria) y recalcular portfolio y
snapshots.
**Sin transición a in-progress** (según el changelog): cycle time **null**, el issue no entra al
promedio (antes caía al Lead Time y un cierre directo de backlog sumaba como meses de trabajo).
**Fallback a Lead Time** solo si no se pidió el changelog.
El changelog es el **completo**: la búsqueda de Jira lo recorta a 40 entradas descartando las más
viejas, y se completa con `/issue/{key}/changelog` (`completeTruncatedChangelogs`). Sin eso el
inicio caía en una entrada a in-progress posterior y el cycle time salía corto (OLP 3m: 31.9 →
36.0 días al corregirlo).
Se promedia sin ponderar sobre los issues resueltos.

### Lead Time
Días desde que se **creó** el issue hasta la resolución: `(resolved - created)`. Incluye el
tiempo en backlog. (`getLeadTimeDays`, `lib/jira.ts`)

### Percentiles (P50/P75/P85/P95)
Percentil por interpolación lineal sobre el arreglo ordenado de cycle/lead times (igual que
`PERCENTILE.INC` de Excel). Una sola fórmula en toda la app: `percentile` / `median` de
`lib/stats.ts`; `computePercentiles` (`routes/metrics.ts`) ya no tiene copia propia.
Población: issues de los tipos habilitados entregados dentro de la ventana (la misma de las
tarjetas del Resumen). El v2 en Scrum usa otra población (issues del sprint cerrados al cierre),
así que sus números pueden no coincidir con los de esta pestaña.

### Qué estadística se muestra (regla de todo el sitio, 2026-11-12)
- **P50 (mediana)** es el número principal de lead/cycle time en todas las pantallas y lo que se
  compara contra la meta: tarjetas del Resumen, Reporte y Reporte por persona (con la tendencia
  "vs período anterior" también en P50), Sprints, Kanban semanal, Equipo, Analíticas, Evolución,
  semáforo, Health y Resumen Ejecutivo.
- **P85** es el número para comprometer plazos ("85% ≤ X" en las tarjetas y en Métricas).
- **Promedio** queda como dato secundario: si se separa mucho del P50 hay casos extremos
  (tabla de issues por encima del P95 en Métricas). Los campos `avg*` de la API se mantienen por
  compatibilidad; los nuevos `median*` son los que muestra el frontend.
- **Por sprint**, lead/cycle time se calculan por fecha de entrega (`sprintDeliveryTimes`,
  `lib/sprint-delivery-times.ts`): cada issue en el sprint en que se entregó. Sprints
  (`medianCycleTimeDays`), Evolución y Métricas muestran el mismo número para un sprint.

### Pestaña Métricas (reemplaza a Health en las pestañas)
`/projects/:id/metrics`, mismo permiso que Health (Health sigue accesible por URL). Todo sale de
`GET /projects/:id/metrics/:period`: promedio + P50/P85/P95 de lead y cycle time del período;
P50/P85/P95 por sprint o semana (`velocityByWeek[].medianLeadTime/leadTimeP85/leadTimeP95`, ídem
cycle, `bucketTimeStats` en `lib/jira.ts`); y `slowestIssues`: entregados del período con lead o
cycle time por encima del P95 del período, más lento primero.

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
`routes/analytics.ts`) Excluye los cierres sin entrega (`withoutNonDeliveryClosures`): con sus
meses en TO DO, la limpieza de OLP del 2026-10-14 subía "TO DO" a 58 días de promedio (27 sin ella).

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
Por sprint individual (pestaña Sprints), la velocity = story points **en Done hoy** (ver Sprint
Completion Rate); puede superar a la del gráfico porque acredita lo arrastrado a cada sprint.

### Sprint Completion Rate
Si el sprint tiene story points cargados: `(doneSp / totalSp) * 100`; si no, por conteo:
`(issuesCompletados / issuesTotales) * 100`. Los promedios de resumen solo incluyen sprints
**cerrados** (excluye el activo). (`computeSprintMetrics`, `routes/sprint-metrics.ts`)
"Completado" = el issue está **hoy** en un estado de categoría Done (`isIssueDone`), en sprints
cerrados y activos — la misma regla de los resúmenes de sprint de Rovo (2026-11-06, para cuadrar
con Rovo: Tablero Sprint 117 = 99 SP comprometidos, 86 SP / 33 issues completados, 86.9%).
Consecuencia aceptada: lo arrastrado y terminado en sprints siguientes se acredita a cada sprint
por el que pasó, así que los sprints viejos tienden al ~100%. Hasta esa fecha se usaba "done al
cierre" (`wasIssueDoneAt`, reconstruido desde el changelog). El throughput de Evolution usa la
misma regla. **Capacidad no**: su histórico y el ritmo de "Recomendado" usan "done al cierre"
(ver Capacity). Tipos incluidos según Admin (Tablero/global: Story, Task, Bug, Spike, Tech Debt); Rovo
además cuenta Epics, que acá no entran.

**% Real cerrado** (`closedAtSprintEndRate`, columna aparte en la pestaña Sprints): para sprints
cerrados, lo que **ya estaba en Done al momento del cierre** (`wasIssueDoneAt` desde el changelog,
mismo alcance y misma base SP/conteo). `null` en el sprint activo (la UI muestra ahí el avance
actual). Tablero Sprint 117: acumulado 86/99 SP (86.9%) vs real cerrado 53/99 SP (53.5%).

### Resumen de sprint (pestaña Resumen)
Informe por sprint al estilo del que generaba Rovo, en la pestaña Resumen de proyectos Scrum
(`GET /api/projects/:id/sprint-summary/:sprintId`, `lib/sprint-summary.ts`). Mismo alcance que la
tabla de Sprints (`sprintScopeIssues`: tipos de Admin, sin limpiezas de backlog). "Completado" =
en Done **al cierre** (`wasIssueDoneAt`, igual que "% Real cerrado"); en un sprint sin cerrar, el
estado actual. Se compara con el sprint que cerró justo antes (`previousClosedSprint`).
Secciones: KPIs (comprometido, entregado, % cumplimiento SP, issues, incompletas al cierre, bugs
resueltos al cierre), SP por integrante (asignado **actual**, como Rovo), rendimiento individual
y distribución por tipo con el nombre real de Jira (Historia, Tarea Técnica, Deuda Técnica, ...)
y las claves de lo pendiente. Tablero Sprint 116 cuadra exacto con Rovo: 85/112 SP (75.9%),
32/42 issues, 10 incompletas (27 SP), 5/5 bugs.

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

Compliance por prioridad, con base en **Lead Time** (no cycle time), sobre los resueltos (entregados)
de los **tipos permitidos en Admin**, igual que el resto de las métricas de flujo (hasta 2026-10-26
no filtraba por tipo y el SLA de OLI era ~70% Tests de QA). Un issue "cumple" si
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

## Trabajo en curso / WIP (pestaña Flujo, pensado para Scrumban)

`GET /projects/:id/wip` (`routes/wip.ts`, lógica pura en `lib/wip.ts`), permiso de Flujo.
- **En curso** = issue abierto (tipos de Admin, clave del proyecto) cuyo trabajo empezó, con la
  misma regla de inicio que el cycle time (`getWorkStartDate` = `findWorkStartTransition`: primer
  paso a en curso después de la última vuelta al backlog). Así la antigüedad de un issue en curso y
  su cycle time final se miden desde el mismo instante. Un issue en "Ready for QA" después de
  desarrollo cuenta (marcado "en espera"); uno en "Ready for DEV" que nunca empezó, no.
- **Antigüedad vs. P50/P85**: el frontend toma los percentiles de cycle time de `/metrics/:period`
  del período elegido (los mismos de Métricas): ámbar > P50, rojo > P85.
- **Entrada vs. salida**: por semana ISO de las últimas 12, issues que empezaron (inicio de trabajo)
  contra entregados (`getDeliveryDate`). La semana actual va incompleta.
- **WIP sostenible** (Ley de Little): throughput diario de las 11 semanas completas × cycle time
  **promedio** de lo entregado en ellas (Little usa promedios, no medianas). Referencia para acordar
  límites de WIP, que en esta etapa los equipos manejan de palabra (no se leen de Jira).

## Evolution (histórico)

- **Kanban (por semana):** filas de `metric_snapshots`, una por proyecto y semana ISO, escritas
  en cada sync. Solo se guardan semanas **completamente dentro** de la ventana de 90 días
  (`snapshotsFullyInWindow`): la semana del borde está parcialmente cubierta, y reescribirla cada
  día dejaba "congelado" el valor más truncado. Las filas dañadas antes del 2026-09-23 (p. ej.
  OLP 2026-06-01/08/15 con throughput 0) se reparan con `POST /api/admin/snapshots/backfill`
  (`backfillWeeklySnapshots`: recalcula lead/cycle time y throughput de semanas completas; la
  tasa de rechazo QA se conserva porque necesita también los issues no resueltos).
- **Scrum (por sprint):** throughput y rechazo QA salen de `computeSprintSnapshot` sobre los
  issues del sprint, con la regla de "completado = Done hoy" (igual que la pestaña Sprints).
- **Lead/Cycle Time = mediana** (desde 2026-11-12), para comparar contra la meta igual que el
  semáforo y Health. En Scrum se calcula **por fecha de entrega** (`sprintTimeMedians`, mismos
  buckets que el gráfico del Resumen y la pestaña Métricas): cada issue cuenta una sola vez, en el
  sprint en que se entregó. Antes era el promedio de los issues *del* sprint en Done hoy, y un
  issue que pasó por varios sprints sumaba en cada uno (OLP-3330, 427 d, en 116 y 117: el 117
  marcaba ~32 d con una mediana de 8 d). En Kanban las filas de `metric_snapshots` guardan la
  mediana en las columnas `lead_time_avg`/`cycle_time_avg` (nombre heredado); las semanas
  escritas antes se pasan a mediana re-corriendo el backfill.

---

## Índices compuestos

### Flow Health Score (antes mal llamado "DORA Score")
`round( ( normalize(throughput) + normalize(cycleTime) + normalize(cfr) ) / 3 )` — promedio de
tres dimensiones normalizadas 0–100 contra los umbrales de Admin. (`routes/project-health.ts`)
`cycleTime` es la **mediana (P50)** de los resueltos en la ventana, igual que en el Resumen.
⚠️ **No son las métricas DORA reales** (usa throughput de issues, no frecuencia de despliegue; y
CFR = bugs/resueltos). Es un índice de salud de **flujo** derivado solo de Jira. Alimenta la
tarjeta "Health Score (Flujo)" del Reporte y "Health Score Prom." del Resumen.

### KPIs del Resumen Ejecutivo
- **Proyectos en Riesgo** — conteo de proyectos en semáforo Rojo / Amarillo de la tabla. El
  semáforo por proyecto es el peor estado entre sus dimensiones (Flujo, Cycle Time, Lead Time,
  Entrega). (`dashboard.tsx`)

### Criterio de salud para Cycle / Lead Time: mediana (P50)
Toda vez que se deriva un estado de salud de Cycle Time o Lead Time se usa la **mediana** de los
resueltos en la ventana (`median` en `lib/stats.ts`): semáforo del Resumen Ejecutivo, dimensiones
y sugerencias de Health, Flow Health Score (Health y Resumen), e insight de "cruzó a estado
crítico" del Reporte. Con el promedio, cerrar backlog viejo (tickets de cientos de días) dejaba al
proyecto en rojo durante 90 días aunque el ritmo actual estuviera bien (caso Olimpo, 2026-10-05:
Lead Time promedio 41.6d vs mediana 23.4d). Los promedios se siguen mostrando como dato
informativo (tarjetas "Lead Time Prom.", Analíticas, Flow Efficiency) pero no definen colores.
- **Health Score Prom.** — promedio del Flow Health Score entre proyectos visibles.
- **Tasa Rechazo QA Prom.** — promedio de la QA Rejection Rate entre proyectos visibles.
- **Tendencia "vs. período anterior"** — compara la ventana actual de 90 días contra la anterior
  (91–180 días atrás), usando `getResolvedJiraIssuesInRange`. Las flechas marcan mejora/empeora
  según si la métrica es "mayor es mejor" (throughput, health) o "menor es mejor" (cycle time,
  tasa de rechazo).

---

## Capacity (sprint actual y próximo, solo Scrum)

- **Ritmo del equipo e histórico = lo cerrado AL CIERRE de cada sprint** (`wasIssueDoneAt`, igual
  que "% Real cerrado" en Sprints), desde 2026-11-12. Con "Done hoy" un issue arrastrado y
  terminado después contaba como entregado en cada sprint por el que pasó (OLP 117: ~86 SP contra
  53 cerrados) y "Recomendado" pedía comprometer más de lo que el equipo cierra en un sprint. El
  sprint activo sigue con "Done hoy" para Hecho/Restante. (`loadSprintIssues`, `routes/capacity.ts`)

- **Vistas**: selector *Actual / Próximo* (`?sprint=active|next`). Sin parámetro (primera carga):
  primer sprint futuro del tablero; si no hay, el activo.
- **Próximo sprint**: siempre 10 días hábiles (regla del equipo: arranca lunes, dura 10 días).
- **Sprint actual**: días hábiles reales entre inicio y fin del sprint. Hoy cuenta como restante;
  en fin de semana, restan los días desde el lunes. Hecho = estado actual done (`isIssueDone`).
  - *Esperado a hoy* = recomendación × días transcurridos ÷ días del sprint (lineal: al principio
    del sprint es exigente si el equipo cierra todo al final). Ritmo: hecho ≥ piso esperado ok,
    hasta 15 % por debajo atención, más atrás rojo.
  - *Carga por persona*: lo que le queda abierto (asignado − hecho) ÷ (días disponibles que le
    quedan × P50). Con ausencias por fecha: `días restantes × dedicación − ausencias de hoy en
    adelante` (las que ya pasaron no restan). Sin fechas (solo el número): la ausencia se reparte
    pareja, `días disponibles × días restantes ÷ días del sprint`.
- **Ausencias por fecha** (`capacity_absence`): día del sprint + día completo / mañana / tarde + tipo
  (vacaciones, licencia médica, trámite personal, capacitación, feriado, otro) + motivo libre. Día
  completo = 1, mañana o tarde = 0,5; el total reemplaza al número cargado a mano y se guarda también
  en `sprint_capacity.absence_days`, que es lo que usa el histórico. Un sprint futuro sin fechas en
  Jira se asume desde el lunes siguiente al cierre del activo, 10 días hábiles.
- **Tasa del equipo**: últimos 6 sprints cerrados. Por sprint, `SP completados / días-persona` e
  `issues completados / días-persona`; `días-persona = Σ (días hábiles reales × dedicación − ausencia)`
  con la disponibilidad guardada en Capacity, o cada asignado a tiempo completo si el sprint no se
  planificó ahí. Completado = Done hoy (`isIssueDone`). Solo issues del proyecto (prefijo
  de clave) y tipos permitidos. P25/P50/P75; con < 3 sprints utilizables no hay recomendación.
- **Recomendación**: `días-persona disponibles × [P25, P75]`, en SP y en issues.
- **Rol por persona** (`capacity_roster.role`: dev / lt / qa / po / sm / other, admin, por proyecto):
  reemplaza al check "Cuenta". Solo Dev y LT cuentan. Dedicación por defecto (si no se guardó nada
  para el sprint): LT 50 %, el resto 100 %; aplica también a los asignados de sprints pasados sin
  disponibilidad guardada, así el histórico y el sprint actual miden el mismo equipo. Las filas
  existentes se migraron a `dev` (contaban) u `other` (no contaban).
- **Equipo del sprint** (`teamSummary`): personas del sprint por rol (sin quienes salieron), devs
  efectivos = persona-días disponibles ÷ días del sprint, promedio histórico de devs efectivos de los
  sprints que alimentan el ritmo, y aviso si alguien que salió tiene issues asignados.
- **Salió del equipo** (`capacity_roster.departed`, admin, reversible): la persona deja de ser parte
  del equipo del sprint activo y de los próximos aunque todavía tenga issues asignados, pero sus
  sprints cerrados siguen en el ritmo histórico (días y entrega). No usar "Cuenta" = no para alguien
  que se fue: eso quita sus días del histórico pero deja su entrega, e infla el ritmo por persona-día.
- **Quién cuenta**: solo los devs. Admin marca una vez por proyecto quién cuenta (`capacity_roster`);
  aplica a todos los sprints, también al histórico: quien no cuenta no suma días-persona (lo que
  completó sí suma a lo hecho por el equipo). En un sprint cerrado, los días-persona son la
  disponibilidad guardada + cada otro asignado que cuenta, a tiempo completo.
- **Equipo del sprint**: quienes cuentan y aparecen en el último sprint cerrado, el activo o
  el próximo (en la vista Actual: el último cerrado y el activo), más los agregados a mano. Los que solo están en sprints anteriores se listan para
  decidir si cuentan, pero no suman disponibilidad.
- **Carga por persona**: capacidad = sus días disponibles × P50 del equipo; carga = asignado /
  capacidad (la peor entre SP e issues). ≤ 85 % ok, ≤ 110 % atención, > 110 % sobrecarga. Mide
  carga, no rendimiento: no hay velocity individual.
(`lib/capacity.ts`, `routes/capacity.ts`; disponibilidad por sprint en `sprint_capacity`, ausencias por fecha en `capacity_absence`, quién cuenta en `capacity_roster`)

---

## v2 (vistas `/v2`: Portafolio, Equipo, Sprint)

Convive con la app actual; todo sale de `artifacts/api-server/src/lib/v2/` (cálculos puros) y
`lib/v2/service.ts` (los conecta con Jira). Regla de oro: el titular por sprint es **Rovo (Done hoy)**
con el "% real cerrado" al lado, pero tendencias, predictibilidad, recomendación de planning y
"Requiere atención" usan **solo el real cerrado**.

### SprintFacts: Rovo vs real cerrado
- Alcance = `sprintScopeIssues` (tipos permitidos). Base: story points si hay comprometidos, si no, conteo de issues.
- **Rovo (Done hoy)**: `scope.filter(isIssueDone)` — estado actual, sirve también para el sprint activo (`rovoDoneSp/Issues`, `rovoRate`).
- **Real cerrado**: solo sprints cerrados; `wasIssueDoneAt(issue, sprintCloseTime)` con el changelog (`realDoneSp/Issues`, `realRate`). En el activo es `null`.
- **No planificado** (`addedRate`): `isAddedAfterPlanning`. **Arrastrado** (`carryoverRate`): `isCarryoverIssue`. Ambos sobre el comprometido, en la misma base.
- **`deliveredByType`**: lo entregado (real si cerrado, si no Rovo) por `getEffectiveIssueType`: Story → historia, Bug → bug, resto → técnico. Ciclo/lead por issue entregado: `getCycleTimeDays`/`getLeadTimeDays`.
(`lib/v2/sprint-facts.ts`, `computeSprintFacts`)

### Ventana y comparación
- `display` = últimos N sprints **cerrados** (N = 3, 6 o 12; otro valor → 6) ordenados por cierre; `active` aparte.
- `recent`/`previous`: N=3 compara contra los 3 cerrados anteriores; N=6/12 parte `display` por la mitad (últimos N/2 vs primeros N/2). Con menos de N cerrados no hay `previous` ni comparación.
- Kanban: ventana en días (30/90/180, otro → 90); período actual vs el anterior de igual largo.
(`lib/v2/window.ts`, `selectSprintWindow`, `parseSprintWindow`, `parseDayWindow`)

### Cumplimiento y predictibilidad (Scrum)
- Cumplimiento = media de `realRate` de `display`; min/max de esas tasas; `deltaPp` = media(recent) − media(previous) en pp.
- **Predictibilidad** = desvío estándar **muestral** (n−1) de los `realRate` (null con < 2 sprints). Banda por umbral `sprintPredictability` (default 8/12): ≤ good → alta, ≤ warning → media, si no baja.
(`lib/v2/team-scrum.ts`, `buildScrumTeamView`; `lib/v2/stats.ts`, `sampleStdDev`, `predictabilityBand`)

### Tendencias
Filas `before → after` con `delta`: Scrum (recent vs previous): realRate, addedRate, carryoverRate en **pp**; closedSp, closedIssues, cycleMedian, leadMedian en **%** relativo (cycle/lead = mediana de los tiempos de todos los issues del grupo). Kanban (actual vs anterior): closedIssues, cycleMedian, leadMedian en %. Sin base (0 o null) → delta null. Cada fila lleva `betterWhen` (up/down) para colorear.
(`lib/v2/stats.ts`, `pctChange`, `ppChange`; `buildTrends` en `team-scrum.ts`; `buildKanbanTeamView`)

### Recomendación de planning
Solo con los últimos 3 sprints cerrados y todos con real cerrado. `total` = media de lo cerrado real (SP solo de sprints con base SP; issues de todos), `noPlanificado%` = media de `addedRate`; `planificar = total × (1 − noPlanificado%)`; margen = total − planificar. Todo redondeado con `Math.round` (total, planificar y margen salen de valores ya redondeados).
(`lib/v2/planning.ts`, `recommendPlanning`)

### Tiempos
Ciclo y lead: mediana y P85 (P85 a 1 decimal). **Flow efficiency = media(ciclo) / media(lead) × 100** (null si no hay datos o lead = 0). Scrum agrupa los entregados de `display`; Kanban los del período actual.
(`lib/v2/flow-block.ts`, `buildFlowBlock`)

### Tiempo por estado y WIP envejecido
- Tiempo por estado: `computeTimeInStatus` filtrado a la categoría **"en curso"** (`indeterminate`) **más** los estados de categoría `new` cuyo nombre es de espera (`isWaitingStatus`: "Ready for DEV", "Ready for QA"; decisión 2026-11-09). El backlog ("To Do", "Backlog", "Por hacer", "Open") queda fuera. Flow efficiency no cambia. Ordenado por promedio de días; `waiting` = `isWaitingStatus` (regex de nombres de espera: ready/aceptad/listo/espera/pending/bloqueado…).
- WIP: total de en curso y los envejecidos (`computeWipAging`, nivel `warning`/`critical` según umbral `wipAging`). Scrum: en curso del sprint activo, **solo en "Sprint actual"**; Kanban: abiertos del proyecto.
- Scrum, ventanas 3/6/12: **solo sprints cerrados** (decisión 2026-11-11). El tiempo por estado sale de los issues de `display`, sin el sprint en curso, y `flow.wip` es `null`. Antes se mezclaban los issues a medio camino del sprint activo con los de los sprints cerrados.
(`lib/v2/flow-block.ts`, `flowStatusRows`, `wipBlock`; `lib/flow-insights.ts`)

### Sprint actual (pestaña de Equipo, Scrum)
`GET /api/v2/projects/:id/current-sprint`, con `getCurrentSprintView` en `lib/v2/service.ts` y cálculos puros en `lib/v2/current-sprint.ts`.
- Hechos del sprint activo con `computeSprintFacts` (avance = `rovoRate`, Done hoy; no hay "real cerrado" mientras está abierto). Tiempo por estado y WIP solo de los issues de ese sprint (`sprintScopeIssues`).
- **Días hábiles** (`sprintBusinessDays`): lunes a viernes, por día calendario local en `SPRINT_TIMEZONE`, sin feriados. `total` = del día de inicio al de fin; `elapsed` = días ya completos, antes de hoy; `current` = número del día de hoy (sábado y domingo cuentan como el viernes anterior).
- **Avance esperado** = `elapsed / total × 100` (línea recta). La tarjeta compara `rovoRate` contra ese valor, en pp.
- **Pendiente** = comprometido − Done hoy, en SP y en issues.
- **No planificado** (`addedRate`) se compara contra `planning.unplannedPct` de la vista de 6 sprints, que es la media de los últimos 3 cerrados.
- **Composición** (SP): nuevo planificado = comprometido − agregado − arrastrado (mínimo 0), arrastrado y agregado después de la planning.
- Por integrante y por tipo: el mismo `sprint-summary` de la vista Sprint.
- El burnup diario queda pendiente para una segunda entrega.

### Kanban
Entregados = resueltos con `isIssueDone`, sin `isNonDeliveryClosure`, tipos permitidos menos los excluidos de Kanban, fecha real de `getResolutionDate`. Se consultan 2× los días de la ventana (actual + anterior). Semanas = ISO (lunes, `isoWeekStart`), con las vacías incluidas, apiladas historia/técnico/bug con ciclo y lead promedio por semana. `deliveredDeltaPct` = % de cambio del conteo.
(`lib/v2/team-kanban.ts`, `buildKanbanTeamView`; `lib/v2/service.ts`, `buildKanban`)

### Portafolio
Cada fila se **copia de la vista de equipo** (`toPortfolioRow`), así Portafolio y Equipo nunca divergen: Scrum usa cumplimiento real, banda, min/max, entregados = suma de `realDoneIssues` de los sprints, `deliveredDeltaPct` = tendencia closedIssues, no planificado/arrastrado = media de `display`; Kanban usa los entregados de 90 días (siempre 90 en el portafolio); su lectura nunca es de atención (cae a la mejor señal favorable). Un proyecto que falla en Jira sale como fila de error, no rompe el resto.
- **Resumen**: media de cumplimiento real de los equipos Scrum, cuántos mejoran (`realDeltaPp > 0`), lista de atención.
- **Lectura por fila**: primero la atención; si no, mejora de cumplimiento, "más y más rápido", más entregado, ciclo menor, o "sin cambios relevantes". **Titular**: "N equipos mejoran su cumplimiento" + primer equipo con atención.
(`lib/v2/portfolio.ts`, `toPortfolioRow`, `readingFor`, `buildPortfolioView`)

### "Requiere atención"
Umbrales efectivos del proyecto (`getEffectiveThresholds`, warning; defaults entre paréntesis):
- Scrum: cumplimiento real medio < `sprintCompletionReal` (50) o banda de predictibilidad "baja" (`sprintPredictability`).
- Kanban: **nunca se marca** (decisión 2026-11-09). Sigue en la tabla del portafolio con volumen y tiempos, pero su `attention` es siempre `[]`: no aparece en "Requiere atención", ni en el titular, ni con banner en su página de Equipo. Los umbrales `kanbanThroughputDrop` / `kanbanCycleTimeRise` se retiraron (las filas antiguas en DB se ocultan en Admin → Health).
Los valores del motivo van con un decimal (es-CL) y nunca se redondean sobre el corte: 49,96 → "cumplimiento real 49,9%", no "50%".
(`lib/v2/attention.ts`, `scrumAttention`; `lib/v2/thresholds.ts`, `applyThresholds`)

### Resumen de sprint: `doneToday*`
`sprint-summary.ts` expone `doneTodayStoryPoints/Issues/Rate` (estado actual, = Rovo) junto a las cifras de real cerrado; el titular de la vista Sprint usa Done hoy y muestra el % real cerrado al lado. (`lib/sprint-summary.ts`)

### Caché y precalentado
- Clave `v2:team:<projectId>:s<n>` (Scrum) o `:d<días>` (Kanban), vía `withCache` (TTL 6 h). `getTeamView` en `lib/v2/service.ts`.
- El sync precalienta (`warmV2Cache`, serie, un proyecto a la vez) **solo** `s6` / `d90`, más `v2:current:<projectId>` en los Scrum; otras ventanas se calculan al pedirlas.
- Sprint actual: clave `v2:current:<projectId>`. `businessDays` y `expectedRate` dependen de hoy y **no** se cachean: `withBusinessDays` los recalcula en cada lectura.
- Jira se lee con los helpers `*OrThrow`: si Jira falla se rechaza y **no se cachea** (si no, un sprint vacío daría 0 % por 6 h).
- Lo que depende de umbrales (banda de predictibilidad, atención y el objeto `thresholds` que usa el frontend para colores y textos) **no** se cachea: `applyThresholds` lo recalcula en cada lectura con `getEffectiveThresholds(projectId)`, así un cambio en Admin → Health aplica en la siguiente petición. El portafolio agrega `thresholds` globales (sin override) para su pie de página; cada fila trae los de su proyecto. (`lib/v2/thresholds.ts`)
- **Límites conocidos**: una vista cacheada congela el WIP envejecido (umbral `wipAging`) y el "próximo sprint" hasta 6 h (o hasta el siguiente sync/refresh).

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
| Capacity (próximo sprint, carga por persona) | `routes/capacity.ts` + `lib/capacity.ts` |
| Vistas v2 (Portafolio, Equipo, Sprint) | `lib/v2/*.ts` + `lib/v2/service.ts` |
| Helpers compartidos (cycle/lead time, tipos, estados, thresholds) | `lib/jira.ts`, `lib/health-thresholds.ts` |

# Definición de Métricas — Agile Metric Hub

> Documenta **cómo se calcula realmente cada métrica en el código** (no la definición
> ideal de libro). El objetivo es que los números sean **defendibles**: que un líder
> técnico o scrum master pueda saber exactamente qué mide cada valor, con qué datos, y
> qué supuestos hay detrás. Las referencias `archivo:línea` apuntan a la implementación.
>
> Última actualización: 2026-07-24. Si cambiás una fórmula en el código, actualizá acá.

---

## Advertencias transversales (leer primero)

Estas afectan a **casi todas** las métricas:

1. **Ventana máxima de 90 días.** Todo fetch de issues a Jira está tope-ado a 90 días hacia
   atrás (`JIRA_MAX_LOOKBACK_DAYS`, `lib/jira.ts`). Los períodos son: **`1m` = 30 días**,
   **`3m` = 90 días**. Pedir más de 90 días se recorta en silencio (para comparaciones
   históricas más largas existe `getResolvedJiraIssuesInRange`, que sí supera el tope).
2. **Cycle Time depende del changelog.** Si el fetch no pide `includeChangelog: true`, el
   Cycle Time cae en silencio a Lead Time (ver definición abajo). Los endpoints que muestran
   cycle time ya piden changelog; tenerlo presente si se agrega uno nuevo.
3. **Truncamiento en proyectos muy activos.** El workaround de paginación de Jira trae hasta
   ~100 issues por ventana de 7 días; un proyecto que resuelva más de ~100 issues en una
   semana puede tener métricas calculadas sobre datos incompletos sin aviso visible
   (ver `MEJORAS-PROPUESTAS.md` → DAT-1). Con los volúmenes actuales (OLI ~16/sem, OLP ~8/sem)
   es latente, no activo.
4. **Umbrales desde Admin.** Los colores/scores comparan contra los umbrales configurados en
   **Admin → Health** (`getEffectiveThresholds`: default global + override por proyecto). No
   están hardcodeados por pantalla.
5. **Tipos de issue filtrados.** Portfolio y varias vistas solo cuentan los tipos permitidos
   en la config de Portfolio (`getPortfolioAllowedIssueTypes`, por defecto Story/Task/Bug).

---

## Definiciones base

**"Resuelto en el período"** — en toda la app significa: `isIssueDone(issue)` (categoría de
estado `"done"`, con fallback regex ES/EN si Jira no devuelve `statusCategory`) **Y** su fecha
de resolución `>= startDate`. (`lib/jira.ts:121`)

**Fecha de resolución** (`getResolutionDate`, `lib/jira.ts:410`) — en orden: (1) el campo
`resolutiondate`; (2) si no, la **última** transición del changelog hacia un estado "done";
(3) fallback final: el campo `updated`.

**Story points** (`getStoryPoints`, `lib/jira.ts:137`) — el primero con valor entre
`customfield_10016`, `customfield_10028`, `customfield_10072`; si ninguno, `0`. ⚠️ Los IDs de
campo son específicos de esta instancia de Jira.

**`normalize(value, worst, best)`** (`lib/health-thresholds.ts:81`) — proyecta un valor crudo a
un score **0–100**. `worst` es el ancla del 0, `best` la del 100 (da igual cuál sea mayor: así
soporta métricas "mayor es mejor" y "menor es mejor"). Clampa el valor dentro del rango antes de
calcular, de modo que un valor peor que `worst` da 0 (no se "envuelve" a 100). En los usos de
Health, `worst = warningValue` y `best = goodValue` de Admin.

---

## Métricas de flujo

### Throughput
Issues resueltos por semana. `resolved.length / weeks`, con `weeks = ceil(periodDays/7)`.
(`project-health.ts:71`; en `metrics.ts` se expone también el conteo crudo `throughput`.)
En el Resumen Ejecutivo la tarjeta "Throughput (90d)" es la **suma de `doneCount`** de los
proyectos visibles (los últimos 90 días).

### Cycle Time
Días desde que **empezó el trabajo activo** hasta la resolución. Inicio = **primera** transición
del changelog hacia un estado de categoría `"indeterminate"` (in-progress); fin = fecha de
resolución. (`getCycleTimeDays`, `lib/jira.ts:467`)
**Fallback:** si no hay changelog o no hay transición a in-progress, devuelve el Lead Time.
Se promedia sin ponderar sobre los issues resueltos.

### Lead Time
Días desde que se **creó** el issue hasta la resolución: `(resolved - created)`. Incluye el
tiempo en backlog. (`getLeadTimeDays`, `lib/jira.ts:456`)

### Percentiles (P50/P75/P85/P95)
Percentil por interpolación lineal sobre el arreglo ordenado de cycle/lead times.
(`computePercentiles`, `metrics.ts:49`)

### Distribución de Cycle Time
Buckets semiabiertos `[min,max)`: `0-1d`, `1-3d`, `3-7d`, `7-14d`, `14d+`. (`metrics.ts:226`)

### WIP (Work In Progress)
Cantidad de issues actualmente en categoría `"indeterminate"` (`isIssueInProgress`). El conteo
usa **issues abiertos sin tope de fecha** (`getOpenIssuesForProject`), no solo los del período,
para no perder issues abiertos hace más de 90 días.

### WIP Balance / wipRatio
`(enProgreso / total) * 100`. (`project-health.ts:93`) La dimensión "WIP Balance" del Health
es `normalize(wipRatio, warning, good)`.

### Flow Load (WIP / Throughput)
`WIP / throughput` — cuánto trabajo se acumula por cada unidad que sale. **Menor es mejor**
(>1 = entra más de lo que sale). En el Resumen: `totalWip / totalThroughput`.

### Flow Efficiency
`avgCycleTime / avgLeadTime * 100`. Qué proporción del lead time fue trabajo activo (vs espera).
(`analytics.ts:255`) Usa promedios sin ponderar de los resueltos en la ventana.

### Time in Status (cuellos de botella)
Por issue, recorre el changelog sumando la duración en cada estado (desde `created`, cerrando en
la resolución o en "ahora" si sigue abierto). Por estado reporta `totalDays`, `avgDays`,
`medianDays`, `issueCount`; se ordena por `avgDays` descendente. (`computeTimeInStatus`,
`analytics.ts:89`)

### WIP Aging
Antigüedad (días) de cada issue en progreso desde su **última** entrada a in-progress (fallback:
`created`). Buckets vía Admin (`wipAging`): `days >= warningValue` → **crítico**;
`>= (good+warning)/2` → **advertencia**; `>= goodValue` → **watch**. Los conteos se calculan
sobre la lista completa, no solo los items mostrados. (`analytics.ts:335`, `getAlertLevel:69`)

### CFD (Diagrama de Flujo Acumulado)
Para cada día del período, cuenta cada issue como: `done` si ya estaba resuelto ese día; si no,
`inProgress` si ya había entrado a in-progress; si no, `todo`. Requiere changelog (si no, la
banda "En Progreso" queda siempre en 0). (`cfd.ts`)

---

## Entrega y predecibilidad

### Velocity
**Solo Scrum** (Kanban = `null`). `storyPointsTotal / sprintCount`, donde `sprintCount` = sprints
cerrados en el período, o estimado como 1 sprint cada 14 días si no hay. (`metrics.ts:95`)
Por sprint individual, la velocity = story points completados (`doneSp`).

### Sprint Completion Rate
Si el sprint tiene story points cargados: `(doneSp / totalSp) * 100`; si no, por conteo:
`(issuesCompletados / issuesTotales) * 100`. "Completado" = `isIssueDone`. Los promedios de
resumen solo incluyen sprints **cerrados** (excluye el activo). (`sprint-metrics.ts:100`)

### Predictability
`clamp(100 - (stddev / avg) * 50, 0, 100)` sobre el throughput semanal (solo semanas con
actividad). Cuanto más estable el throughput semana a semana, más alto. Default `50` si no hay
throughput. (`project-health.ts:95`)

### Tendencias (velocity / throughput trend)
Comparación **primera mitad vs segunda mitad del mismo período** (no período-contra-período):
`((segunda - primera) / primera) * 100`. (`calculateTrend`, `metrics.ts:44`)
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
de despliegue. (`project-health.ts:90`) La dimensión "Quality" = `normalize(cfr, warning, good)`.

### QA Rejection Rate (tasa de rechazo de QA)
`issuesRechazados / issuesQueEntraronAQA` (redondeado a 1 decimal). (`qa-rejected.ts:219`)
- **Denominador:** issues únicos con ≥1 transición **hacia** un estado QA dentro del período.
- **Numerador:** issues únicos con una transición QA → estado de dev/backlog dentro del período.
- Ambos acotados a la ventana `[since, ahora)` — transiciones fuera del período no cuentan.

### Bug Rate (desde QA)
`bugsVinculados / issuesQueEntraronAQA`. Bugs vinculados vía `issuelinks` a los issues escaneados
(deduplicados). (`qa-rejected.ts:236`)

### QA Impact Rate (impacto combinado)
`(issues rechazados ∪ issues con bug vinculado) / issuesQueEntraronAQA` — stories únicas que
fueron rechazadas **o** tienen un bug vinculado. (`qa-rejected.ts:240`)
> Ojo: el `qaImpactRate` **por sprint** usa la **suma** (rechazados + bugs), no la unión — puede
> diferir levemente del overall.

### Reopened Count
Issues que entraron a un estado "done" y **después** salieron de done. (`countReopenedIssues`,
`lib/jira.ts:541`; detección por categoría con fallback regex ES/EN.)

### Blocked (bloqueos)
Se calcula el **tiempo bloqueado** por issue recorriendo transiciones de estado + campo `Flagged`
(abre intervalo al bloquearse, cierra al desbloquearse). Solo tipos Story/Task/Bug. Un issue
resuelto no puede estar "bloqueado ahora". (`analytics.ts:402`) El **% bloqueado** del Health/
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

## Índices compuestos

### Flow Health Score (antes mal llamado "DORA Score")
`round( ( normalize(throughput) + normalize(cycleTime) + normalize(cfr) ) / 3 )` — promedio de
tres dimensiones normalizadas 0–100 contra los umbrales de Admin. (`project-health.ts:117`)
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

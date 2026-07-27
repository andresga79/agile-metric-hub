# Session Log — Agile Metric Hub (2026-07-21 al 2026-07-26)

> **Estado al último corte (2026-07-26):** todas las secciones de la UI revisadas y corregidas.
> Se hizo una auditoría crítica del proyecto → `MEJORAS-PROPUESTAS.md` (27 mejoras priorizadas) y
> se implementó el Tier 1, Tier 2 y ahora el **Tier 3 de Seguridad (backend)** (ver secciones 8 y 10):
> SEC-3 (RBAC server-side), SEC-4 (headers/rate-limit/body) y SEC-2 parcial (bcrypt 12). Se
> **preparó el deploy** (Vercel + Render + Neon) pero **todavía NO está desplegado** — falta que el
> usuario haga los pasos manuales en las plataformas (ver sección 9 y `DEPLOY.md`). Pendientes:
> activar el CI (QA-2), hacer el deploy, y el residuo de SEC-2 (forced password change, necesita UI).
> Backlog restante: Tier 4.

Registro de todo lo hecho para poder continuar entre sesiones y entre PCs sin perder
contexto: qué se hizo, por qué, qué metodología se siguió en cada revisión, y qué
queda pendiente. **Este archivo se actualiza cada vez que se retoma el trabajo** —
si seguís desde acá, actualizalo de nuevo antes de cortar.

## 0. Estado del repo

- Rama `main`, remoto `origin` → `https://github.com/andresga79/agile-metric-hub.git`
- Todo lo de abajo ya está **commiteado y pusheado**. Working tree limpio al cierre de esta sesión.
- Identidad de git usada (**local al clon, no global**): `user.name = andresga79`,
  `user.email = andresga79@users.noreply.github.com`. En otra PC hay que configurar
  esto de nuevo (o usar la que ya tengas) — no viaja con el repo.

### Commits (orden cronológico)

| Commit | Resumen |
|---|---|
| `0b4b07f` | fix: unblock Docker builds (pnpm prerelease resolution, missing CA certs, lib/integrations) |
| `6fa8e86` | feat: admin-configurable health thresholds with per-project overrides |
| `c85545e` | ux: color KPI values and targets by health status on project detail |
| `caeec4c` | fix: correct cycle time, unbounded WIP, and blocked count on Team page |
| `fdf5287` | fix: correct sprint metrics — active-sprint averaging, reopened count, admin thresholds |
| `b7e8ebd` | fix: correct analytics period comparison and admin-configurable SLA/flow thresholds |
| `50693f4` | fix: remove debug leakage from Kanban API, share reopened-count fix, weight cycle time by issue |
| `aec3bc5` | docs: add session log for continuity across machines |
| `7338106` | fix: migrate default_metric_thresholds table for per-project overrides (desde otra PC) |
| `616d329` | fix: correct portfolio WIP undercount and simplify dashboard summary (desde otra PC) |
| `85cc7e5` | fix: correct Forecast window clamping and issue-type consistency (desde otra PC) |
| `3242205` | fix: CFD in-progress band and Spanish bug-type detection in Health/metrics (desde otra PC) |
| `b6f17bc` | docs: update session log with the other machine's commits |
| `3756c10` | fix: correct WIP aging severity counts and time-in-status window on Flow page |
| `5f02cf1` | docs: mark Flow review as done in session log |
| `16e502f` | fix: Evolution page ignoring a project's own admin threshold override |
| `afc3981` | fix: QA Rechazados — acotar transiciones al período y no perder issues abiertos de larga duración |
| `0840b72` | fix: remove broken PDF export from project report |
| `cdaf17c` | feat: add Health Score and QA rejection rate to project report |
| `b64980a` | feat: add risk/health/QA KPIs and fix 90d mislabel on Resumen Ejecutivo |
| `3b3adcf` | docs: add critical improvement audit (MEJORAS-PROPUESTAS.md) |
| `acf719a` | docs: add adjusted priority plan for demo + trust-the-numbers context |
| `1b6808a` | fix: repair broken period-over-period comparison in Analytics (DAT-2) |
| `5ad1436` | refactor: rename "DORA Score" to Flow Health Score, remove dead DORA object (MET-1) |
| `3edb795` | docs: add FE-6 (Report stuck on Cargando... after failed fetch) |
| `5fb063b` | test: add first unit test suite for pure metrics logic — vitest (QA-1) |
| `57af2bc` | docs: add METRICS.md documenting every metric's real formula (DOC-1) |
| `8f31da0` | fix: don't overwrite good portfolio rows with nulls on timeout/error (DAT-4) |
| `7bb2ac4` | fix: model jira_cache in Drizzle schema so drizzle-kit won't drop it (DAT-3) |
| `2a74f53` | feat: add global Express error handler + JSON 404 (QA-4) |
| `a9cec98` | chore: enable TypeScript strict mode (QA-3, part 1) |
| `f2a3282` | chore: add ESLint baseline (QA-3, part 2) |
| `2d2c158` | fix: harden auth secrets and CORS for public deploy (SEC-1/2/4) |
| `b34e5cf` | chore: add deploy config for Vercel + Render + Neon (Option B) |
| `f0610fe` | docs: log deploy preparation (Vercel+Render+Neon) and its not-yet-deployed state |
| *(este commit — `git log --oneline -1`)* | fix: enforce section RBAC server-side + login rate limit/headers/bcrypt (SEC-3/4/2) — ver sección 10 |
| *(parkeado en rama `ci-workflow`, no en main)* | ci: GitHub Actions workflow typecheck+test (QA-2) — ver sección 8 |

Cada mensaje de commit tiene el detalle completo del "por qué" — `git log -p <hash>` o
`git show <hash>` para el diff exacto.

## 1. Setup del entorno (para reproducir en otra PC)

1. **Clonar**: `gh repo clone andresga79/agile-metric-hub` (o `git clone` normal si ya tenés `gh auth login` hecho).
2. **Docker**: necesita Docker Engine + Compose plugin instalados (no hay entorno nativo alternativo documentado; esta sesión corrió todo vía `docker compose up -d --build`).
3. **`.env`**: no viaja con git (está en `.gitignore`). Copiar `.env.example` a `.env` y completar:
   - `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` — mismas credenciales que ya usás (Jira Cloud, `https://nxtaraspa.atlassian.net`). El token no se guarda en ningún lado del repo por seguridad — hay que tenerlo a mano o generar uno nuevo en https://id.atlassian.com/manage-profile/security/api-tokens.
   - `DEFAULT_ADMIN_PASSWORD` — la que quieras usar para el usuario `admin` (esta sesión usó `admin123`, pero eso solo aplica en el primer arranque de una DB nueva; si reusás el volumen de Postgres ya existente, el usuario admin ya existe con la password que se seteó la primera vez).
4. **Levantar todo**: `docker compose up -d --build` desde la raíz del repo. Levanta `db` (Postgres), `api` (Express, puerto 8000) y `web` (nginx + dashboard, puerto 80).
5. **Verificar**: `curl http://localhost:8000/api/sync/status` (debería dar 200) y abrir `http://localhost` en el navegador.

### Gotchas de entorno ya resueltos (no deberían repetirse, pero por si acaso)

- **pnpm pineado en `package.json`** (`pnpm@12.0.0-alpha.17`, un prerelease) — `corepack` no lo resuelve bien en algunos entornos. Si `pnpm install` falla raro, instalar manualmente: `npm install -g pnpm@12.0.0-alpha.17` (borrando antes cualquier shim roto en el bin de node).
- **pnpm 12 (reescrito en Rust) necesita `ca-certificates`** — si corrés `pnpm install` dentro de una imagen `node:*-slim` y falla con "No CA certificates were loaded", instalar `ca-certificates` primero. Ya está arreglado dentro de `docker/api/Dockerfile` y `docker/web/Dockerfile`.
- **`pnpm-workspace.yaml` referencia `lib/integrations/*`** pero esa carpeta no existe en el repo (ver sección "Pendiente" — vale la pena que el equipo la cree o saque la referencia). Los Dockerfiles ya tienen un `mkdir -p lib/integrations` como parche; si corrés `pnpm install` fuera de Docker, hacé lo mismo a mano.
- **El script `codegen` de `lib/api-spec/package.json`** termina con `pnpm -w run typecheck:libs`, y esa sintaxis `-w` no la reconoce esta versión de pnpm (error "unexpected argument '-w'"). El propio `orval` (la generación de tipos) sí corre bien antes de ese error — simplemente correr `pnpm run typecheck:libs` a mano después si hace falta.
- **`drizzle-kit push` ya NO borra `jira_cache`** (arreglado en DAT-3, commit `7bb2ac4`): ahora la tabla está modelada en `lib/db/src/schema/jira-cache.ts`. Igual seguir con cuidado con `drizzle-kit push` en general (revisar el diff que propone antes de aplicar).
- **⚠️ Gotcha recurrente del lockfile (pasa CADA vez que se toca una dependencia):** `pnpm install` (sin `--frozen-lockfile`) reinyecta una entrada espuria `react: specifier '>=18'` bajo `lib/api-client-react` en `pnpm-lock.yaml` (ese paquete solo declara `react` como `peerDependencies`, nunca como dependency directa). Esa entrada hace **fallar** `pnpm install --frozen-lockfile` — la ruta que usa el build de Docker — con `ERR_PNPM_OUTDATED_LOCKFILE` ("1 dependency was removed: react@>=18"). **Ya pasó 4+ veces** (al sacar jspdf, al agregar vitest, al agregar eslint x2). Fix: borrar a mano las 3 líneas `react:` / `specifier: '>=18'` / `version: 19.1.0` del bloque `lib/api-client-react:` en el lockfile, y confirmar con `pnpm install --frozen-lockfile`. **Siempre** correr `--frozen-lockfile` localmente después de tocar deps, antes de commitear.

## 2. Metodología seguida en cada revisión de sección

Se revisaron, en este orden: **Health → Team → Sprints → Analíticas → Kanban Weekly**.
En cada una se siguió el mismo proceso (a pedido del usuario, "revisa X y hazme una propuesta"):

1. Leer el código fuente completo (página del frontend + endpoint(s) del backend involucrados).
2. **Verificar contra datos reales** vía `curl` con un token de sesión — nunca asumir un bug solo por lectura de código sin confirmarlo con la API real corriendo.
3. Listar hallazgos con evidencia concreta (valores antes/después, capturas de pantalla cuando aplica), separando "esto ya funciona bien" de "esto está mal".
4. Presentar una propuesta concisa y **esperar aprobación explícita** del usuario antes de tocar código (nunca se implementó nada sin un "sí"/"implementa todo" primero).
5. Implementar, correr `pnpm run typecheck` en el workspace completo, reconstruir con `docker compose up -d --build`, y re-verificar con los mismos `curl`/capturas de antes para confirmar el cambio real.
6. Confirmar visualmente en el navegador (Chrome vía herramienta de browser) cuando el cambio es de UI.
7. Commitear con mensaje descriptivo enfocado en el *por qué*, no solo el *qué* — y pushear solo cuando el usuario lo pidió explícitamente ("commitea y sube").

## 3. Arquitectura clave introducida: sistema de thresholds de Admin

Antes de esta sesión, cada pantalla (Resumen, Health, Team, Sprints, Analíticas, Kanban)
tenía sus propios valores de "bueno/advertencia/crítico" **hardcodeados de forma independiente**,
a veces con 2 o 3 valores distintos para la misma métrica en pantallas distintas.

Ahora existe una única fuente de verdad:

- **Tabla**: `default_metric_thresholds` (`lib/db/src/schema/default-metric-thresholds.ts`) —
  columnas `metric`, `project_id` (nullable — `null` = default global), `good_value`, `warning_value`.
- **Helper backend compartido**: `getEffectiveThresholds(projectId?)` en
  `artifacts/api-server/src/lib/health-thresholds.ts` — mergea global + override del proyecto.
- **Seeding automático e incremental**: si se agrega una métrica nueva a
  `DEFAULT_HEALTH_THRESHOLDS` (en `artifacts/api-server/src/routes/admin/constants.ts`),
  se siembra sola la primera vez que alguien pega el endpoint — no hace falta truncar la tabla.
- **UI**: pestaña Admin → Health tiene la tabla global editable + un selector de proyecto
  para overrides puntuales (con checkbox "anular" por métrica).
- **Endpoints**: `GET/PUT /api/admin/metric-thresholds`, `GET/PUT/DELETE /api/admin/metric-thresholds/:metric/project/:projectId`.

### Métricas centralizadas actualmente (17 en total)

`cycleTime`, `leadTime`, `throughput`, `wipRatio`, `cfr`, `predictability`, `flowEfficiency`,
`blocked` (% del WIP, no conteo absoluto), `flowLoad`, `wipAging`, `sprintCompletion`,
`slaHighest` (en horas), `slaHigh`, `slaMedium`, `slaLow`, `slaLowest` (en días), `slaCompliance`.

La migración del schema (columna `project_id` + índice) ahora corre **automáticamente en cada
arranque del API** (`artifacts/api-server/src/index.ts`, función `initDb()`), con `IF NOT EXISTS`/
`IF EXISTS` en cada statement — es idempotente, no hace falta correrla a mano en una PC nueva.

Las 5 métricas `sla*` por prioridad son un **valor objetivo único**, no una banda buena/advertencia
— la UI de Admin las trata distinto (muestra "—"/"Objetivo único" en la columna de Advertencia
y sincroniza ambos valores automáticamente para que editar no genere una inconsistencia oculta).

## 4. Bugs de fondo encontrados (patrón recurrente entre secciones)

Varios bugs se repitieron *literalmente igual* en más de una pantalla porque cada una tenía
su propia implementación copiada en vez de compartir una sola. Vale la pena tenerlos en mente
si aparece un bug parecido en una sección todavía no revisada (ver sección 6):

1. **Cycle Time confundido con Lead Time** — el fetch de issues no pedía `includeChangelog: true`,
   así que `getCycleTimeDays()` caía siempre al fallback (lead time). Encontrado y corregido en:
   Team (`metrics.ts`), Health (`project-health.ts`), y ya estaba bien en Sprints/Kanban/Analíticas.
2. **`reopenedCount` con regex roto** — buscaba literalmente el string inglés `/^done$/i` en vez
   de usar `statusCategory` + nombres en español ("listo", "terminado", "resuelto", "cerrado").
   Encontrado en Sprints y Kanban (dos copias independientes, ambas rotas). Ahora hay un único
   helper compartido `countReopenedIssues()` en `artifacts/api-server/src/lib/jira.ts`.
3. **WIP subestimado por ventana de período angosta** — issues abiertos hace más de 30/90 días
   desaparecían de los conteos de WIP. Se agregó `getOpenIssuesForProject()` (sin límite de fecha,
   `resolutiondate is EMPTY`) para reemplazar los conteos period-scoped donde correspondía "WIP real".
4. **El mismo metric con 3 thresholds hardcodeados distintos** — ej. `flowEfficiency` tenía 60/40
   en un lado, 40/20 en otro, 50/30 en un tercero. Todos unificados al valor de Admin (25/15).
5. **Comparación de período anterior se solapaba con el actual** (Analíticas) — el filtro no tenía
   límite superior de fecha de resolución, así que un issue resuelto esta semana contaba en ambos
   períodos a la vez.
6. **Promedios "de promedios" en vez de ponderados por issue** (Kanban) — el Cycle Time Promedio
   del resumen promediaba los promedios semanales sin ponderar por cuántos issues cerró cada semana.
7. **Bug de signo en `normalize()`** (`project-health.ts`) — para métricas "menor es mejor", un valor
   peor que el umbral de advertencia daba un score de 100 (perfecto) en vez de 0.
8. **Filtración de datos de debug en producción** (Kanban) — un campo `debug` con fechas de
   resolución de cada issue se devolvía en *todas* las respuestas reales, más un `console.log`
   en cada request.
9. **Bloqueados contados por historial completo en vez de estado actual** (Health) — "Issues
   Bloqueados" contaba todo lo bloqueado en los últimos 90 días, no lo bloqueado *ahora mismo*,
   contradiciendo lo que mostraba la pestaña Resumen para el mismo proyecto.
10. **Detección de tipo "Bug" por regex en inglés** (`/^bug$/i`) en vez del helper compartido
    `mapIssueType()` — no reconocía tipos en español ("Error", "Problema"). Encontrado en
    `project-health.ts` y `metrics.ts` (Health mostraba CFR 0%/Calidad perfecta en un proyecto
    con 29% de change failure rate real). Mismo patrón ya arreglado antes en `jira.ts` y QA-rejected.
11. **CFD (Cumulative Flow Diagram) con la banda "En Progreso" en cero siempre** — el fetch de
    issues para CFD no pedía `includeChangelog: true`, así que no podía leer las transiciones de
    estado que necesita para ubicar cada issue en el tiempo. Reutilizaba además un heurístico de
    palabras clave EN/ES para "¿este estado es activo?" en vez del `statusCategory` compartido.
12. **WIP subestimado también en el Resumen Ejecutivo / Portfolio** — mismo bug de la fila 3, mismo
    fetch limitado a 90 días, esta vez en el cache de portfolio (`portfolio-cache.ts`). OLP pasó de
    22 a 28 en curso al arreglarlo con `getOpenIssuesForProject()`.
13. **Forecast dejaba elegir una ventana de 180 días** pero el fetch de Jira siempre corta en 90 —
    la matemática de baldes semanales usaba el 180 crudo contra datos de 90, sesgando los percentiles.
14. **"WIP Aging" contaba severidad (crítico/advertencia/watch) solo sobre los 10 items mostrados**
    (Flow) — no sobre el total real. OLI: 30 issues en WIP, desglose real 11/6/2, pero la pantalla
    mostraba "10 crítico, 0, 0" porque los 10 más viejos mostrados resultaban ser todos críticos.
15. **"Tiempo en Estado" (bottleneck) con la misma ventana angosta de período** (Flow) — mismo
    patrón de la fila 3/12, ahora en el análisis de cuellos de botella.
16. **Evolución ignoraba el override de Admin propio del proyecto** — `evolution.ts` tenía su
    propia consulta (no usaba `getEffectiveThresholds`), traía **toda** la tabla de thresholds sin
    filtrar por proyecto y elegía el primer match con `.find()`. Confirmado en vivo: STRIDER AI con
    `leadTime=999` configurado como override propio seguía mostrando 25 (el global) como su "Meta".
17. **QA Rechazados contaba transiciones sin acotar al período** (`qa-rejected.ts`) — el filtro de
    período (`created`/`resolutiondate` dentro de N días) se aplicaba solo a nivel de *issue*; una
    vez que un issue calificaba, se escaneaba **todo su historial** sin límite de fecha, así que
    rechazos de hace meses se contaban como "del último mes". `metric-snapshots.ts` (Evolución) ya
    tenía el fix correcto (un `windowStart` explícito) que `qa-rejected.ts` nunca replicó. Confirmado
    en vivo: OLP `/qa-rejected/10003/1m` mostraba 10 transiciones de rechazo, 8 con 50–86 días de
    antigüedad. Además, issues abiertos creados antes de la ventana (pero todavía activos en QA)
    eran invisibles por completo, mismo patrón de la fila 3/12/15. Tras el fix: 7→3 rechazados,
    28→34 entraron a QA, tasa 25%→8.8% (número real de los últimos 30 días).
18. **Exportar a PDF (Reporte) estaba completamente roto** (`project-report.tsx`) — usaba
    `html2canvas` (sin mantenimiento) para capturar el DOM y `jsPDF` para pegarlo como imagen.
    Confirmado en vivo: al hacer clic en "PDF" no generaba nada — consola tiraba
    `Error: Attempting to parse an unsupported color function "oklch"`, porque Tailwind v4 (usado en
    este proyecto) genera sus colores con `oklch()` y esa versión de `html2canvas` no lo soporta.
    Se decidió **eliminar la función sin reemplazo** (el equipo no la necesita seguido; para un
    reporte puntual alcanza con imprimir la página del navegador). Se sacó `handleExport`, el botón,
    los imports de `html2canvas`/`jsPDF`, y la dependencia `jspdf` de `package.json` (se dejó
    `html2canvas`, que todavía usa `project-detail.tsx` para descargar el gráfico como PNG — feature
    aparte, no tocada). Al sacar `jspdf` del `package.json`, `pnpm install` (sin `--frozen-lockfile`)
    escribió una entrada espuria en el lockfile — ver gotcha nuevo en la sección 1.
19. **Reporte no mostraba Health Score ni tasa de rechazo QA** — mejora (no bug): se revisó el resto
    de `project-report.tsx` contra los 4 endpoints que ya usaba (metrics, cfd, members, analytics) y
    coincidía exactamente con los datos en vivo, sin bugs. Como mejora, se agregaron 2 tarjetas más:
    `DORA Score` de `/health/:period` (ya es el único campo de ese endpoint pensado como "resumen
    compuesto" — se evitó promediar las 7 dimensiones a mano para no inventar una métrica nueva que
    duplicara Cycle Time/CFR dos veces) y `overallRejectionRate` de `/qa-rejected/:period` (la métrica
    recién corregida en la fila 17). Verificado en vivo: OLP muestra Health Score 21/100 y Tasa de
    Rechazo QA 8.8%, coincidiendo con lo que muestran Health y QA Rechazados por separado.
20. **Resumen Ejecutivo: "Throughput (30d)" y el tooltip de la tabla decían 30 días**, siendo que
    el dato real siempre fue de 90 (`PORTFOLIO_METRICS_PERIOD_DAYS` en `portfolio-cache.ts`). Solo
    texto, corregido en ambos locales.
21. **`getJiraIssuesForProject` tiene un límite duro de 90 días** (`JIRA_MAX_LOOKBACK_DAYS`) que
    trunca en silencio cualquier ventana más larga — no es un bug nuevo (Forecast ya lo respeta a
    propósito, `forecast.ts:89-93`), pero es la primera vez que alguien pidió más de 90 días
    (`getJiraIssuesForProject(id, 180, ...)` al construir la comparación "período anterior" del
    Resumen Ejecutivo) y el resultado fue silencioso: `throughputPrevious` daba 0 para OLP aunque
    Jira mostraba decenas de issues resueltos en la ventana 90-180d. **Ojo con esto para cualquier
    trabajo futuro que necesite mirar más de 90 días atrás** — la solución no fue subir el límite
    global (arriesgaba cambiar Forecast/Analíticas sin probarlos) sino agregar
    `getResolvedJiraIssuesInRange(projectId, fromDaysAgo, toDaysAgo, options)` en `lib/jira.ts`,
    una función aparte que sí permite un rango arbitrario, pensada solo para comparaciones
    históricas tipo "período anterior".

## 5. Qué se revisó y qué no (todavía)

**Revisado y corregido en profundidad**: Resumen Ejecutivo / Portfolio (`dashboard.tsx` +
`portfolio-cache.ts` — segunda pasada: se corrigió el mislabel de 30d/90d y se agregaron 3 KPIs
nuevos con tendencia vs. período anterior, filas 20-21 de la sección 4), Health, Team, Sprints,
Analíticas (incluye SLA), Kanban Weekly, Forecast, Flow, Evolución, QA Rechazados, y Reporte
(`project-report.tsx` — CFD + `/members` + `/analytics` ya revisados a fondo por separado; se
eliminó la exportación a PDF y se agregaron tarjetas de Health Score/tasa de rechazo QA, ver filas
18–19 de la sección 4).

`FlowHealthCard` (componente ya construido pero huérfano, sin usar en ningún lado) quedó integrado
arriba de las tablas de Flow como resumen ejecutivo de esa pestaña.

`portfolio_cache` ahora tiene 7 columnas nuevas (`health_score`, `qa_rejection_rate`, y las 5
variantes `*_previous`) — se migran solas al arrancar el API, mismo patrón idempotente de siempre.
`normalize()` (proyecta un valor crudo a un score 0-100 contra los umbrales de Admin) y
`computeQaRejectionRate()` (tasa de rechazo de QA acotada a una ventana) ahora viven como helpers
compartidos en `health-thresholds.ts` y `jira.ts` respectivamente — `project-health.ts` y
`portfolio-cache.ts` usan la misma implementación de `normalize()`, en vez de cada uno con su copia.

**Todas las secciones de la lista original ya fueron revisadas.** Si aparece una sección nueva o
se agrega una pestaña, seguir la misma dinámica de la sección 2.

## 6. Otras cosas que quedaron anotadas pero sin resolver (menor prioridad)

- El "boundary week" del gráfico de Comparar en Analíticas todavía puede mostrar la misma
  etiqueta de semana ISO en actual y anterior cuando el corte de 30 días cae a mitad de semana
  (no es un bug de datos — cada issue se cuenta una sola vez — es solo una etiqueta compartida
  en el eje X que puede confundir visualmente).
- `getISOWeek()` está reimplementado de forma independiente en `analytics.ts`, `sprint-metrics.ts`
  y `kanban-metrics.ts` — funciona igual en los tres, pero es candidato a unificar en `lib/jira.ts`
  si se vuelve a tocar alguno de los tres.
- `lib/integrations/` referenciada en `pnpm-workspace.yaml` pero inexistente en el repo — o se crea
  con algo real, o se saca la referencia del workspace glob.
- ~~No hay tests automatizados~~ — **resuelto parcialmente** (QA-1): ya hay 22 tests unitarios de
  la lógica pura de métricas en `artifacts/api-server/src/lib/__tests__/metrics-logic.test.ts`
  (`pnpm --filter @workspace/api-server test`). Faltan los que dependen de estado async
  (`getCycleTimeDays`, `getLeadTimeDays`, `countReopenedIssues`) — necesitan mockear
  `getStatusCategoryMap`; quedaron para una segunda tanda.

## 7. Cómo retomar

1. `git pull` primero — más de una PC/sesión está tocando este repo, chequear
   `git log --oneline origin/main..HEAD` / `HEAD..origin/main` antes de asumir que estás al día.
2. Levantar el entorno (sección 1) — `docker compose up -d --build`.
3. Confirmar que los 17 thresholds están sembrados: `GET /api/admin/metric-thresholds` (o mirar
   la pestaña Admin → Health en el navegador).
4. Todas las secciones de la UI ya fueron revisadas (sección 5). El trabajo pendiente ahora es el
   **backlog de mejoras** en `MEJORAS-PROPUESTAS.md` (ver sección 8): elegir un ítem del plan
   ajustado (Tier 3 Seguridad, o Tier 4) y seguir la misma dinámica de la sección 2.
5. Antes de cortar la sesión, **actualizar este archivo** (commits nuevos, bugs nuevos, qué quedó
   cubierto) y pushearlo — es lo que le permitió a la sesión anterior seguir sin perder contexto.

## 8. Fase de auditoría crítica y mejoras (2026-07-24)

Después de revisar todas las secciones, se hizo una **auditoría crítica de todo el proyecto**
(seguridad, fiabilidad de datos, testing/CI, arquitectura frontend, metodología de métricas, ops,
deuda técnica), documentada en **`MEJORAS-PROPUESTAS.md`** (27 hallazgos con impacto/esfuerzo y
evidencia `archivo:línea`). Contexto acordado con el usuario: **app en demo, sin desplegar, objetivo
= confiar en los números**, así que se reordenó en 4 tiers (ver "Plan ajustado" en ese archivo) —
Seguridad pasa a ser un **gate previo al primer deploy real**, no lo urgente ahora.

**Implementado y subido en esta fase:**
- **DAT-2** (`1b6808a`) — comparación período-anterior de Analíticas estaba rota en "3m" (el fetch
  `periodDays*2=180` se capaba a 90); ahora usa `getResolvedJiraIssuesInRange`.
- **MET-1** (`5ad1436`) — "DORA Score" era un nombre engañoso (no es DORA real, solo flujo de Jira):
  renombrado a **Flow Health Score**; además se eliminó el objeto `dora` muerto de `metrics.ts` +
  del contrato OpenAPI + se regeneró el cliente. Ver `METRICS.md`.
- **QA-1** (`5fb063b`) — primer suite de tests del repo: **vitest** en `artifacts/api-server`, 22
  tests de la lógica pura de métricas (incl. guard de regresión del sign-bug de `normalize`).
- **DOC-1** (`57af2bc`) — **`METRICS.md`**: documenta la fórmula REAL de cada métrica + caveats
  transversales (tope 90d, dependencia del changelog, truncamiento ~100/semana, Flow Health ≠ DORA).
- **DAT-4** (`8f31da0`) — timeout/error de portfolio ya no pisa las filas buenas con `null` (se
  filtran antes del upsert; se loguean los proyectos saltados).
- **DAT-3** (`7bb2ac4`) — `jira_cache` modelada en el schema de Drizzle → `drizzle-kit push` ya no
  propone borrarla.
- **QA-4** (`2a74f53`) — error handler global de Express + 404 JSON (antes: HTML 500/404 que el
  cliente no sabía parsear).
- **QA-3** (`a9cec98` + `f2a3282`) — `strict: true` de TS (compilaba limpio, faltaba solo
  `strictFunctionTypes`) + **baseline de ESLint** (`pnpm lint` → 0 errores / 114 warnings; lenient
  a propósito, no fuerza limpiar los ~45 `any` de golpe).

**⏸️ QA-2 (CI) — PENDIENTE, parkeado:** el workflow de GitHub Actions (typecheck + test) está
escrito y verificado localmente, pero **NO se pudo pushear**: el token OAuth de `gh` no tiene el
scope `workflow` (probablemente requiere aprobación de admin de la org). El commit quedó guardado
en la **rama local `ci-workflow`** (no en `main`), y el contenido está para pegar por la UI web de
GitHub (Add file → `.github/workflows/ci.yml`). **Cómo retomar:** o se aprueba el scope `workflow`
para la app de `gh` y se pushea desde una terminal, o se crea el archivo por la web. Cuando se
active, conviene que el workflow corra **typecheck + test + lint** (el `ci.yml` parkeado solo tiene
typecheck+test; falta sumar `pnpm lint`).

**Nuevos comandos útiles:** `pnpm --filter @workspace/api-server test` (tests), `pnpm lint`
(ESLint). Ambos pasan hoy.

**Backlog restante** (en `MEJORAS-PROPUESTAS.md`, no empezado): Tier 3 = Seguridad (SEC-1 secreto
JWT hardcodeado, SEC-2 admin/admin123, SEC-3 RBAC solo client-side, SEC-4 rate limit/helmet/CORS) —
gate antes de exponer. Tier 4 = FE-1/2/3 (cliente tipado esquivado, `any`, duplicación),
DEU-1/2/4 (god-files, `getISOWeek` x5, mockup-sandbox muerto), OPS-1/2, DAT-1/5, FE-4/5/6.

## 9. Preparación del deploy (2026-07-24) — Opción B: Vercel + Render + Neon

Se decidió publicar **gratis** con la arquitectura **B**: frontend en **Vercel**, backend
(Express, proceso persistente por el sync) en **Render** (Docker, free), Postgres en **Neon**
(free). Motivo: el backend NO es serverless (tiene sync en background + estado en memoria), así
que Vercel solo no alcanza — necesita una plataforma que corra un proceso siempre vivo.

**Ya implementado y en `main`:**
- **Gate de seguridad SEC-1/2/4** (commit `2d2c158`) — en producción (`NODE_ENV=production`) el
  backend **no arranca** si `JWT_SECRET` falta/es débil o si `DEFAULT_ADMIN_PASSWORD` es
  `admin123`/ausente; CORS restringible por `CORS_ORIGIN`; algoritmo JWT fijado a HS256. Local
  sin cambios (NODE_ENV no es production → fallbacks de dev siguen).
- **Config de deploy** (commit `b34e5cf`): `render.yaml` (backend Docker, Render genera el
  `JWT_SECRET`, `NODE_ENV=production`, secretos como `sync:false`), `vercel.json` (build del
  dashboard desde el workspace, output `dist/public`, rewrite `/api/* → Render` así el navegador
  no ve CORS), `DEPLOY.md` (paso a paso), `.env.example` actualizado.
- Nombres elegidos: Render = `agile-metric-hub-api` (→ `https://agile-metric-hub-api.onrender.com`),
  Vercel = `agile-metric-hub` (→ `https://agile-metric-hub.vercel.app`). Ya cableados en ambos
  configs; si al crear los servicios tocan otras URLs, ajustar 1 línea en cada archivo.
- `sync-cron.yml` (Action de sync diario opcional) quedó en la rama **`ci-workflow`** (junto al
  `ci.yml`), fuera de `main` por el mismo bloqueo de scope `workflow`.

**Verificado local:** el build de Vercel (`pnpm --filter @workspace/dashboard run build`) produce
`artifacts/dashboard/dist/public`; el fail-fast de producción funciona (imagen con `NODE_ENV=production`
+ `JWT_SECRET` débil/ausente se niega a arrancar con mensaje claro).

**NO desplegado todavía** — faltan los pasos manuales (los hace el usuario, no se pueden automatizar
desde acá): crear el proyecto en Neon, el Blueprint en Render (+ pegar secretos), y el import en
Vercel. Todo en `DEPLOY.md`.

**Gotchas anotados para el deploy:**
- El build de Vercel es la parte con más riesgo (monorepo + pnpm `12.0.0-alpha.17`): el
  `installCommand` replica lo de Docker (`npm i -g pnpm@... && mkdir -p lib/integrations && pnpm
  install --frozen-lockfile`). Si falla por versión de pnpm o lockfile, ajustar en Settings de Vercel.
- Neon exige SSL: el `DATABASE_URL` debe incluir `?sslmode=require`.
- Render free se duerme a los ~15 min (cold start ~30-60s); el sync corre en cada arranque, y el
  cron opcional (`sync-cron.yml`) lo complementa.

**Cómo retomar el deploy:** abrir `DEPLOY.md` y seguir Neon → Render → Vercel. Una vez conectados,
Render y Vercel hacen auto-deploy en cada push a `main` (ese es el CI/CD del deploy).

### Progreso del deploy — sesión 2026-07-26 (noche, cortada a mitad)

Se empezó a ejecutar el deploy real de la sección 9. Estado al cortar:

- ✅ **Neon (paso 1) — HECHO.** Proyecto creado: nombre `agile-metric-hub`, org/cuenta `maya.ia`
  (free), branch `production`, database `neondb`, región **AWS US West 2 (Oregon)**, Postgres 18.
  **Neon Auth quedó APAGADO** a propósito (usamos nuestro propio auth JWT + tabla `users`; el de
  Neon se pisaría). El `DATABASE_URL` (con `?sslmode=require`, ya incluido) lo copió y guardó el
  usuario **fuera del repo/chat** — no está en ningún lado versionado. Si mañana no lo tiene a mano,
  se re-copia desde Neon → card/botón **"Connect"** → **"Show password"**.
- ✅ **Render (paso 2) — HECHO Y VERIFICADO.** Se creó vía **New → Blueprint** con el repo
  `andresga79/agile-metric-hub`; Render leyó `render.yaml` y creó el web service
  `agile-metric-hub-api` (Docker, free) en `https://agile-metric-hub-api.onrender.com` (la URL
  quedó como se esperaba, no hubo que ajustar configs). El flujo del Blueprint pidió y se cargaron
  todas las env vars secretas (`DATABASE_URL`, `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`,
  `DEFAULT_ADMIN_PASSWORD` fuerte). `JWT_SECRET` lo genera Render; `NODE_ENV=production`,
  `JWT_EXPIRE`, `CORS_ORIGIN` vienen del `render.yaml`.
  **Verificación en vivo (2026-07-27 ~02:0x UTC), con `curl` a la URL pública:**
  `/api/healthz` → `{"status":"ok"}` (200); `/api/sync/status` → 200 con el sync corriendo
  (`isSyncing:true`, `trigger:"startup"`, 29/29 proyectos) ⇒ conectado a Neon y a Jira; headers de
  prod OK (HSTS presente, CSP `default-src 'none'`, nosniff, X-Frame DENY, sin X-Powered-By); login
  con password incorrecta → 401 (no 500) ⇒ admin bootstrapeado y flujo auth vivo. **Backend
  desplegado y funcional.**
- ✅ **Vercel (paso 3) — HECHO Y VERIFICADO. DEPLOY COMPLETO.** Frontend live en
  **`https://agile-metric-hub.vercel.app`**.
  **Gotcha del wizard de Vercel (importante para futuros imports):** al importar el repo, el wizard
  **auto-detectó `artifacts/api-server` como Root Directory** (tiene su `package.json`) y preseteó
  "Express" — eso es el backend, NO el frontend. Se intentó corregir a la raíz desde el wizard pero
  el selector no dejaba subir de la subcarpeta. Se le dio **Deploy igual** y, contra lo esperado,
  **salió bien**: Vercel terminó usando el `vercel.json` de la raíz (el import traía
  `name=agile-metric-hub` y `root-directory=.` en la URL, que ganaron) y el dominio de producción
  quedó `agile-metric-hub.vercel.app` (coincide con el `CORS_ORIGIN` de Render). Si en un futuro
  re-import el root queda mal, corregirlo en **Settings → General → Root Directory** (ahí es un
  campo de texto editable: dejar **vacío** = raíz) + Framework Preset "Other", y **Redeploy** sin
  build cache.
  **Verificación en vivo con `curl`:** `https://agile-metric-hub.vercel.app/` → 200 `text/html`
  (dashboard servido); `/api/healthz` → 200 `{"status":"ok"}` y `/api/sync/status` → 200 con datos
  reales (29/29 proyectos) ⇒ **el proxy `/api/*` → Render funciona** (el navegador ve un solo origen,
  sin CORS). Pendiente de confirmar por el usuario en el navegador: el **login real** (`admin` /
  `DEFAULT_ADMIN_PASSWORD`) — Claude no lo puede probar porque no tiene la contraseña.
- ⏳ (Opcional) **paso 4** de `DEPLOY.md` — cron de sync diario (`sync-cron.yml`, parkeado en rama
  `ci-workflow` por el scope `workflow`). No es necesario para que la app funcione.

**Estado del deploy: LISTO.** Neon + Render + Vercel arriba y verificados end-to-end. La app está
pública en `https://agile-metric-hub.vercel.app`.

> Notas operativas del free tier:
> - Render free se **duerme** a los ~15 min sin tráfico (cold start ~30-60s en la próxima request).
> - El **estado del sync es en memoria**: cada cold-start/reboot de Render dispara un sync nuevo
>   (`trigger:"startup"`) y `lastSyncedAt` vuelve a `null` — es esperado, los datos persistidos viven
>   en Neon. El sync procesa 29 proyectos de Jira, tarda unos minutos en completar.
> - Auto-deploy: cada push a `main` redespliega Render y Vercel solos.

**Qué queda del proyecto (post-deploy):** SEC-2 residuo (forced password change, necesita UI),
activar el CI (QA-2, bloqueado por scope `workflow`), y Tier 4 (FE-*/DEU-*/OPS-*/DAT-1/5).

## 10. Cierre de Seguridad Tier 3 — backend (2026-07-26)

Se retomó el backlog por el **Tier 3 (Seguridad)**, que era el *gate* previo a exponer la app.
Estado de partida: SEC-1 ya estaba cerrado (JWT, commit `2d2c158`); SEC-2/SEC-4 estaban parciales
(fail-fast de prod + CORS por env, mismo commit); **SEC-3 sin hacer**. Esta tanda cerró todo lo
que es **backend-only y verificable con `curl`** (decisión acordada con el usuario: dejar el
forced-password-change de SEC-2 para después porque necesita UI).

**SEC-3 — RBAC de lectura server-side (el hueco grande):**
- Nuevo middleware `requireSectionView(...secciones)` en `middleware/auth.ts`. Corre **después** de
  `requireAuth`. `admin` pasa siempre; el resto necesita `role_permissions.can_view = true` en **al
  menos una** de las secciones pasadas. 403 si no hay ninguna fila en `true`.
- **Por qué "al menos una":** varios endpoints alimentan más de una sección del frontend (ej. el
  Reporte reusa los datos de Health/QA/miembros), así que quien pueda ver *cualquier* consumidor
  legítimo del endpoint debe poder leerlo. Mapeo endpoint→secciones derivado de las páginas reales
  (`App.tsx` `SectionRoute` + qué API consume cada página).
- **Endpoints gateados** (con su/s sección/es): `members`→[team,report], `issues` + `issues/csv` +
  `team/in-progress`→[team], `health`→[health,report], `sla`→[analytics], `cfd`→[report],
  `qa-rejected`→[qa-rejected,report], `sprints`→[sprints], `kanban`→[kanban], `forecast` +
  `predictive-forecast`→[forecast], `evolution`→[evolution].
- **Baseline abierto a propósito** (siguen solo con `requireAuth`): `metrics`, `analytics`,
  `portfolio`, `targets`-GET. **Motivo (decisión del usuario):** el **overview del proyecto**
  (`/projects/:id`, `ProjectDetail`) y el **Resumen Ejecutivo** (dashboard) NO están gateados por
  sección en el frontend — los ve cualquier autenticado — y consumen `/metrics` y `/analytics`.
  Restringirlos server-side rompería esas dos páginas para roles sin esas secciones, y habría que
  gatearlas también en la UI (sale del scope backend-only). Se dejaron como "baseline" que todos ven,
  replicando exactamente lo que el frontend ya muestra. **Ojo para el futuro:** si algún día se quiere
  cerrar de verdad `/metrics`+`/analytics`, hay que gatear el overview y el Resumen en el frontend
  a la vez.
- `evolution` es un `SectionRoute` en el frontend pero su sección **no está en el seed** de
  `role_permissions` (SECTIONS de `role-permissions.ts` no la incluye), así que para no-admin da 403
  server-side — consistente con que la UI ya la esconde para no-admin. Si se quiere que roles
  no-admin vean Evolución, hay que **agregar "evolution" al seed** de secciones.

**SEC-4 — hardening (sin dependencias nuevas):** se decidió NO agregar `helmet` ni
`express-rate-limit` para no tocar `package.json`/lockfile (el gotcha del lockfile de la sección 1 ya
mordió 4+ veces y el build de Docker/Render usa `--frozen-lockfile`). En su lugar, todo en
`lib/security.ts`:
- `securityHeaders()` — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `X-DNS-Prefetch-Control: off`, `Content-Security-Policy:
  default-src 'none'` (seguro para una API JSON), quita `X-Powered-By`, y `Strict-Transport-Security`
  **solo en producción** (mandarlo en dev por HTTP envenena el cache de localhost).
- `rateLimit()` — limiter fixed-window en memoria; aplicado a `/auth/login` (10 intentos / 15 min por
  IP → 429 + `Retry-After`). Es per-proceso (ok para una sola instancia de Render; se resetea al
  reiniciar). Si el deploy escala a varias instancias, cambiar por algo distribuido o `helmet` +
  `express-rate-limit`.
- Body limit `1mb` en `express.json`/`urlencoded`.
- `app.set("trust proxy", 1)` **solo en producción** — Render termina TLS y reenvía por
  `X-Forwarded-For`; sin esto `req.ip` sería la IP del proxy y el rate-limit metería a todos en el
  mismo bucket.

**SEC-2 — parcial:** bcrypt subido de cost 10 → **12** (`BCRYPT_ROUNDS` en `lib/security.ts`, usado en
`index.ts` bootstrap del admin y en `admin/users.ts` alta/edición). **Pendiente** (necesita UI, quedó
fuera): marcar la password inicial como temporal + forzar cambio en el primer login (columna DB +
flujo de login + pantalla de cambio de contraseña).

**Verificación en vivo** (`docker compose up -d --build api`, proyecto 10848, usuario `viewer` de
prueba con `can_view=false` en todo — creado y **borrado** al terminar):
- 10 endpoints gateados → viewer **403**, admin pasa el middleware (los 400 de `sprints`/
  `predictive-forecast` son del handler —board sin sprints / body `{}`—, no 403).
- Baseline (`metrics`/`analytics`/`portfolio`/`targets`) → **200/200** (overview intacto).
- Camino positivo: dar `can_view` a viewer en `health` → 403 **→ 200**; `kanban` (no otorgado) sigue 403.
- Login: 11º intento → **429** con `Retry-After`. Headers de seguridad presentes; HSTS ausente en dev.
- typecheck limpio · 22/22 tests (`pnpm --filter @workspace/api-server test`) · `pnpm lint` 0 errores.

> ⚠️ El testeo del rate-limit deja el login de esa IP throttleado ~15 min (se resetea solo). Si al
> retomar el login da 429, esperar o reiniciar el contenedor `api`.

**Qué queda de Seguridad:** solo el residuo de SEC-2 (forced password change, necesita UI) y SEC-3 no
tiene más deuda salvo la nota del baseline `/metrics`+`/analytics` de arriba. Con esto el gate de
seguridad para el deploy está sustancialmente cubierto. Backlog restante del proyecto: Tier 4
(FE-*, DEU-*, OPS-*, DAT-1/5) y activar el CI (QA-2).

# Agile Metric Hub

Dashboard interno de métricas ágiles: sincroniza issues de Jira y calcula throughput,
cycle/lead time, velocity, health score, SLA, QA rejection rate, forecast, etc. sobre
esos datos. Monorepo pnpm con backend Express + frontend Vite/React.

## Run & Operate

- `docker compose up --build -d` — levanta todo el stack (db + api + web); es la forma
  estándar de correr el proyecto en dev, no `pnpm dev` suelto.
- `cp .env.example .env` antes del primer `up` si no existe `.env` (no viaja con git).
- `pnpm run typecheck` — typecheck completo del workspace
- `pnpm run lint` — ESLint (baseline: 0 errores, ~114 warnings a propósito, no fuerza
  limpiar los `any` existentes de golpe)
- `pnpm --filter @workspace/api-server test` — vitest, 22 tests de lógica pura de métricas
- Healthcheck: `curl localhost:8000/api/healthz` → `{"status":"ok"}`
- Ver la skill `run-app` para el procedimiento completo verificado en vivo (incluye
  gotchas de Docker Desktop, `.env`, y reset de datos).

## Stack

- pnpm workspaces, Node.js, TypeScript 5.9
- API: Express 5 (`artifacts/api-server`, puerto 8000)
- DB: PostgreSQL + Drizzle ORM
- Frontend: Vite + React (`artifacts/dashboard`, servido por nginx en el puerto 80 vía Docker)
- Validación: Zod
- Auth: JWT stateless (sin sesiones server-side)

## Where things live

- `artifacts/api-server` — API Express: auth, sync de Jira, cálculo de métricas/portfolio
- `artifacts/dashboard` — frontend Vite/React
- `artifacts/mockup-sandbox` — **código muerto**, no está en `pnpm-workspace.yaml` ni se
  construye; no tocar salvo que se decida revivirlo o borrarlo
- `lib/db`, `lib/api-zod`, `lib/api-client-react` — paquetes compartidos del workspace
- `lib/integrations` — referenciado en `pnpm-workspace.yaml` pero **no existe en git**
  (directorio fantasma); los Dockerfiles lo parchan con `mkdir -p` en build

## Architecture decisions

- **Thresholds centralizados**: una sola fuente de verdad (`default_metric_thresholds` +
  `getEffectiveThresholds(projectId?)` en `lib/health-thresholds.ts`), configurable desde
  Admin → Health (global + override por proyecto). Antes cada pantalla tenía sus propios
  valores hardcodeados y duplicados.
- **"Flow Health Score"** (antes mal llamado "DORA Score"): promedio normalizado de
  throughput + cycle time + CFR sobre datos de Jira. **No son métricas DORA reales** (no
  hay fuente de deploys/CI). Ver `METRICS.md` para la fórmula exacta y el resto de métricas.
- **Modelo de acceso**: 2 roles activos — `admin` (control total) y `member` (solo
  lectura, ve todas las secciones). `viewer` existe en el enum pero está dormido (sin
  cuentas asignadas). Cuenta `member` compartida entre varias personas a la vez es válido
  por diseño (JWT stateless, sin estado de sesión en el server).
- **Cap de 90 días en fetch de Jira** (`JIRA_MAX_LOOKBACK_DAYS`): toda consulta normal se
  recorta en silencio a 90 días. Para comparaciones históricas más largas (período
  anterior, etc.) existe `getResolvedJiraIssuesInRange`, que sí supera el cap — no subir
  el límite global sin revisar Forecast/Analíticas.
- **Sync serializado (concurrency=1)**: `warmVisibleProjectsCache` y
  `calculateAndCachePortfolio` corren de a un proyecto por vez, a propósito — fix de un
  crash loop por OOM en el free tier de 512MB (ver `SESSION_LOG.md`, 2026-07-27). Más
  lento pero estable; no volver a subir la concurrencia sin más RAM disponible.
- **RBAC de lectura**: validado server-side vía `requireSectionView(...)` para la mayoría
  de endpoints; `metrics`/`analytics`/`portfolio`/`targets`-GET quedan como "baseline"
  abierto a cualquier autenticado a propósito (alimentan el overview y el Resumen
  Ejecutivo, que no están gateados por sección en el frontend).

## Product

Plataforma de inteligencia de entrega para líderes técnicos y scrum masters: visibilidad
de flujo (throughput, cycle/lead time, WIP), entrega y predecibilidad (velocity, sprint
completion, forecast Monte Carlo), calidad (QA rejection rate, bug rate), SLA por
prioridad, y un Resumen Ejecutivo tipo portfolio con salud y proyectos en riesgo. Todo
alimentado desde Jira Cloud (o datos mock si no hay credenciales configuradas).

## User preferences / metodología de trabajo

Cuando se revisa o corrige una sección de la app, seguir este proceso (acordado y
validado en sesiones previas, ver `SESSION_LOG.md` sección 2):

1. Leer el código fuente completo (frontend + endpoint(s) backend involucrados).
2. Verificar contra datos reales vía `curl` con un token de sesión real — nunca asumir un
   bug solo por lectura de código sin confirmarlo corriendo.
3. Listar hallazgos con evidencia concreta (archivo:línea, valores antes/después),
   separando "esto ya funciona bien" de "esto está mal".
4. Presentar una propuesta concisa y **esperar aprobación explícita** antes de tocar
   código.
5. Implementar, correr `pnpm run typecheck`, reconstruir (`docker compose up -d --build`),
   y re-verificar con los mismos `curl`/capturas de antes.
6. Confirmar visualmente en el navegador cuando el cambio es de UI.
7. Commitear con foco en el *por qué*, no solo el *qué*.
8. **Pushear solo cuando se pida explícitamente** ("commitea y sube") — nunca por defecto.

## Gotchas

- **Placeholder de Jira en `.env` causa 401 en loop, no fallback limpio a mock.** Si
  `JIRA_URL`/`JIRA_EMAIL`/`JIRA_API_TOKEN` quedan con los valores de ejemplo (no vacíos),
  el backend intenta autenticar de verdad y falla con 401 repetido en vez de usar datos
  mock. Para mock real, dejarlos **vacíos**; para Jira real, cargar credenciales válidas.
- **Bootstrap de `admin` solo corre en un volumen de Postgres nuevo.** Si el volumen
  `postgres_data` ya existía de una corrida anterior, el usuario `admin` ya existe con la
  contraseña que se seteó la primera vez — `DEFAULT_ADMIN_PASSWORD` del `.env` actual no
  aplica. Reset completo: `docker compose down -v` (borra el volumen).
- **Lockfile espurio al tocar dependencias**: `pnpm install` (sin `--frozen-lockfile`)
  reinyecta una entrada falsa `react: specifier '>=18'` bajo `lib/api-client-react` en
  `pnpm-lock.yaml`, rompiendo `--frozen-lockfile` (la ruta que usa el build de Docker).
  Siempre correr `pnpm install --frozen-lockfile` localmente después de tocar deps, antes
  de commitear; si falla, borrar a mano esas 3 líneas del bloque `lib/api-client-react`.
- **Rate limit de login**: 10 intentos fallidos / 15 min por IP → 429. Solo cuenta
  fallidos (logins exitosos no gastan el límite). Si te bloqueás debuggeando, esperar o
  reiniciar el contenedor `api`.
- **`drizzle-kit push`**: revisar siempre el diff propuesto antes de aplicar; ya hubo un
  caso donde proponía borrar `jira_cache` (resuelto, pero mantener la cautela con push en
  general).
- **`pnpm` pineado en versión alpha** (`12.0.0-alpha.17`) en ambos Dockerfiles — necesita
  `ca-certificates` en imágenes `node:*-slim` o falla "No CA certificates were loaded".

## Pointers

- `HEALTH-THRESHOLDS.md` — umbrales de Admin → Health personalizados manualmente (difieren
  del default de fábrica), con script SQL para restaurarlos en un Postgres nuevo/otra PC
- `METRICS.md` — fórmula real de cada métrica calculada, con referencias `archivo:línea`
- `DEPLOY.md` — arquitectura y pasos de deploy en máquina interna vía Docker Compose (Render
  Static + Render API Docker + Neon quedaron discontinuados, ver `SESSION_LOG.md` para esa
  historia)
- `MEJORAS-PROPUESTAS.md` — auditoría crítica del proyecto (actualizada 2026-08-26):
  Seguridad, Datos y Calidad mayormente cerrados (SEC-1/3/4, DAT-2/3/4, QA-3/4, OPS-1,
  MET-1); parciales SEC-2, DAT-5, QA-1, DOC-1, FE-2; QA-2 bloqueado por scope `workflow`
  del token de GitHub; sin tocar DAT-1, MET-2, FE-1/3/4/5/6, DEU-1/2/3/4, OPS-2
- `SESSION_LOG.md` — bitácora histórica completa: bugs encontrados y su causa raíz, todo
  el proceso de deploy, diagnóstico de incidentes de producción

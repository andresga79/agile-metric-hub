# Mejoras Propuestas — Agile Metric Hub (revisión crítica)

> Fecha: 2026-07-24 · Alcance: revisión crítica de todo el proyecto (backend Express,
> dashboard React, librerías compartidas, infra Docker, metodología de métricas).
> Cada punto está fundamentado con evidencia concreta (`archivo:línea`) obtenida
> auditando el código, no supuestos. Priorizado por **impacto** y **esfuerzo**.

## Cómo leer esto

- **Impacto** = qué tan grave es para confiabilidad de los datos, seguridad, o para
  la decisión del líder técnico/scrum master que usa la herramienta.
- **Esfuerzo** = trabajo estimado para resolverlo bien (no un parche).
- **Quick wins** = Impacto Alto/Medio + Esfuerzo Bajo. Empezar por ahí.

Contexto honesto: el proyecto muestra **buena intención** en varios lugares (pipeline
de tipos OpenAPI→orval→zod, hardening de supply-chain en `pnpm-workspace.yaml`, y todas
las correcciones de métricas hechas en sesiones recientes). Pero los **fundamentos de
producción faltan**: cero tests, cero CI, sin manejo de errores centralizado, y varios
puntos donde los datos se degradan en silencio. Hoy es un prototipo/herramienta interna
madura en features, inmadura en robustez.

---

## Tabla resumen (priorización)

| ID | Mejora | Impacto | Esfuerzo | Tipo |
|----|--------|:-------:|:--------:|------|
| SEC-1 | Secreto JWT con fallback hardcodeado (token admin falsificable) | 🔴 Alto | 🟢 Bajo | Seguridad |
| SEC-2 | Admin `admin/admin123` sin rotación forzada | 🔴 Alto | 🟢 Bajo | Seguridad |
| SEC-3 | RBAC (`can_view`) solo en el cliente — la API no lo valida | 🔴 Alto | 🟡 Medio | Seguridad |
| SEC-4 | Sin rate limiting en login, CORS abierto, sin helmet | 🟠 Medio | 🟢 Bajo | Seguridad |
| DAT-1 | Truncamiento silencioso a ~100 issues por ventana de 7 días | 🔴 Alto | 🟡 Medio | Datos |
| DAT-2 | Comparación período-anterior rota en Analíticas (cap de 90d) | 🔴 Alto | 🟢 Bajo | Datos |
| DAT-3 | `drizzle-kit push` borra la tabla `jira_cache` | 🟠 Medio | 🟢 Bajo | Datos |
| DAT-4 | Timeout/error de portfolio pisa datos buenos con `null` | 🟠 Medio | 🟢 Bajo | Datos |
| DAT-5 | Sin backoff/retry ante 429 de Jira, sin límite global de concurrencia | 🟠 Medio | 🟡 Medio | Datos |
| QA-1 | Cero tests automatizados en todo el repo | 🔴 Alto | 🔴 Alto | Calidad |
| QA-2 | Cero CI/CD (nada corre en push/PR) | 🔴 Alto | 🟢 Bajo | Calidad |
| QA-3 | Sin lint enforcement; `strict` de TS incompleto | 🟠 Medio | 🟢 Bajo | Calidad |
| QA-4 | Sin manejador de errores global en Express | 🟠 Medio | 🟢 Bajo | Calidad |
| MET-1 | "DORA Score" no son métricas DORA reales (nombre engañoso) | 🟠 Medio | 🟡 Medio | Metodología |
| MET-2 | Story-point / campos custom de Jira hardcodeados | 🟠 Medio | 🟡 Medio | Metodología |
| FE-1 | Cliente tipado generado esquivado por ~40 `fetch` crudos | 🟠 Medio | 🟡 Medio | Frontend |
| FE-2 | ~45 usos de `any` anulan la seguridad de tipos | 🟠 Medio | 🟡 Medio | Frontend |
| FE-3 | Lógica duplicada (formato, thresholds, colores) en 4+ páginas | 🟡 Bajo | 🟢 Bajo | Frontend |
| FE-4 | i18n: locales desincronizados + strings en español hardcodeados | 🟡 Bajo | 🟢 Bajo | Frontend |
| FE-5 | Accesibilidad casi nula (2 `aria-*` en todo `pages/`) | 🟡 Bajo | 🟡 Medio | Frontend |
| OPS-1 | Sin endpoint de liveness/readiness del API | 🟠 Medio | 🟢 Bajo | Ops |
| OPS-2 | Estado de sync solo en memoria (se pierde al reiniciar) | 🟡 Bajo | 🟡 Medio | Ops |
| DEU-1 | `lib/jira.ts` (1410 líneas) y `admin.tsx` (1162) son god-files | 🟡 Bajo | 🔴 Alto | Deuda |
| DEU-2 | ~5 reimplementaciones de `getISOWeek` / semana ISO | 🟡 Bajo | 🟢 Bajo | Deuda |
| DEU-3 | `pnpm` en versión alpha; `lib/integrations` fantasma; deps sin usar | 🟡 Bajo | 🟢 Bajo | Deuda |
| DEU-4 | `artifacts/mockup-sandbox` es código muerto (no está en el workspace) | 🟢 Bajo | 🟢 Bajo | Deuda |
| DOC-1 | Sin README ni doc de arquitectura (solo `replit.md` + `SESSION_LOG`) | 🟠 Medio | 🟡 Medio | Docs |

**Quick wins recomendados (arrancar por acá):** SEC-1, SEC-2, SEC-4, DAT-2, DAT-3, DAT-4, QA-2, QA-3, QA-4, DEU-2, DEU-4, OPS-1.

---

## 🔴 Seguridad

### SEC-1 — Secreto JWT con fallback hardcodeado · Impacto Alto · Esfuerzo Bajo
`artifacts/api-server/src/lib/jwt.ts:4` usa
`process.env["JWT_SECRET"] ?? "dev-secret-please-change-in-production"`. Si la variable
no está seteada, el server firma y valida tokens con un string público conocido →
**cualquiera puede forjar un token de admin válido**. Hay tres rutas de default
inconsistentes: el fallback en código, `.env:32` con el valor de ejemplo sin cambiar, y
`docker-compose.yml:32` con un tercer default. Además `verifyToken` (`jwt.ts:19`) no fija
`algorithms: ["HS256"]` (riesgo de confusión de algoritmo).
**Recomendación:** fallar al arrancar si `JWT_SECRET` no está seteado o es débil (igual
que `index.ts:11` ya hace con `PORT`); fijar el algoritmo; unificar el default a "sin
default". Ojo también: `JWT_EXPIRE_MINUTES` en `.env` es código muerto — el código lee
`JWT_EXPIRE`.

### SEC-2 — Admin `admin/admin123` sin rotación forzada · Impacto Alto · Esfuerzo Bajo
`artifacts/api-server/src/index.ts:185-193` crea en el primer arranque un usuario
`admin` / `admin@example.com` con `DEFAULT_ADMIN_PASSWORD ?? "admin123"`. No hay flag de
"contraseña temporal" ni cambio forzado en el primer login; la cuenta persiste
indefinidamente con esa contraseña. `bcrypt` usa cost 10 (aceptable, pero bajo para 2026;
considerar 12).
**Recomendación:** marcar la contraseña inicial como temporal y forzar cambio en el
primer login; subir el cost de bcrypt.

### SEC-3 — RBAC de lectura solo en el cliente · Impacto Alto · Esfuerzo Medio
Las rutas de admin sí están protegidas (`routes/admin.ts:12` aplica
`requireAuth, requireAdmin`). Pero el control por sección (`role_permissions.can_view`)
**solo se aplica en el frontend** para ocultar pestañas. Todos los endpoints de métricas
(`metrics.ts:314,399`, `analytics.ts:267`, `sla.ts:33`, `qa-rejected.ts:146`,
`evolution.ts:28`, `cfd.ts:108`, …) están protegidos únicamente con `requireAuth`.
**Cualquier usuario autenticado, sin importar su rol, puede leer todas las métricas de
todos los proyectos llamando la API directamente.** El único chequeo real de
`role_permissions` en el server es para escrituras de `targets` (`targets.ts:20-36`).
**Recomendación:** middleware server-side que valide `can_view` de la sección
correspondiente en los GET de datos.

### SEC-4 — Sin rate limiting, CORS abierto, sin helmet · Impacto Medio · Esfuerzo Bajo
`artifacts/api-server/src/app.ts:28` usa `cors()` sin config (todos los orígenes). No hay
`helmet` (sin CSP/HSTS/X-Frame-Options), no hay rate limiting en ningún lado —
`/auth/login` (`auth.ts:11`) es fuerza-bruteable (bcrypt es el único freno). Sin límite de
tamaño de body más allá del default de Express.
**Recomendación:** `express-rate-limit` en login y endpoints sensibles, `helmet`, CORS con
allowlist de orígenes.

> Nota positiva de seguridad: **no hay inyección SQL** (todo pasa por templates
> parametrizados de Drizzle, incluido el SQL crudo de `jira-cache.ts`), el logger
> **redacta** los headers de autorización (`logger.ts:7-11`), el token de Jira no se
> loguea, y `.env` no está en git ni en el historial. El token de Jira sí está en texto
> plano en `.env:19` en disco — conviene rotarlo si el árbol se comparte.

---

## 🔴 Fiabilidad de datos

### DAT-1 — Truncamiento silencioso a ~100 issues por ventana de 7 días · Impacto Alto · Esfuerzo Medio
`artifacts/api-server/src/lib/jira.ts:891-1001`. Como el `nextPageToken` de este sitio de
Jira está roto (la página 2 devuelve la misma que la 1), el código parte el rango en
chunks de 7 días y usa un detector de "paginación estancada" (`jira.ts:949-952`). El
efecto real: **cualquier ventana de 7 días con más de ~100 issues pierde los issues
excedentes en silencio.** El warning que se emite ("Pagination stalled") está redactado
como una nota defensiva de paginación, no como "datos truncados" — no cuenta cuántos
issues se descartaron ni compara total-vs-traído. Un proyecto grande que resuelva >100
issues (no-subtareas) en una semana tendrá métricas calculadas sobre datos incompletos sin
ninguna señal visible. Mismo patrón latente en `getResolvedJiraIssuesInRange`
(`jira.ts:1041-1068`).
**Recomendación:** usar la cuenta real de Jira (`total`) por chunk y, si excede lo
traído, o bien sub-dividir el chunk (a 1 día) o registrar/exponer un flag de "datos
parciales" en la respuesta.

### DAT-2 — Comparación período-anterior rota en Analíticas · Impacto Alto · Esfuerzo Bajo
`artifacts/api-server/src/routes/analytics.ts:514` hace
`getJiraIssuesForProject(projectId, periodDays * 2)` para alcanzar dos períodos hacia
atrás, pero `periodDays * 2` (hasta 180) se capa en silencio a 90 por
`JIRA_MAX_LOOKBACK_DAYS`. La ventana "anterior" `[180d, 90d)` queda **completamente fuera**
de los datos realmente traídos, así que `prevFiltered` es efectivamente vacío y la
comparación queda rota. (En `portfolio-cache.ts` esto se resolvió esta sesión con
`getResolvedJiraIssuesInRange`, que sí supera el cap — Analíticas no recibió el mismo
tratamiento.)
**Recomendación:** aplicar la misma solución que portfolio — usar
`getResolvedJiraIssuesInRange` para el tramo 91-180d en `analytics.ts`.

### DAT-3 — `drizzle-kit push` borra `jira_cache` · Impacto Medio · Esfuerzo Bajo
La tabla `jira_cache` se crea con SQL crudo (`jira-cache.ts:69-77`) y **no existe en el
schema de Drizzle** (confirmado: no aparece en `lib/db/src/schema/`). Un `drizzle-kit
push` de rutina para migrar cualquier otra tabla propondrá **DROP** de `jira_cache`,
borrando todo el cache (y forzando un re-sync completo de Jira). Hoy solo sobrevive porque
`ensureCacheTable` la recrea vacía al arrancar.
**Recomendación:** llevar `jira_cache` al schema de Drizzle (o documentar de forma
prominente que nunca se corra `push` a ciegas — ya está en `SESSION_LOG`, pero depende de
disciplina humana).

### DAT-4 — Timeout/error de portfolio pisa datos buenos con `null` · Impacto Medio · Esfuerzo Bajo
`artifacts/api-server/src/lib/portfolio-cache.ts:255-321`. Cuando un proyecto excede el
timeout de 120s (o falla), se genera una fila placeholder con todas las métricas en `null`
y `error:"timeout"` — y **esa fila se escribe igual en la DB** vía upsert, pisando la
última fila buena. Una respuesta lenta transitoria de Jira deja el proyecto en blanco en
el Resumen Ejecutivo en vez de conservar el último valor conocido.
**Recomendación:** en timeout/error, no hacer upsert de nulls — conservar la fila previa
(o marcar `stale` sin borrar los valores).

### DAT-5 — Sin backoff/retry ante 429, sin límite global de concurrencia a Jira · Impacto Medio · Esfuerzo Medio
`jiraFetch` (`jira.ts:600-617`) no maneja 429 ni `Retry-After`, no reintenta: una
respuesta no-OK simplemente loguea y lanza. No hay limitador global de concurrencia; la
concurrencia se compone de forma multiplicativa (portfolio corre 3 proyectos × ~3-8 fetches
c/u, más el warm-up con otros 3×4), pudiendo estallar en decenas de requests simultáneos a
Jira sin throttle → 429s probables, que son fatales para ese fetch y degradan métricas en
silencio.
**Recomendación:** un limitador global (p.ej. `p-limit`) + retry con backoff exponencial
respetando `Retry-After` en `jiraFetch`.

---

## 🔴 Calidad / Testing / CI

### QA-1 — Cero tests automatizados · Impacto Alto · Esfuerzo Alto
No hay un solo `*.test.ts`/`*.spec.ts`, ni config de vitest/jest, ni script `test` en
ninguno de los 9 paquetes. La única red de seguridad es `tsc --noEmit`. Irónicamente,
`artifacts/dashboard/tsconfig.json` **excluye** `**/*.test.ts` — se anticipó infra de
tests que nunca se escribió. Dado el historial de esta sesión (múltiples bugs sutiles de
cálculo de métricas: signo de `normalize`, regex EN-only, ventanas de período, cap de
90d), la ausencia de tests es el mayor riesgo estructural: cada fix podría regresionar sin
aviso.
**Recomendación:** empezar por tests unitarios de la lógica pura de mayor riesgo —
`getCycleTimeDays`, `getLeadTimeDays`, `countReopenedIssues`, `normalize`,
`computeQaRejectionRate`, `getEffectiveThresholds`, y los `getISOWeek`. Son funciones puras,
fáciles de testear, y son justo donde han vivido los bugs.

### QA-2 — Cero CI/CD · Impacto Alto · Esfuerzo Bajo
No hay `.github/workflows` ni ninguna otra config de CI. Nada corre typecheck/lint/tests en
push o PR; la corrección solo se valida al construir la imagen Docker. Cualquiera puede
mergear código que no compila.
**Recomendación:** un workflow mínimo de GitHub Actions que corra `pnpm run typecheck`
(y, cuando existan, lint + tests) en cada PR. Es el quick win de mayor retorno de toda la
lista.

### QA-3 — Sin lint enforcement; `strict` de TS incompleto · Impacto Medio · Esfuerzo Bajo
No hay config de ESLint/Prettier/Biome. `prettier` está como devDependency pero sin config
ni script. `tsconfig.base.json` **no** activa `strict: true` — elige flags a mano y de
hecho debilita algunos (`strictFunctionTypes: false`, `noImplicitOverride: false`,
`noUnusedLocals: false`); faltan `noUncheckedIndexedAccess` y `exactOptionalPropertyTypes`.
**Recomendación:** activar `strict: true`, agregar ESLint (con `typescript-eslint`) + un
script `lint`, y correrlo en CI (QA-2).

### QA-4 — Sin manejador de errores global en Express · Impacto Medio · Esfuerzo Bajo
`artifacts/api-server/src/app.ts` no registra middleware de error `(err, req, res, next)`.
De 51 handlers, solo 4 archivos tienen `try/catch`. Express 5 auto-reenvía las promesas
rechazadas (así que no crashea el proceso), pero sin handler propio devuelve el HTML 500
por defecto — **no** el `application/problem+json` que el `custom-fetch.ts` del cliente
está preparado para parsear. Las respuestas de error quedan inconsistentes y sin tipo.
**Recomendación:** un error handler central que devuelva el shape JSON esperado por el
cliente, y quitar los `try/catch` ad hoc repetidos.

---

## 🟠 Metodología de métricas

### MET-1 — "DORA Score" no son métricas DORA reales · Impacto Medio · Esfuerzo Medio
`artifacts/api-server/src/routes/project-health.ts:126-131` calcula el "DORA Score" como
el promedio de throughput + cycle time + CFR normalizados. Pero:
- **Throughput** = issues resueltos/semana, **no** frecuencia de despliegue.
- **CFR** = bugs resueltos / issues resueltos (`project-health.ts:103-104`), **no** el
  Change Failure Rate real (% de despliegues que causan fallo).
- No hay ninguna fuente de datos de CI/CD ni de despliegues — solo Jira. Con solo Jira, las
  métricas DORA reales (Deployment Frequency, Lead Time for Changes, Change Failure Rate,
  MTTR) **no son calculables**.

El público objetivo (líderes técnicos, scrum masters) puede conocer DORA de verdad y perder
confianza, o peor, tomar decisiones creyendo que es DORA cuando es un compuesto de flujo de
Jira. Este mismo cálculo ahora también alimenta el "Health Score Prom." del Resumen
Ejecutivo, así que el nombre engañoso se propaga.
**Recomendación:** renombrarlo a algo honesto ("Índice de Salud de Flujo" / "Flow Health
Score") y documentar la fórmula, o —si se quiere DORA real— integrar una fuente de
despliegues (GitHub/GitLab/CI) para Deployment Frequency y CFR reales.

### MET-2 — Campos custom de Jira hardcodeados · Impacto Medio · Esfuerzo Medio
El campo de story points está hardcodeado como `customfield_10016`
(`jira.ts:137-139`), y la lista de campos que se piden a Jira
(`summary,status,...customfield_10016,customfield_10028,...`) está **re-tipeada en ~6-7
funciones** de `jira.ts` (`jira.ts:863,913,1030,1103,1157,1207`). Los IDs de campos custom
son específicos de la instancia de Jira — este código se rompe silenciosamente en otra
instancia (story points en `null`, velocity en 0), y agregar un campo obliga a editar 7
strings.
**Recomendación:** centralizar la lista de campos en una constante única; hacer los IDs de
campos custom configurables por entorno (o descubrirlos vía la API de fields de Jira).

---

## 🟠 Arquitectura Frontend

### FE-1 — El cliente tipado generado se esquiva con ~40 `fetch` crudos · Impacto Medio · Esfuerzo Medio
Existe un pipeline serio (OpenAPI → orval → hooks React Query tipados + capa `ApiError` en
`custom-fetch.ts`), y ~21 archivos lo importan. Pero la mayoría de las páginas **también**
hacen `fetch("/api/...")` a mano con `Authorization: Bearer` (aparece ~31 veces),
frecuentemente en el mismo archivo que usa los hooks generados. Ej.: `dashboard.tsx`
(5 fetches manuales), `admin.tsx` (~11-13), `project-flow/analytics/report/detail/…`. El
grueso de los payloads de métricas se consume sin tipos, desperdiciando la inversión en la
generación.
**Recomendación:** migrar los `fetch` manuales a los hooks generados (agrega tipos y auth
gratis); para lo que falte en el OpenAPI, agregarlo al spec y regenerar.

### FE-2 — ~45 usos de `any` anulan la seguridad de tipos · Impacto Medio · Esfuerzo Medio
~39 `any` en las páginas del dashboard (más ~45 en todo `src` contando backend). El dato
traído a mano se guarda como `useState<any>` / `useState<any[]>` y los callbacks son
`(x: any) =>`, justo en las páginas que más se beneficiarían de los tipos. Peor:
`dashboard.tsx:201` castea *fuera* un tipo generado (`(summary as any)?.usingMockData`), y
`portfolio-cache.ts:298` hace `.values(item as any)` (bypassa el tipado de insert de
Drizzle).
**Recomendación:** ligado a FE-1 — al usar los hooks generados desaparece la mayoría de
los `any`. Prohibir `any` vía ESLint (`@typescript-eslint/no-explicit-any`).

### FE-3 — Lógica duplicada en 4+ páginas · Impacto Bajo · Esfuerzo Bajo
- `formatDurationDays`: copia byte-por-byte en **4 archivos** (`dashboard.tsx:23`,
  `project-analytics.tsx:15`, `project-detail.tsx:33`, `project-kanban.tsx:14`).
- Merge de thresholds global+override: reimplementado en `project-detail.tsx:77`,
  `project-analytics.tsx:115`, `project-sprints.tsx:53`, `dashboard.tsx`, `admin.tsx:237`,
  cada uno con su propia constante `DEFAULT_*_THRESHOLDS` y su tipo `MetricThreshold`.
- Mapeo estado→color: ~70 ocurrencias inline de clases/HSL repartidas por las páginas.
**Recomendación:** extraer a `lib/` (`formatDurationDays`, `mergeThresholds`, un mapa
`status→color`, y un hook `useThresholds(projectId)`).

### FE-4 — i18n desincronizado + español hardcodeado · Impacto Bajo · Esfuerzo Bajo
`en.json` tiene 518 claves, `es.json` 575: **57 claves solo existen en es** (`action.*`,
`metric.*`, `status.*`) → en inglés caen al string de la clave. ~106 claves en `en.json`
nunca se referencian (peso muerto). Y hay **español hardcodeado que evita `t()`**:
`dashboard.tsx:42-56` (`"Rojo"/"Amarillo"/"Verde"`, `"Reducir cycle time"`, …),
`:401` `"Sincronizar ahora"`, `:511-512` `"Proyectos en Riesgo"` + tooltip, y todos los
toasts de `admin.tsx:373-441` (uno con typo: `"Configuracion"`). `:213` fija `"es-MX"`.
**Recomendación:** reconciliar locales (agregar las 57 faltantes en en, podar las ~106
huérfanas) y rutear los strings hardcodeados por `t()`.

### FE-5 — Accesibilidad casi nula · Impacto Bajo · Esfuerzo Medio
Solo **2 atributos `aria-*`** en todo `pages/`. Botones con solo ícono dependen de
`title=` en vez de `aria-label` (ej. refresh en `project-flow.tsx:148`). Elementos
interactivos de Recharts (`onClick` en `<Line>`) sin affordance accesible. Las tablas sí
tienen mayormente `overflow-x-auto` (bien para móvil), pero conviene verificar cada una.
**Recomendación:** `aria-label` en botones de ícono, revisar navegación por teclado, y
completar los wrappers de scroll en tablas.

---

## 🟠 Operación / Observabilidad

### OPS-1 — Sin endpoint de liveness/readiness del API · Impacto Medio · Esfuerzo Bajo
`docker-compose.yml` solo tiene `healthcheck` para la base de datos; los contenedores `api`
y `web` usan `restart: unless-stopped` pero **sin healthcheck**, así que un orquestador no
sabe si el API realmente está sirviendo (podría estar arriba pero con la DB caída o el sync
colgado). No existe endpoint `/healthz`/`/readyz` a nivel app.
**Recomendación:** agregar un `GET /healthz` (liveness) y `/readyz` (chequea DB + estado de
sync) y un `healthcheck` en el compose para `api` y `web`.

### OPS-2 — Estado de sync solo en memoria · Impacto Bajo · Esfuerzo Medio
Todo el estado del sync (`lastSyncedAt`, `isPortfolioRecalculating`, contadores) son
globales de módulo en memoria (`portfolio-cache.ts`, `jira-cache.ts`). Al reiniciar se
pierde `lastSyncedAt` y puede re-disparar un sync completo. El guard de "no correr en
paralelo" es solo intra-proceso — con múltiples réplicas/pods cada una sincroniza por su
cuenta (sin lock en DB).
**Recomendación:** persistir el estado del sync en una tabla y usar un lock/advisory-lock
en Postgres si se prevé más de una instancia.

---

## 🟡 Deuda técnica / Mantenibilidad

### DEU-1 — God-files: `jira.ts` (1410 líneas) y `admin.tsx` (1162) · Impacto Bajo · Esfuerzo Alto
`lib/jira.ts` mezcla cliente HTTP, parsing, detección de estados, cálculo de métricas,
QA rejection, mocks y cache-keys. `admin.tsx` es un componente monolítico con ~11 fetches y
múltiples sub-tablas. Ambos son difíciles de navegar y testear.
**Recomendación:** dividir `jira.ts` por responsabilidad (cliente, parsing de estados,
métricas de tiempo, QA); partir `admin.tsx` en sub-componentes por pestaña. (Esfuerzo alto,
hacer incrementalmente al tocar cada área.)

### DEU-2 — ~5 reimplementaciones de semana ISO · Impacto Bajo · Esfuerzo Bajo
`getISOWeek`/bucketing de semana duplicado en `analytics.ts:55`, `issues-by-week.ts:58`,
`kanban-metrics.ts:52`, y `metric-snapshots.ts:20` (más el derivado de lunes). Hoy
coinciden por coordinación manual; un cambio en una desincroniza los buckets entre vistas
en silencio. Igual, la regex de "done" multi-idioma aparece 3× y la de "blocked" 2×.
**Recomendación:** un único `getISOWeek` compartido en `lib/`, e importar las regex/helpers
de estado desde un solo lugar.

### DEU-3 — pnpm alpha, `lib/integrations` fantasma, deps sin usar · Impacto Bajo · Esfuerzo Bajo
`pnpm@12.0.0-alpha.17` (prerelease) pineado en ambos Dockerfiles — irónico junto al
hardening de supply-chain del workspace. `lib/integrations/` está listado en
`pnpm-workspace.yaml` pero es un directorio **vacío** (los Dockerfiles lo parchan con
`mkdir -p`). `node-fetch@^3.3.2` está declarado en el API pero no se importa (Node 24 tiene
`fetch` global). Sin campo `packageManager`/corepack, la versión de pnpm puede driftear
entre local y Docker.
**Recomendación:** bajar pnpm a una versión estable + pinear con `packageManager`; crear
`lib/integrations` de verdad o quitarlo del workspace; borrar `node-fetch`.

### DEU-4 — `artifacts/mockup-sandbox` es código muerto · Impacto Bajo · Esfuerzo Bajo
`artifacts/mockup-sandbox/` (con ~1000+ líneas de componentes shadcn duplicados:
`sidebar.tsx` 714 líneas, `chart.tsx` 365) **no está en `pnpm-workspace.yaml` ni en
`docker-compose.yml`** — no se construye ni se referencia. Es peso muerto que confunde y
puede quedar desactualizado respecto al dashboard real.
**Recomendación:** borrarlo (o moverlo fuera del repo si se usa como referencia de diseño).

---

## 📄 Documentación

### DOC-1 — Sin README ni doc de arquitectura · Impacto Medio · Esfuerzo Medio
Los únicos `.md` son `replit.md` (45 líneas) y `SESSION_LOG.md` (bitácora de trabajo, no
onboarding). No hay README con: qué es el proyecto, cómo levantarlo, el modelo de datos, el
flujo de sync, ni la definición de cada métrica. El `SESSION_LOG` es excelente para
continuidad entre sesiones pero no reemplaza documentación de producto/arquitectura, y hoy
concentra todo el conocimiento tribal.
**Recomendación:** un `README.md` de arranque (setup, arquitectura, variables de entorno) y
un `METRICS.md` que defina con precisión cada métrica y su fórmula (crítico dado MET-1: los
usuarios necesitan saber qué significa cada número).

---

## Secuencia sugerida

1. **Semana 1 (quick wins de riesgo):** SEC-1, SEC-2, SEC-4, DAT-2, DAT-3, DAT-4, QA-2
   (CI mínimo con typecheck), OPS-1, DEU-4.
2. **Semana 2 (fundamentos):** QA-3 (lint + strict), QA-4 (error handler), QA-1 (primeros
   tests de la lógica pura de métricas), SEC-3 (RBAC server-side).
3. **Semana 3+ (robustez y claridad):** DAT-1, DAT-5, MET-1/MET-2, FE-1/FE-2, DOC-1, y
   refactors incrementales (DEU-1, DEU-2, FE-3).

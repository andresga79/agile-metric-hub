# Mejoras Propuestas — Agile Metric Hub (revisión crítica)

> Auditoría original: 2026-07-24 (27 hallazgos, backend + frontend + infra + metodología).
> **Actualizado: 2026-08-25** — se verificó cada hallazgo contra el código actual. La
> mayoría de Seguridad y varios de Datos/Calidad ya están resueltos; se listan abajo con
> evidencia de cierre. Lo que sigue pendiente se mantiene con el detalle original.

## Cómo leer esto

- **Impacto** = qué tan grave es para confiabilidad de los datos, seguridad, o para
  la decisión del líder técnico/scrum master que usa la herramienta.
- **Esfuerzo** = trabajo estimado para resolverlo bien (no un parche).
- ✅ Resuelto · 🟡 Parcial (mejoró pero no está cerrado) · ⬜ Pendiente

---

## ✅ Resuelto desde la auditoría original

| ID | Hallazgo | Evidencia de cierre |
|----|----------|---------------------|
| SEC-1 | JWT secret con fallback hardcodeado | `jwt.ts`: sin fallback en runtime, `getSecret()` lanza si falta `JWT_SECRET`; `assertJwtConfig()` bloquea producción con secret débil/placeholder; `algorithms: ["HS256"]` fijado en sign/verify. |
| SEC-2 | Admin `admin/admin123` sin rotación forzada | `index.ts:226-232`: bootstrap falla en producción si `DEFAULT_ADMIN_PASSWORD` es corto o sigue en `"admin123"`. bcrypt cost subió 10 → 12 (`security.ts:16`). |
| SEC-3 | RBAC de lectura solo en el cliente | `requireSectionView(...)` server-side aplicado en `metrics.ts`, `sla.ts`, `evolution.ts`, `cfd.ts`, `kanban-metrics.ts`, `forecast.ts`, `project-health.ts`, `qa-rejected.ts`. Los GET de `metrics`/`analytics`/`portfolio`/`targets` que quedan solo con `requireAuth` son "baseline" abierto a propósito (alimentan el overview, no gateado por sección en el frontend). |
| SEC-4 | Sin rate limiting / CORS abierto / sin helmet | `security.ts`: headers tipo helmet (CSP, X-Frame-Options, HSTS en prod), rate limiter propio en `/auth/login`, body limit 1mb. CORS con allowlist vía `CORS_ORIGIN`. |
| DAT-2 | Comparación período-anterior rota en Analíticas | `analytics.ts:623` ahora usa `getResolvedJiraIssuesInRange` para el tramo previo, superando el cap de 90d (mismo fix que portfolio). |
| DAT-3 | `drizzle-kit push` borraba `jira_cache` | `lib/db/src/schema/jira-cache.ts` ya define `jiraCacheTable` en el schema de Drizzle. |
| DAT-4 | Timeout/error de portfolio pisaba datos buenos con `null` | `portfolio-cache.ts:248,309` preserva la fila previa en timeout/error en vez de pisarla. |
| QA-3 | Sin lint enforcement; `strict` incompleto | `eslint.config.mjs` activo (`pnpm run lint`, 0 errores); `tsconfig.base.json:9` tiene `"strict": true`. |
| QA-4 | Sin manejador de errores global en Express | `app.ts:71` define un `errorHandler: ErrorRequestHandler` central. |
| MET-1 | "DORA Score" no eran métricas DORA reales | Renombrado a "Flow Health Score" en código, i18n y `METRICS.md:210`, con la fórmula documentada. |

---

## 🟡 Parcial — mejoró pero no está cerrado

- **QA-1** (cero tests) — hay un archivo (`metrics-logic.test.ts`, 35 tests) que cubre justo la lógica pura recomendada (`normalize`, cycle/lead time, QA rejection, ISO week). Sigue siendo el único archivo de test del repo.
- **FE-1** (fetches manuales fuera del cliente tipado) — bajó de ~40 a **8 archivos / 34 llamadas** con `fetch("/api/...")` manual. Mejora real, no eliminado.
- **OPS-1** (sin liveness/readiness) — existe `GET /api/healthz` a nivel app, pero `docker-compose.yml` solo tiene `healthcheck` para `db`; `api` y `web` siguen sin healthcheck en el compose.
- **DEU-3** (pnpm alpha / deps sueltas) — sigue sin `packageManager` pineado en el `package.json` raíz y `node-fetch` sigue declarado sin uso en `api-server`.
- **DOC-1** (sin docs) — `METRICS.md` ya existe y es sustancial (cubre justo lo que motivó MET-1). Sigue sin `README.md` de arquitectura/setup.

---

## ⬜ Pendiente — quick wins (Impacto Alto/Medio + Esfuerzo Bajo)

### QA-2 — Sin CI real de typecheck/lint/test · Impacto Alto · Esfuerzo Bajo
Existe `.github/workflows/sync-azure.yml`, pero es solo sync a Azure DevOps — no corre
`pnpm run typecheck`/`lint`/`test` en push/PR. La nota original de "bloqueado por scope
`workflow` del token de GitHub" ya no aplica: el repo tiene Actions habilitado (ese
workflow corre), así que agregar uno de CI es viable ahora.
**Recomendación:** un workflow mínimo que corra typecheck + lint + test en cada PR.

### DEU-4 — `artifacts/mockup-sandbox` sigue siendo código muerto · Impacto Bajo · Esfuerzo Bajo
Sigue existiendo con sus ~1000+ líneas de componentes shadcn duplicados, sin estar en
`pnpm-workspace.yaml` ni `docker-compose.yml`.
**Recomendación:** borrarlo o moverlo fuera del repo si se usa como referencia.

### DAT-5 — Sin backoff/retry ante 429 de Jira, sin límite global de concurrencia · Impacto Medio · Esfuerzo Medio
`jiraFetch` sigue sin manejar 429/`Retry-After` ni reintentos; no hay limitador global
(`p-limit` o similar) — la concurrencia de portfolio sigue componiéndose
multiplicativamente.
**Recomendación:** limitador global + retry con backoff exponencial en `jiraFetch`.

---

## ⬜ Pendiente — el resto

### DAT-1 — Truncamiento silencioso a ~100 issues por ventana de 7 días · Impacto Alto · Esfuerzo Medio
`jira.ts:1228,1336` sigue solo logueando "Pagination stalled" sin contar ni exponer
issues descartados. Sigue latente con los volúmenes actuales (OLI ~16/semana, OLP ~8) —
no está produciendo números malos hoy, pero un proyecto que crezca puede perder datos sin
señal visible.
**Recomendación:** usar el `total` real de Jira por chunk y exponer un flag de "datos
parciales" si se excede.

### MET-2 — Campos custom de Jira hardcodeados · Impacto Medio · Esfuerzo Medio
`customfield_10016`/`customfield_10028` siguen hardcodeados literal en 6+ lugares de
`jira.ts`. Deuda de portabilidad (funciona bien en esta instancia de Jira), se rompe
silenciosamente en otra.
**Recomendación:** centralizar la lista de campos en una constante única; hacerlos
configurables por entorno.

### FE-2 — ~44 usos de `any` en el dashboard · Impacto Medio · Esfuerzo Medio
Sin cambio real de orden de magnitud desde la auditoría original.
**Recomendación:** ligado a FE-1 — migrar los fetches manuales restantes elimina la
mayoría; prohibir `any` nuevo vía ESLint.

### FE-3 — Lógica duplicada en varios archivos · Impacto Bajo · Esfuerzo Bajo
`formatDurationDays` sigue copiado en 4 archivos; el merge de thresholds sigue
reimplementado en 3.
**Recomendación:** extraer a `lib/` (`formatDurationDays`, `mergeThresholds`, mapa
estado→color).

### FE-4 — i18n desincronizado + español hardcodeado · Impacto Bajo · Esfuerzo Bajo
No se confirmó reconciliación completa de `en.json`/`es.json`; el string hardcodeado
fuera de `t()` no se re-auditó en detalle esta vez.
**Recomendación:** reconciliar locales y rutear strings hardcodeados por `t()`.

### FE-5 — Accesibilidad casi nula · Impacto Bajo · Esfuerzo Medio
Sigue en solo 2 `aria-*` en todo `pages/`, sin cambio.
**Recomendación:** `aria-label` en botones de ícono, revisar navegación por teclado.

### FE-6 — Reporte se queda en "Cargando..." ante un fetch fallido · Impacto Medio · Esfuerzo Bajo
`project-report.tsx:46,110` sigue usando `t("common.loading")` como mensaje de error en
el catch — un fetch fallido/abortado deja la página en "Cargando..." indefinidamente.
**Recomendación:** mensaje de error propio + botón de reintento.

### OPS-2 — Estado de sync solo en memoria · Impacto Bajo · Esfuerzo Medio
`lastSyncedAt`/`isPortfolioRecalculating` siguen como variables de módulo; no hay lock
de DB para múltiples instancias.
**Recomendación:** persistir en una tabla + advisory-lock si se prevé más de una réplica.

### DEU-1 — God-files: `jira.ts` (creció a 1692 líneas) y `admin.tsx` (1162) · Impacto Bajo · Esfuerzo Alto
`jira.ts` creció desde las 1410 líneas originales en vez de dividirse.
**Recomendación:** dividir por responsabilidad; hacerlo incrementalmente al tocar cada
área.

### DEU-2 — ~3+ reimplementaciones de semana ISO · Impacto Bajo · Esfuerzo Bajo
`getISOWeek` sigue duplicado en `analytics.ts`, `issues-by-week.ts`, `kanban-metrics.ts`.
**Recomendación:** un único helper compartido en `lib/`.

---

## Secuencia sugerida (actualizada)

1. **Ahora (quick wins reales que quedan):** QA-2 (CI real — ya no está bloqueado por
   scope de GitHub), DEU-4 (borrar mockup-sandbox), DAT-5 (backoff/retry Jira).
2. **Cuando haya aire:** DAT-1 (surfacear truncamiento), MET-2, FE-1/FE-2 (terminar la
   migración a hooks tipados), OPS-2, DOC-1 (README).
3. **Refactors incrementales, sin apuro:** DEU-1, DEU-2, FE-3, FE-4, FE-5, FE-6.

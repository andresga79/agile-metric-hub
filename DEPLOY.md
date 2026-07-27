# Deploy — Render (Static + API) + Neon

Guía para publicar el proyecto **gratis**:

- **Frontend** (dashboard Vite) → **Render Static Site** (plan free)
- **Backend** (API Express + sync) → **Render** (Docker, plan free)
- **Postgres** → **Neon** (plan free)

El frontend llama a `/api/...` relativo; el **Static Site de Render hace de proxy** de
`/api/*` hacia el backend (regla de Rewrite, ver paso 3), así que el navegador ve un solo
origen y **no hay CORS** desde su punto de vista.

> **Por qué Render Static y no Vercel:** el plan **Hobby de Vercel prohíbe el uso comercial**;
> como esto es una herramienta interna de la empresa, se migró el frontend de Vercel a Render
> Static (free, sin restricción comercial) el 2026-07-27. Render y Neon free **sí** permiten uso
> comercial. Ver `SESSION_LOG.md` para el detalle de la migración.

> ⚠️ **Requisito de seguridad (ya implementado en el código):** en producción
> (`NODE_ENV=production`) el backend **no arranca** si `JWT_SECRET` es débil/ausente
> o si `DEFAULT_ADMIN_PASSWORD` es `admin123`/ausente. Los pasos de abajo lo contemplan.

---

## Orden de los pasos: Neon → Render (backend) → Render (frontend)

URLs de producción (predecibles por los nombres ya elegidos):

- Backend (Render Web Service): `https://agile-metric-hub-api.onrender.com`
- Frontend (Render Static Site): `https://agile-metric-hub.onrender.com`

El backend está en `render.yaml` (Blueprint). **El Static Site del frontend se creó a mano
por el dashboard**, NO por el Blueprint — las reglas de Rewrite de un Static Site solo se
configuran por el dashboard, no por `render.yaml`.

---

## 1. Neon (Postgres)

1. Crear un proyecto en [neon.tech](https://neon.tech) (región cercana a la de Render —
   usamos `oregon`). **Neon Auth: apagado** (usamos nuestro propio auth).
2. Copiar el **connection string** (formato `postgresql://user:pass@host/db?sslmode=require`).
   Guardalo — es el `DATABASE_URL`.
   > El `?sslmode=require` es importante: Neon exige SSL. `pg` lo interpreta del string.

No hace falta correr migraciones a mano: el backend crea/actualiza las tablas solo al
arrancar (`initDb()` en `index.ts`, idempotente).

## 2. Render (backend — Web Service Docker)

**Blueprint** (usa `render.yaml`):
1. En Render → **New → Blueprint**, conectá el repo `andresga79/agile-metric-hub`.
2. Render lee `render.yaml` y crea el web service `agile-metric-hub-api` (Docker, free).
3. `JWT_SECRET` lo **genera Render** solo. El resto de secretos (marcados `sync: false`)
   los cargás en la pestaña **Environment**:
   - `DATABASE_URL` = el string de Neon (con `?sslmode=require`)
   - `JIRA_URL` = `https://nxtaraspa.atlassian.net`
   - `JIRA_EMAIL` = tu email de Jira
   - `JIRA_API_TOKEN` = tu token de Jira
   - `DEFAULT_ADMIN_PASSWORD` = una contraseña fuerte (>=8, **no** `admin123`)
   - `CORS_ORIGIN` = `https://agile-metric-hub.onrender.com` (la URL del Static Site).
     > Nota: con el proxy del Static Site el navegador ve un solo origen y **no** dispara CORS,
     > así que `CORS_ORIGIN` hoy no es estrictamente necesario — se deja apuntando a la URL
     > correcta por prolijidad y por si algún día se llama al backend directo por CORS.
4. Deploy. Render buildea el Docker y levanta el servicio. Verificá:
   `https://agile-metric-hub-api.onrender.com/api/healthz` → `{"status":"ok"}`.

> **Free tier:** el servicio se **duerme** tras ~15 min sin tráfico (primera visita luego
> tarda ~30-60s). El sync corre al arrancar (cada cold start) y con el cron opcional (paso 4).

## 3. Render (frontend — Static Site)

Se crea **por el dashboard** (no por Blueprint):
1. En Render → **New → Static Site**, conectá el repo `andresga79/agile-metric-hub`, branch `main`.
2. Config:
   - **Name:** `agile-metric-hub` (→ `https://agile-metric-hub.onrender.com`)
   - **Root Directory:** **vacío** (raíz del repo). ⚠️ Si el wizard sugiere `artifacts/api-server`,
     borralo — tiene que quedar en la raíz para resolver el workspace pnpm.
   - **Build Command:**
     ```
     mkdir -p lib/integrations && npx --yes pnpm@12.0.0-alpha.17 install --frozen-lockfile && npx --yes pnpm@12.0.0-alpha.17 --filter @workspace/dashboard run build
     ```
   - **Publish Directory:** `artifacts/dashboard/dist/public`
3. **Reglas de Rewrite** (Settings → **Redirects/Rewrites**), **en este orden**:
   1. `Rewrite`  source `/api/*`  →  destination `https://agile-metric-hub-api.onrender.com/api/*`
   2. `Rewrite`  source `/*`      →  destination `/index.html`  (SPA fallback)
   > El `/api/*` **tiene que estar arriba** del `/*`, si no el fallback del SPA se traga las
   > llamadas al API.
4. Verificá: `https://agile-metric-hub.onrender.com/` (200 HTML),
   `/api/healthz` (200 `{"status":"ok"}` vía proxy), `/admin` (200 HTML, no 404 → SPA fallback OK),
   y el login real con `admin` / `DEFAULT_ADMIN_PASSWORD`.

> **Gotchas del build en Render Static** (monorepo pnpm + pnpm prerelease):
> - **NO usar `npm i -g pnpm`**: el dir global de npm (`/usr/lib/node_modules`) es **read-only**
>   en el build de Render Static → falla con `EROFS`. Por eso el Build Command usa `npx` (baja
>   pnpm al cache escribible y lo corre). Este fue el motivo del primer build fallido en la migración.
> - `mkdir -p lib/integrations` crea el dir vacío que referencia `pnpm-workspace.yaml` (no rastreado
>   por git) — igual que los Dockerfiles.
> - Si el build falla por versión de Node (el default de Render es muy nuevo, p. ej. 24.x), agregá
>   una env var `NODE_VERSION` = `22` al Static Site y redeployá.
> - Si falla por el lockfile, correr `pnpm install --frozen-lockfile` local primero para confirmar
>   que está sano (ver el gotcha del `react` espurio en `SESSION_LOG.md`).

## 4. (Opcional) Cron de sync diario

El backend gratis duerme, así que el `setInterval` diario no dispara. `sync-cron.yml`
(GitHub Action) lo nudgea 1×/día. Requiere secrets del repo: `API_URL`, `ADMIN_USER`,
`ADMIN_PASSWORD`. **Nota:** al vivir en `.github/workflows/`, pushearlo requiere el scope
`workflow` del token (o crearlo por la web) — mismo caso que `ci.yml`.

---

## CI/CD

- **Render** hace **auto-deploy en cada push a `main`** de ambos servicios (backend Docker y
  Static Site del frontend) una vez conectados al repo — no necesitás GitHub Actions para desplegar.
- El `ci.yml` (typecheck + test) y el `sync-cron.yml` son lo único que necesita el scope
  `workflow` para subir (ver `SESSION_LOG.md` sección 8).

## Variables de entorno — resumen

| Variable | Dónde | Valor |
|---|---|---|
| `NODE_ENV` | Render (backend) | `production` (ya en `render.yaml`) |
| `JWT_SECRET` | Render (backend) | generado por Render (auto) |
| `JWT_EXPIRE` | Render (backend) | `24h` (ya en `render.yaml`) |
| `CORS_ORIGIN` | Render (backend) | `https://agile-metric-hub.onrender.com` |
| `DATABASE_URL` | Render (backend) | connection string de Neon (`?sslmode=require`) |
| `JIRA_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` | Render (backend) | tus credenciales de Jira |
| `DEFAULT_ADMIN_PASSWORD` | Render (backend) | contraseña fuerte del admin |
| `NODE_VERSION` | Render (frontend, opcional) | `22` si el build falla por versión de Node |
| `API_URL` / `ADMIN_USER` / `ADMIN_PASSWORD` | GitHub secrets | solo para el cron opcional |

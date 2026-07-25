# Deploy — Opción B (Vercel + Render + Neon)

Guía para publicar el proyecto **gratis**:

- **Frontend** (dashboard Vite) → **Vercel**
- **Backend** (API Express + sync) → **Render** (Docker, plan free)
- **Postgres** → **Neon** (plan free)

El frontend llama a `/api/...` relativo; Vercel hace de **proxy** de `/api/*` hacia
Render (ver `vercel.json`), así que el navegador ve un solo origen y **no hay CORS**
desde su punto de vista.

> ⚠️ **Requisito de seguridad (ya implementado en el código):** en producción
> (`NODE_ENV=production`) el backend **no arranca** si `JWT_SECRET` es débil/ausente
> o si `DEFAULT_ADMIN_PASSWORD` es `admin123`/ausente. Los pasos de abajo lo contemplan.

---

## Orden de los pasos

Hay una dependencia circular menor: Vercel necesita la URL de Render, y Render necesita
la de Vercel (para CORS). Se resuelve porque **ya elegimos los nombres**, así que las URLs
son predecibles:

- Backend (Render): `https://agile-metric-hub-api.onrender.com`
- Frontend (Vercel): `https://agile-metric-hub.vercel.app`

Ambos ya están cableados en `render.yaml` y `vercel.json`. Si al crear los servicios te
tocan otras URLs, ajustá esos dos archivos (una línea cada uno) y volvé a pushear.

---

## 1. Neon (Postgres)

1. Crear un proyecto en [neon.tech](https://neon.tech) (elegí una **región** cercana a la
   de Render — abajo usamos `oregon`).
2. Copiar el **connection string** (formato `postgresql://user:pass@host/db?sslmode=require`).
   Guardalo — es el `DATABASE_URL`.
   > El `?sslmode=require` es importante: Neon exige SSL. `pg` lo interpreta del string.

No hace falta correr migraciones a mano: el backend crea/actualiza las tablas solo al
arrancar (`initDb()` en `index.ts`, idempotente).

## 2. Render (backend)

Opción A — **Blueprint** (recomendada, usa `render.yaml`):
1. En Render → **New → Blueprint**, conectá el repo `andresga79/agile-metric-hub`.
2. Render lee `render.yaml` y crea el web service `agile-metric-hub-api` (Docker, free).
3. `JWT_SECRET` lo **genera Render** solo. El resto de secretos (marcados `sync: false`)
   los cargás en la pestaña **Environment**:
   - `DATABASE_URL` = el string de Neon (con `?sslmode=require`)
   - `JIRA_URL` = `https://nxtaraspa.atlassian.net`
   - `JIRA_EMAIL` = tu email de Jira
   - `JIRA_API_TOKEN` = tu token de Jira
   - `DEFAULT_ADMIN_PASSWORD` = una contraseña fuerte (>=8, **no** `admin123`)
   - `CORS_ORIGIN` ya viene puesta a la URL de Vercel; ajustala si tu dominio difiere.
4. Deploy. Render buildea el Docker y levanta el servicio. Verificá:
   `https://agile-metric-hub-api.onrender.com/api/healthz` → `{"status":"ok"}`.

> **Free tier:** el servicio se **duerme** tras ~15 min sin tráfico (primera visita luego
> tarda ~30-60s). El sync corre al arrancar (cada cold start) y con el cron opcional (paso 4).

## 3. Vercel (frontend)

1. En Vercel → **Add New → Project**, importá el repo.
2. Vercel toma la config de `vercel.json` (install/build/output + rewrites). **No cambies**
   el Root Directory (tiene que quedar en la raíz para que resuelva el workspace pnpm).
3. Nombre del proyecto: `agile-metric-hub` (para que el dominio sea el que espera el CORS).
4. Deploy. Abrí `https://agile-metric-hub.vercel.app` → debería cargar y loguear con
   `admin` / la contraseña que pusiste en `DEFAULT_ADMIN_PASSWORD`.

> **Gotchas del build en Vercel** (por el monorepo pnpm + pnpm prerelease):
> - El `installCommand` de `vercel.json` instala el pnpm alpha y crea `lib/integrations`
>   (dir vacío no rastreado por git) — igual que los Dockerfiles.
> - Si el build falla por versión de pnpm o por el lockfile, probá en Vercel → Settings →
>   General bajar/forzar la versión, o corré `pnpm install --frozen-lockfile` local primero
>   para confirmar que el lockfile está sano (ver el gotcha del `react` espurio en
>   `SESSION_LOG.md`).

## 4. (Opcional) Cron de sync diario

El backend gratis duerme, así que el `setInterval` diario no dispara. `sync-cron.yml`
(GitHub Action) lo nudgea 1×/día. Requiere secrets del repo: `API_URL`, `ADMIN_USER`,
`ADMIN_PASSWORD`. **Nota:** al vivir en `.github/workflows/`, pushearlo requiere el scope
`workflow` del token (o crearlo por la web) — mismo caso que `ci.yml`.

---

## CI/CD

- **Render** y **Vercel** ya hacen **auto-deploy en cada push a `main`** una vez conectados
  al repo — no necesitás GitHub Actions para desplegar.
- El `ci.yml` (typecheck + test) y el `sync-cron.yml` son lo único que necesita el scope
  `workflow` para subir (ver `SESSION_LOG.md` sección 8).

## Variables de entorno — resumen

| Variable | Dónde | Valor |
|---|---|---|
| `NODE_ENV` | Render | `production` (ya en `render.yaml`) |
| `JWT_SECRET` | Render | generado por Render (auto) |
| `JWT_EXPIRE` | Render | `24h` (ya en `render.yaml`) |
| `CORS_ORIGIN` | Render | `https://agile-metric-hub.vercel.app` |
| `DATABASE_URL` | Render | connection string de Neon (`?sslmode=require`) |
| `JIRA_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` | Render | tus credenciales de Jira |
| `DEFAULT_ADMIN_PASSWORD` | Render | contraseña fuerte del admin |
| `API_URL` / `ADMIN_USER` / `ADMIN_PASSWORD` | GitHub secrets | solo para el cron opcional |

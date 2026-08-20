# Deploy — máquina interna (Docker Compose)

El proyecto se despliega en una **máquina interna de la empresa**, accesible solo desde
la red interna / VPN corporativa — sin exposición pública a internet. No se usa Render,
Neon ni Replit (ver `SESSION_LOG.md` para la historia de esas migraciones anteriores).

- **Frontend + Backend + Postgres** → el mismo `docker-compose.yml` que se usa en dev,
  corriendo directo en la máquina interna. No hay servicios cloud separados: todo el stack
  vive en un solo host.
- **Postgres** → el contenedor `db` del propio `docker-compose.yml`, con volumen persistente
  (`postgres_data`) en el disco de la máquina — no una instancia externa/gestionada.
- **Frontend ↔ Backend** → nginx (`docker/web/nginx.conf`) sirve el dashboard y hace de
  proxy de `/api/*` hacia el contenedor `api`. El navegador ve un solo origen, así que
  **no hay CORS** que configurar en este escenario.

> ⚠️ **Pendiente de definir:** el sistema operativo del host (Linux vs Windows) todavía no
> está decidido. Los pasos de abajo son agnósticos a eso — solo requieren Docker + el plugin
> Compose instalados. Si terminan en Windows, van a necesitar Docker Desktop o WSL2 (ver el
> gotcha de `pnpm` + `ca-certificates` de `CLAUDE.md`, que aplica igual dentro del contenedor
> sin importar el host).

---

## 1. Requisitos en el host

- Docker Engine + Docker Compose plugin (`docker compose version` debe funcionar).
- Puerto 80 libre (dashboard) y, si se quiere acceso directo al API sin pasar por nginx,
  el 8000 también. Nada de esto necesita quedar expuesto fuera de la red interna/VPN.
- Clonar el repo (`git clone https://github.com/andresga79/agile-metric-hub.git`) en el host.

## 2. Configurar `.env`

```
cp .env.example .env
```

Completar como mínimo:

- `JIRA_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` — credenciales reales de Jira. **Dejar los
  3 vacíos** si por algún motivo se quiere levantar con datos mock en vez de Jira real (ver
  el gotcha de placeholders en `CLAUDE.md`).
- `JWT_SECRET` — generar uno real: `openssl rand -base64 32`. El default
  (`dev-secret-please-change-in-production`) es solo para dev local.
- `DEFAULT_ADMIN_PASSWORD` — contraseña fuerte para el usuario `admin` que se bootstrapea
  en el primer arranque (>= 8 caracteres, **no** `admin123`).
- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` — se puede dejar el default si no
  hay requisito propio de la empresa para credenciales de DB.

> ⚠️ **Requisito de seguridad (ya implementado en el código):** el backend rechaza arrancar
> con `JWT_SECRET`/`DEFAULT_ADMIN_PASSWORD` débiles o ausentes, pero **solo cuando
> `NODE_ENV=production`**. El `docker-compose.yml` actual no fija `NODE_ENV`, así que para
> que esa validación de arranque proteja el deploy real hay que agregar `NODE_ENV=production`
> al `.env` (o exportarlo antes de levantar el stack).

## 3. Levantar el stack

```
docker compose up --build -d
```

Verificar:

```
curl -s http://localhost:8000/api/healthz   # {"status":"ok"}
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/   # 200
```

Ver la skill `run-app` para el procedimiento completo (incluye gotchas de bootstrap del
usuario `admin`, placeholders de Jira, y reset de datos).

## 4. Actualizar a una versión nueva

No hay auto-deploy (a diferencia de Render, que redesplegaba en cada push). Actualizar es
manual, en el host:

```
git pull
docker compose up -d --build
```

Esto recrea los contenedores que cambiaron; el volumen de Postgres persiste. Si se quiere
automatizar esto (ej. cron, webhook post-push), todavía no está definido — evaluar cuando
haya más claridad sobre el SO del host y las políticas de acceso a la red interna.

## 5. Backups

`postgres_data` es un volumen Docker local — no hay backup automático a un servicio externo
(a diferencia de Neon, que lo gestionaba). Definir una estrategia de backup (ej.
`pg_dump` programado a un share de red) es trabajo pendiente antes de considerar esto
producción-ready para datos que importe no perder.

---

## Variables de entorno — resumen

| Variable | Dónde | Valor |
|---|---|---|
| `NODE_ENV` | `.env` del host | `production` (no viene seteado por defecto en `docker-compose.yml` — agregarlo a mano) |
| `JWT_SECRET` | `.env` del host | generar con `openssl rand -base64 32` |
| `JWT_EXPIRE` | `.env` del host | `24h` (default) |
| `DATABASE_URL` | generado por `docker-compose.yml` | `postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@db:5432/<POSTGRES_DB>` |
| `JIRA_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` | `.env` del host | credenciales reales de Jira |
| `DEFAULT_ADMIN_PASSWORD` | `.env` del host | contraseña fuerte del admin |
| `CORS_ORIGIN` | `.env` del host | no necesaria — nginx proxea `/api/*` como mismo origen |

---

## Alternativa: Vercel (frontend) + Supabase (Postgres)

> ⚠️ **No es el plan actual ni está probado en vivo** — el deploy vigente es el de la
> máquina interna (arriba). Esta sección documenta cómo se armaría si en algún momento se
> quisiera volver a un esquema cloud gratuito/split, dejando explícito qué cambia respecto
> al Docker Compose de un solo host.

### Por qué no es "solo Vercel"

`artifacts/api-server` es un **proceso Express de larga duración** (background sync al
arrancar, `warmVisibleProjectsCache`/`calculateAndCachePortfolio` corriendo en el propio
proceso — ver `CLAUDE.md`, sync serializado), no un conjunto de funciones request/response
sin estado. Las Vercel Serverless Functions no sostienen ese tipo de proceso en background
entre invocaciones, así que **el backend no va en Vercel** — solo el frontend. El backend
necesita seguir viviendo en un host que corra un contenedor/proceso persistente (por
ejemplo Render, Fly.io, Railway, una VM, o la misma máquina interna). Vercel + Supabase
resuelve frontend estático + DB gestionada; el cómputo del API sigue siendo un problema
aparte.

### 1. Supabase (Postgres)

1. Crear un proyecto en [supabase.com](https://supabase.com).
2. En **Project Settings → Database → Connection string**, usar el modo **Session
   pooler** (puerto `5432` o `6543` según el plan) si el backend abre pocas conexiones
   persistentes (es el caso — un solo `Pool` en `lib/db/src/index.ts:13`), o **Transaction
   pooler** si el host del backend es serverless/efímero.
3. Setear `DATABASE_URL` con esa cadena, agregando `?sslmode=require` — Supabase exige TLS
   y `pg` (usado en `lib/db`) lo respeta a través del propio connection string, sin config
   adicional en el código:
   ```
   DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require
   ```
4. Correr las migraciones de Drizzle contra esa `DATABASE_URL` (mismo mecanismo que en
   local — ver `lib/db/drizzle.config.ts`; revisar el diff antes de aplicar, gotcha ya
   conocido de `drizzle-kit push` en `CLAUDE.md`).
5. El bootstrap del usuario `admin` sigue disparándose al primer arranque del `api` contra
   esta DB nueva, igual que con Postgres local (ver gotcha de `CLAUDE.md` — solo corre en
   una base vacía).

### 2. Backend (fuera de Vercel)

- Desplegar `artifacts/api-server` como contenedor Docker (mismo `Dockerfile` que ya usa
  Compose) en el host elegido (Render/Fly/Railway/VM propia).
- Variables de entorno iguales a las de la tabla de abajo, pero con `DATABASE_URL` apuntando
  a Supabase en vez de al contenedor `db` local.
- Como no hay nginx haciendo de proxy same-origin (ese rol lo cumple `docker/web/nginx.conf`
  solo en el escenario de máquina interna), acá el frontend y el backend quedan en dominios
  distintos → **hay que setear `CORS_ORIGIN`** con el dominio de Vercel:
  ```
  CORS_ORIGIN=https://<tu-proyecto>.vercel.app
  ```
  (lógica ya implementada en `artifacts/api-server/src/app.ts:45-48`, solo falta configurarla).

### 3. Frontend en Vercel

- El dashboard (`artifacts/dashboard`) es un build estático de Vite — encaja directo en
  Vercel. **No existe todavía un `vercel.json` en el repo**; habría que agregarlo con:
  ```json
  {
    "buildCommand": "cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @workspace/dashboard build",
    "outputDirectory": "dist/public",
    "rewrites": [
      { "source": "/api/(.*)", "destination": "https://<tu-backend>/api/$1" }
    ]
  }
  ```
- El `rewrites` es clave: el código del dashboard llama a rutas relativas (`/api/...`, ver
  `lib/api-client-react/src/generated/api.ts`) asumiendo mismo origen — así fue diseñado
  para el proxy de nginx. Con el `rewrite` de Vercel se preserva ese mismo comportamiento
  sin tocar código y **sin necesitar CORS** en el navegador (el `CORS_ORIGIN` del backend
  sigue siendo buena práctica igual, por si algo llega a pegarle directo). La alternativa —
  usar `setBaseUrl()` de `lib/api-client-react/src/custom-fetch.ts:28`, hoy sin ningún
  caller — requeriría un cambio de código para inicializarlo con una env var (`VITE_*`) al
  bootstrapear la app; no es necesaria si se usa el `rewrite`.
- Variables de entorno de build en Vercel: ninguna estrictamente necesaria si se usa el
  `rewrite` (no hay `VITE_API_URL` ni equivalente consumido hoy en `artifacts/dashboard`).

### Variables de entorno — resumen (escenario Vercel + Supabase)

| Variable | Dónde | Valor |
|---|---|---|
| `DATABASE_URL` | backend (host elegido) | connection string de Supabase con `?sslmode=require` |
| `NODE_ENV` | backend | `production` |
| `JWT_SECRET` | backend | `openssl rand -base64 32` |
| `DEFAULT_ADMIN_PASSWORD` | backend | contraseña fuerte |
| `JIRA_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` | backend | credenciales reales de Jira (o vacíos para mock) |
| `CORS_ORIGIN` | backend | `https://<tu-proyecto>.vercel.app` (defensa en profundidad; el `rewrite` ya evita CORS en el browser) |
| `vercel.json` (`rewrites`) | frontend/Vercel | proxy de `/api/*` hacia la URL pública del backend |

### Limitaciones de este esquema (no resueltas, quedan como trabajo futuro)

- Backups de Supabase: el plan free tiene retención limitada — revisar el plan elegido
  antes de asumir continuidad de datos.
- Igual que en el deploy de máquina interna, no hay auto-deploy del backend definido; Vercel
  sí redespliega el frontend automáticamente en cada push (a diferencia del backend, que
  queda manual según dónde se hostee).
- No validado en vivo — antes de usarlo en serio, seguir el mismo proceso de verificación
  de la skill `run-app` (`/api/healthz`, sync sin `failedProjects`, login) contra este
  esquema split.

---

## Historia

Este proyecto pasó por Replit (dev inicial) y luego Render Static + Render API Docker +
Neon (deploy gratuito, ver `SESSION_LOG.md` para el detalle de esas migraciones). Ambas
quedaron discontinuadas — ya no se usa ninguna de las dos; el plan actual es la máquina
interna descrita arriba.

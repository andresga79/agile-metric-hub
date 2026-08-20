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

## Historia

Este proyecto pasó por Replit (dev inicial) y luego Render Static + Render API Docker +
Neon (deploy gratuito, ver `SESSION_LOG.md` para el detalle de esas migraciones). Ambas
quedaron discontinuadas — ya no se usa ninguna de las dos; el plan actual es la máquina
interna descrita arriba.

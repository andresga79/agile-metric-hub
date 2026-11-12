# Consolidación de Agile Metric Hub (app actual) — diseño

Fecha: 2026-11-12 · Estado: borrador para aprobación (revisado por builder-check)

## 1. Intención y por qué

La app creció pantalla por pantalla: hoy hay 12 pestañas por proyecto más "Más", un Resumen
Ejecutivo y un dashboard paralelo en `/v2`. Varias vistas repiten los mismos números con reglas
distintas (dos listas de antigüedad del WIP que se contradicen, Evolución que repite Métricas,
dos pantallas de QA, el v2 que cuenta otra población) y falta lo que un equipo **Scrumban** usa
para decidir.

Objetivo: que un **scrum master** sepa en un minuto cómo está su equipo y qué llevar a la planning,
y que **gerencia** vea qué equipos necesitan atención — con **una sola regla de cálculo por número**
en todo el sitio.

## 2. Decisiones ya tomadas (por el usuario)

- **Seguimos con la app actual** (`artifacts/dashboard`, servida en `http://localhost`). El
  dashboard v2 (`/v2`, `artifacts/dashboard/src/v2`, `api-server/src/lib/v2`, `routes/v2`) **se
  retira**. Del diseño del v2 se conserva la idea (3 preguntas, vista por rol), no el código.
- Los equipos trabajan **Scrumban**: el sprint es cadencia de planning/review; el trabajo que entra a
  mitad de sprint es normal. Los límites de WIP existen pero hoy se manejan **de palabra**.
- Lectores: **scrum masters** (vista de equipo) y **gerencia** (portafolio).
- Reglas de métricas vigentes (ver `METRICS.md`, ya implementadas):
  - Lead/cycle time: **P50 es el número principal** y el que se compara con la meta; **P85** para
    comprometer plazos; el promedio solo como dato secundario.
  - Por sprint, lead/cycle time **por fecha de entrega** (`sprintDeliveryTimes`).
  - Sprints: completado = Done hoy (Rovo) + "% real cerrado" (al cierre).
  - Capacidad: ritmo con lo cerrado **al cierre**; **issues** como base, SP como referencia; roles
    (LT 50 %); "salió del equipo".
  - WIP: "en curso" = issue abierto cuyo trabajo empezó (misma regla de inicio que el cycle time).

## 3. Objetivos, no-objetivos, anti-objetivos

**Objetivos**
- Pasar de 12+ pestañas a **6 vistas**, cada una con una pregunta (ver §4).
- Una sola fuente por número: si dos pantallas muestran "cycle time del sprint 117", es el mismo valor.
- Que la frescura de los datos esté siempre a la vista.
- Agregar lo que falta para Scrumban: P85 por tipo, tiempo bloqueado, bugs que escapan, límites de WIP.

**No-objetivos**
- Rediseño visual completo con el Nxtara Design System (puede venir después; no bloquea).
- Cambiar reglas de cálculo ya acordadas (§2).
- Leer límites de WIP desde Jira.

**Anti-objetivos (sería un fracaso aunque funcione)**
- Perder un número que alguien usa sin ofrecerle dónde verlo ahora.
- Que una pantalla nueva muestre un valor distinto al de otra para la misma pregunta.
- Métricas por persona que se lean como ranking (tiempos o SP por persona).
- Borrar datos históricos de la base (se puede dejar de escribirlos, no se dropean tablas).

## 4. Estructura objetivo

| Vista | Para quién | Pregunta | Reúne lo que hoy es |
|---|---|---|---|
| **Resumen** | Scrum master | ¿Cómo estamos hoy y qué llevo a la planning? | Resumen + señales de WIP |
| **Flujo** | SM / equipo | ¿Qué está en curso, qué se atrasa y dónde se traba? | Flujo + sección WIP + bloqueos |
| **Tiempos** | SM | ¿Cuánto tardamos y es predecible? | Métricas + lo útil de Analíticas + meta de Evolución |
| **Entrega y Planning** | SM | ¿Cuánto cerramos y cuánto tomar? | Sprints / Kanban semanal + Capacidad + Forecast |
| **Calidad** | SM / gerencia | ¿Cuánto retrabajo y cuántos bugs escapan? | QA rechazados + QA trabajo + SLA |
| **Portafolio** | Gerencia | ¿Qué equipos necesitan atención? | Resumen Ejecutivo |

Reporte mensual: queda como exportación (un solo reporte, sin "Reporte por persona" en el menú).
Admin: igual, sin los umbrales de pantallas eliminadas.

Se entrega en **4 fases**. Esta especificación detalla la **fase 1**; las fases 2–4 tienen alcance
acordado aquí y cada una tendrá su propia especificación antes de construirse.

## 5. Fase 1 — Limpieza (detalle)

Sin cambios de reglas de cálculo. Cada punto debe dejar la app funcionando y verificable por sí solo.

### 5.1 Una sola lista de antigüedad del WIP (Flujo)
- Se elimina de la pestaña Flujo la lista vieja de antigüedad ("aging", basada en el umbral
  `wipAging` de Admin, 3 / 14 días). Queda la sección **Trabajo en curso (WIP)** (P50/P85) como única
  referencia.
- Se elimina el umbral `wipAging` de Admin → Health (UI). Los valores guardados en la base pueden
  quedar; no se usan.
- Dependencias que hoy leen `wipAging` / `wipAgingTotal` de `/analytics` y deben pasar a la fuente
  nueva (`GET /projects/:id/wip`) o al mismo criterio:
  - Tarjeta de bloqueados del **Resumen** (`project-detail.tsx`, usa `wipAgingTotal` como
    denominador del "% del WIP bloqueado"). *Decisión del autor:* el porcentaje pasa a ser
    "bloqueados ahora ∩ items de `/wip`" ÷ total de `/wip` (siempre ≤ 100 %). Se acepta que el valor
    cambie respecto de hoy: el total viejo contaba solo estados "in progress" de la consulta de 90 días;
    el nuevo incluye lo que espera a mitad de flujo (p. ej. Ready for QA), que también es WIP.
  - **Reporte por persona** (`use-member-report-data.ts` / `project-member-report.tsx`: días en curso
    de cada item "En desarrollo"). *Decisión del autor:* adopta la edad de `/wip` (desde el inicio de
    trabajo, misma regla que el cycle time). Los días suben en items que volvieron a en curso desde un
    estado intermedio; es la regla de WIP ya acordada (§2), no una regla nueva.
  - `use-health-suggestions.ts` desaparece con Health (5.2).
- El cálculo viejo (`computeWipAging` / `getAlertLevel` en `lib/flow-insights.ts` y el campo en
  `/analytics`) se borra cuando nada lo consuma.

### 5.2 Borrar Health
- Se elimina la página Health (`/projects/:id/health`, `project-health.tsx`, `use-health-suggestions.ts`).
- El **Flow Health Score** sigue existiendo en esta fase porque lo consumen el **Reporte** (KPI
  "Health Score") y el **Resumen Ejecutivo** ("Health Score Prom."). Se elimina en la fase 3 al rehacer
  el Portafolio. Los endpoints que lo calculan se mantienen solo para esos consumidores.
- El permiso `health` sigue siendo el que abre **Métricas** (no se renombra en esta fase).

### 5.3 Quitar Evolución
- Se elimina la pestaña Evolución (página, ruta frontend, link de pestañas) y el endpoint
  `/projects/:id/evolution`.
- Lo único que aportaba y no está en otro lado:
  - **Línea de meta** en lead/cycle time → se agrega a los gráficos por sprint/semana de **Métricas**
    (P50), con el mismo valor que hoy usa Evolución (`pickTarget`: meta del proyecto 3m, si no la del
    umbral "good" de Admin).
  - **% de rechazo QA por sprint/semana** → pasa a Calidad en la fase 2. Mientras tanto queda en la
    pantalla QA rechazados (verificar que ya muestre tendencia; si no, aceptar el hueco hasta la fase 2).
- Snapshots semanales (`metric_snapshots`): se deja de **escribirlos** en el sync (ahorra trabajo
  contra Jira). La tabla y sus datos **no se borran**. El endpoint admin de backfill se elimina o
  queda sin uso — decisión del builder, documentada.

### 5.4 Frescura de datos visible
- Cada página de proyecto muestra, junto al título, **"Datos de Jira: hace X (dd/mm hh:mm)"** para ese
  proyecto.
- Si los datos tienen más de **24 h**, el texto se muestra en ámbar con un aviso breve.
- El Resumen Ejecutivo muestra la fecha por proyecto (hoy hay proyectos con caché de semanas, p. ej.
  EN/DCX del 14-oct).
- *Decisión del autor (fuentes):*
  - **Páginas de proyecto:** el `fetched_at` de la entrada de `jira_cache` de issues que usó la página
    (la más vieja si usa varias). Como ese caché vence a las 6 h y se vuelve a pedir a demanda, casi
    siempre marcará < 6 h; el ámbar (> 24 h) aparece solo si Jira falla y se sirve un dato viejo. Es lo
    correcto: el dato que se ve es así de reciente.
  - **Resumen Ejecutivo / Portafolio:** `portfolio_cache.updated_at` (o `calculated_at`) por proyecto.
    Ahí es donde se vio el atraso real (EN/DCX del 14-oct) y donde el ámbar > 24 h es verificable.
  - Si para mostrar el `fetched_at` hace falta exponerlo en las respuestas de la API, se agrega como
    campo nuevo (sin quitar otros).

### 5.5 Retirar el v2
- Antes de borrar, portar a la app actual lo que el v2 tiene y la app no:
  - **Botón de sincronizar** para admin (el v2 lo tiene en el header; la app actual solo muestra el
    estado). Usa `POST /api/sync/run` existente.
- Luego borrar: rutas `/v2*` del frontend, `artifacts/dashboard/src/v2/`, `routes/v2.ts`,
  `lib/v2/`, sus tests (`lib/__tests__/v2-*.test.ts`), los schemas `V2*` de `openapi.yaml` y su código
  generado.
- Verificar que nada fuera del v2 importe de esas carpetas (hoy solo `routes/index.ts`, `App.tsx`,
  `main.tsx`).
- Actualizar la memoria del proyecto y `CLAUDE.md`/`METRICS.md` donde mencionen el v2.

### Criterios de aceptación de la fase 1
- Typecheck, tests y lint (0 errores, warnings ≤ 138) pasan; Docker reconstruye.
- Ningún import, ruta ni texto de UI apunta a Health, Evolución, la lista vieja de aging ni `/v2`.
- El Resumen muestra el mismo "% del WIP bloqueado" con el total de `/wip`.
- Los gráficos de Métricas muestran la línea de meta.
- Cada página de proyecto muestra la fecha de sus datos; en el Resumen Ejecutivo, un proyecto con
  `portfolio_cache` de más de 24 h se ve en ámbar (verificable con EN/DCX si siguen atrasados).
- Admin puede sincronizar desde la app actual.
- Verificación con datos reales de Tablero (10003) vía curl con token y en el navegador, según la
  metodología de `CLAUDE.md`.

## 6. Fases 2–4 (alcance acordado, se especifican después)

**Fase 2 — Fusiones**
- **Calidad** = QA rechazados + QA trabajo + SLA por prioridad (de Analíticas) + % rechazo QA en el tiempo.
- **Entrega y Planning** = Sprints (o Kanban semanal) + Capacidad + Forecast en una vista: cuánto
  cerramos (issues primero), cuánto tomar (Capacidad) y "¿cuántos issues en las próximas 2 semanas?" /
  "¿cuándo termina este épico?" (Monte Carlo con throughput).
- **Analíticas** se reparte: gráfico de puntos de cycle time y distribución en tramos → Tiempos;
  SLA → Calidad; eficiencia de flujo, throughput por prioridad y distribución por tipo se eliminan.
- **Equipo**: queda solo lo accionable por persona (en curso, bloqueados, atrasados); se quitan
  tiempos y SP por persona. "Reporte por persona" sale del menú.
- **Sprints**: "% real cerrado" como principal, Rovo como referencia; "no planificado / arrastrado"
  como contexto ("entró X, salió Y"), no semáforo; throughput en issues como dato principal.

**Fase 3 — Resumen y Portafolio**
- **Resumen** como vista del scrum master: 4 respuestas (¿cumplimos?, ¿cuánto tardamos?, ¿dónde se
  traba?, ¿qué llevar a la planning?) + señales de WIP; sin tarjeta de Velocity en SP.
- **Portafolio** (reemplaza Resumen Ejecutivo): por equipo, cumplimiento real, P50/P85 y su tendencia,
  throughput, predictibilidad, WIP vs sostenible, fecha de datos. Se elimina el Flow Health Score y
  sus semáforos.
- Pestañas finales = las 6 vistas de §4.

**Fase 4 — Lo que falta**
- **P85 por tipo** (historias / técnico / bugs) en Tiempos.
- **Tiempo bloqueado** por issue y motivos más frecuentes en Flujo.
- **Bugs que escapan**: bugs creados en producción vs encontrados en QA, en Calidad. Requiere definir
  con el usuario cómo se distingue el origen en Jira.
- **Límites de WIP** por proyecto y estado en Admin, con alerta en Flujo al superarlos.

## 7. Restricciones

- Metodología de `CLAUDE.md`: verificar con datos reales (curl con token + navegador), proponer y
  esperar aprobación, typecheck/tests/lint, rebuild, re-verificar, commit con el porqué, **push solo a
  pedido**.
- No subir la concurrencia del sync ni el límite de 90 días de Jira (ver `CLAUDE.md`).
- Cambios de esquema de base: `ALTER/CREATE ... IF NOT EXISTS` en `api-server/src/index.ts` (patrón
  actual), sin `drizzle-kit push` destructivo.
- Al renombrar campos de la API, agregar los nuevos sin quitar los viejos en el mismo deploy (una
  pestaña abierta con el JS viejo queda en blanco si el campo desaparece).
- Trabajar en rama o worktree, no directo en `main`.

## 8. Lo que queda al builder

- Cómo exponer el `fetched_at` del caché a cada página (campo en las respuestas existentes o endpoint
  liviano por proyecto).
- Orden interno de los puntos 5.1–5.5 y cómo partirlos en commits.
- Si el endpoint de backfill de snapshots se borra o queda deshabilitado.
- Textos y ubicación exacta de la fecha de datos y del botón de sincronizar.

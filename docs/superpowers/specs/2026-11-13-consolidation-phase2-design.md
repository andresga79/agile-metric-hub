# Consolidación — Fase 2 (fusiones) — diseño

Fecha: 2026-11-13 · Estado: borrador para aprobación (revisado por builder-check; preguntas respondidas)
Parte de: `docs/superpowers/specs/2026-11-12-app-consolidation-design.md` (§6, Fase 2). La fase 1
(limpieza) está en `main` desde 2026-11-12.

## 1. Intención

Reducir pestañas juntando pantallas que responden la misma pregunta, sin perder ningún número que
alguien use, y sacar del menú lo que no ayuda a decidir. Todo con las reglas de métricas ya vigentes
(P50 principal, P85 para comprometer, issues como base, "% real cerrado"; ver `METRICS.md`).

Pestañas por proyecto hoy (después de la fase 1): Resumen · Métricas · Flujo · Equipo · Sprints (o
Kanban semanal) · Capacidad · *Más:* Forecast, QA rechazados, QA, Analíticas, Reporte.

Pestañas después de la fase 2: **Resumen · Métricas · Flujo · Equipo · Entrega y Planning ·
Calidad** · *Más:* Reporte. (Las 6 definitivas y sus nombres finales se cierran en la fase 3.)

## 2. Decisiones ya tomadas (usuario, en la spec de consolidación)

- **Calidad** = QA rechazados + QA trabajo + SLA por prioridad + % de rechazo QA en el tiempo.
- **Entrega y Planning** = Sprints (o Kanban semanal) + Capacidad + Forecast.
- **Analíticas** se reparte: gráfico de puntos de cycle time (run chart) y distribución en tramos →
  Métricas; SLA → Calidad; eficiencia de flujo, throughput por prioridad y distribución por tipo se
  eliminan.
- **Equipo**: solo lo accionable por persona (en curso, bloqueados, atrasados); se quitan tiempos y SP
  por persona. "Reporte por persona" sale del menú.
- **Sprints**: "% real cerrado" principal, Rovo como referencia; "no planificado / arrastrado" como
  contexto, no semáforo; throughput en issues como dato principal.
- Anti-objetivos vigentes: no perder un número sin indicar dónde verlo; nada por persona que se lea
  como ranking; misma pregunta = mismo valor en todas las pantallas.

## 3. Diseño

### 3.1 Entrega y Planning (una pestaña con sub-vistas)
- Una pestaña **"Entrega y Planning"** con 3 sub-vistas seleccionables arriba de la página, cada una
  con su URL para que los links y el "volver" funcionen:
  - **Entrega**: la actual pestaña Sprints (Scrum) o Kanban semanal (Kanban). URL actual se mantiene
    (`/projects/:id/sprints` | `/kanban`).
  - **Capacidad**: la actual pestaña Capacidad (solo Scrum, como hoy). URL `/projects/:id/capacity`.
  - **Pronóstico**: la actual Forecast (Monte Carlo "¿cuándo llegamos a X?" + predictivo "con N
    issues restantes"). URL `/projects/:id/forecast`. Ya arranca en issues; no cambia.
- El contenido de cada sub-vista no se rediseña en esta fase, salvo §3.4 (Sprints).
- *Decisión del autor:* sub-vistas en vez de una sola página larga — cada una ya es una pantalla
  completa y así no hay que reescribirlas; la pestaña única es lo que reduce el menú.
- Permisos: cada sub-vista se muestra solo si el rol tiene su sección (`sprints`/`kanban`,
  `capacity`, `forecast`); la pestaña aparece si tiene al menos una. No se crean secciones nuevas.

### 3.2 Calidad (una pestaña con sub-vistas)
- Pestaña **"Calidad"** con sub-vistas:
  - **Rechazos QA**: la actual QA rechazados (KPIs, impacto por sprint, detalle, bugs vinculados).
    URL `/projects/:id/qa-rejected`.
  - **Trabajo QA**: la actual QA (abiertos, resueltos, estancados). URL `/projects/:id/qa-work`.
  - **SLA**: la tarjeta de cumplimiento de SLA por prioridad que hoy está en Analíticas (misma fuente
    `GET /projects/:id/sla/:period`). URL nueva `/projects/:id/sla`.
- **% de rechazo QA en el tiempo**: existe por sprint en "Impacto por sprint" (`qa-rejected.ts`,
  `bySprint`); en Kanban todo cae en "Unknown", así que **se agrega la serie por semana ISO para
  Kanban**. *Decisión del autor:* misma fórmula que el KPI y la serie por sprint actuales (issues
  distintos rechazados ÷ issues distintos que entraron a QA), no la de eventos que usaba Evolución,
  para que Scrum, Kanban y el KPI respondan igual.
- Permisos: sub-vistas según `qa-rejected` / `qa-work`; SLA usa el permiso `qa-rejected`
  (*decisión del autor*: el SLA viajaba con Analíticas, que sale del menú). Requiere cambiar también el
  backend: `GET /sla/:period` hoy exige `requireSectionView("analytics")` (`routes/sla.ts`) → pasa a
  `requireSectionView("qa-rejected", "analytics")`.

### 3.3 Métricas recibe lo útil de Analíticas; Analíticas sale del menú
- En Métricas se agregan, debajo de los gráficos por sprint/semana:
  - **Throughput por semana con detalle** (el "Run Chart" de Analíticas, movido tal cual: línea de
    issues entregados por semana; clic en un punto abre los issues de esa semana). *Usuario (Q1):*
    se mueve; no se agrega un gráfico de puntos de cycle time.
  - **Distribución en tramos** de lead y cycle time con los **6 tramos** que usa hoy Analíticas
    (0–1, 1–3, 3–7, 7–14, 14–30, 30+ días; *decisión del autor*: el tramo 30+ es justamente donde
    aparece el trabajo viejo). `/metrics` hoy trae `cycleTimeDistribution` en 5 tramos y sin lead:
    se agregan campos nuevos con los 6 tramos para ambos, misma población que Métricas.
- Se eliminan de la UI: eficiencia de flujo, throughput por prioridad, distribución por tipo y la
  comparación con el período anterior de Analíticas (en todas sus tarjetas). La página Analíticas y
  su ruta se borran.
- Al moverse, el throughput por semana deja de tener comparación con el período anterior (igual que el
  resto de lo movido).
- El endpoint `/analytics/:period` **se mantiene**: lo usan Flujo, el Resumen y el Reporte. Los campos
  que solo alimentaban lo eliminado (`flowEfficiency`, `throughputByPriority`, `issueTypeDistribution`)
  se quitan (verificado: ni Flujo, ni Resumen, ni Reporte, ni Reporte por persona los leen).
- Población y fórmulas de lo movido: las de `/metrics/:period` (la misma de Métricas), no las de
  `/analytics`, para que todo en Métricas cuente los mismos issues. El throughput semanal y su detalle
  pasan a salir de `/metrics` (campo nuevo con, por semana, los issues entregados: clave, resumen,
  tipo, fecha de entrega, cycle y lead time).

### 3.4 Sprints (sub-vista Entrega, Scrum)
- **Principal: "% real cerrado"** (cerrado al cierre). *Usuario (Q2):* la base del % **sigue siendo SP**
  cuando el sprint tiene SP (como hoy, Rovo, Resumen de sprint y Reporte); al lado, primero, la cantidad
  de issues cerrados al cierre. La columna "% Finalizado (acum.)" (Rovo) queda
  a su derecha con el rótulo "Rovo (Done hoy)" y estilo secundario.
- **Throughput en issues** primero en tablas y tarjetas; SP como dato secundario (como Capacidad). El %
  no cambia de base (ver arriba).
- **No planificado y arrastrado como contexto**: se muestran como número neutro ("entraron 22 · 51 %
  del SP") en color de texto normal (hoy arrastrado va en naranja y no planificado en celeste). Los
  semáforos de "% real cerrado" / "% Finalizado" se mantienen (son cumplimiento). En Kanban,
  "reabiertos" sigue en rojo (es retrabajo, una señal de calidad).
- El "Resumen de sprint" (informe tipo Rovo) que ya vive en Sprints no cambia.

### 3.5 Equipo
- Tabla por persona con **solo**: en curso (WIP), bloqueados, **atrasados** (items en curso de esa
  persona con edad > P85 de cycle time del período, misma regla y fuente que Flujo → WIP) y "trabajando
  en". Se quitan: issues resueltos, SP, cycle time y lead time por persona.
- Orden: más bloqueados, luego más atrasados, luego más en curso (lo que necesita atención primero).
- Fuente de **en curso y atrasados**: `GET /projects/:id/wip` (items con `assignee` y `ageDays`) +
  P85 de `/metrics/:period`, igual que la sección WIP de Flujo (*decisión del autor*: si "en curso"
  siguiera saliendo de `/members` —solo estados in-progress— alguien podría tener más atrasados que en
  curso y no cuadraría con Flujo). `/wip` pasa a `requireSectionView("flow", "team")` para que un rol
  con Equipo y sin Flujo no reciba 403. Bloqueados también desde `/wip` (`blocked`).
- **Reporte por persona**: se quita su único link (`project-team.tsx`). La ruta
  `/projects/:id/team/:accountId/report` **se mantiene** por URL; su borrado se decide en la fase 3.

### 3.6 Reporte mensual: sin ranking por persona
- *Usuario (Q3):* el top 5 por persona (issues resueltos, cycle time, SP; `project-report.tsx`) se
  **reemplaza** por la misma vista accionable de Equipo: por persona, en curso, bloqueados y atrasados
  (misma fuente y regla que §3.5), ordenado por lo que necesita atención.

### 3.7 Navegación y textos
- `project-tabs.tsx`: pestañas primarias = Métricas, Flujo, Equipo, Entrega y Planning, Calidad;
  "Más" = Reporte. Las URLs viejas (`/sprints`, `/kanban`, `/capacity`, `/forecast`, `/qa-rejected`,
  `/qa-work`) siguen funcionando y marcan activa la pestaña nueva que las contiene.
- `/projects/:id/analytics` deja de existir; sus únicas referencias (`project-tabs.tsx`,
  `project-section-permissions.ts`, ruta en `App.tsx`) se quitan. Una URL vieja a `/analytics`
  redirige a Métricas.
- Textos en es/en.

## 4. Fuera de alcance (fase 3 o 4)

Rediseño del Resumen y del Resumen Ejecutivo/Portafolio, Flow Health Score, renombrar "Métricas" a
"Tiempos", borrar el Reporte por persona, P85 por tipo, tiempo bloqueado, bugs que escapan, límites de
WIP.

## 5. Criterios de aceptación

- Menú por proyecto = Resumen, Métricas, Flujo, Equipo, Entrega y Planning, Calidad, Más → Reporte.
- Cada número que mostraban Analíticas, QA rechazados, QA trabajo, Forecast, Sprints, Kanban,
  Capacidad y Equipo se ve en algún lugar o fue eliminado a propósito por §2 (lista en el PR/commit).
- El P50/P85 del gráfico de puntos coincide con la tabla de Métricas para el mismo período.
- Equipo no muestra tiempos ni SP por persona; "atrasados" coincide con lo que Flujo marca en rojo
  (edad > P85) para esa persona.
- Sprints: ninguna celda de "no planificado" o "arrastrado" con color de alarma.
- Links viejos a `/analytics` llevan a Métricas; URLs de sub-vistas funcionan directas.
- Typecheck, tests y lint (0 errores, warnings ≤ 125) pasan; `CLAUDE.md` actualiza su baseline de lint
  (dice 138/140; hoy es 125); verificación con datos reales de Tablero
  (10003) y de un proyecto Kanban, según `CLAUDE.md`.

## 6. Restricciones

Las de la spec de consolidación §7 (metodología, rama, sin push por defecto, sin borrar datos,
campos nuevos de API sin quitar viejos en el mismo deploy).

## 7. Lo que queda al builder

- Componente de sub-navegación (estilo, ubicación) y cómo comparte la barra de período.
- Cómo se arma el run chart (librería ya usada: Recharts `ScatterChart`) y si los puntos se limitan a
  N (p. ej. 500) para rendimiento.

## 8. Decisiones del usuario (2026-11-13)

- Q1: se mueve el throughput semanal con detalle a Métricas; no se agrega gráfico de puntos.
- Q2: "% real cerrado" sigue en SP; issues cerrados al lado y primero.
- Q3: el top 5 por persona del Reporte se reemplaza por en curso / bloqueados / atrasados.

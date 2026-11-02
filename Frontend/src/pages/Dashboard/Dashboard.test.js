import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const directorio = dirname(fileURLToPath(import.meta.url));
const pagina = readFileSync(
  join(directorio, "Dashboard.jsx"),
  "utf8",
);
const estilos = readFileSync(
  join(directorio, "Dashboard.css"),
  "utf8",
);

test("el Dashboard administra carga, error y reintento", () => {
  assert.match(pagina, /cargandoDashboard/);
  assert.match(pagina, /role="status"/);
  assert.match(pagina, /role="alert"/);
  assert.match(pagina, />\s*Reintentar\s*</);
  assert.match(pagina, /dash-chart-empty/);
});

test("el Dashboard solo consulta el resumen agregado como administrador", () => {
  assert.match(pagina, /if \(!isAdmin \|\| seccionActual !== "Dashboard"\)/);
  assert.match(pagina, /obtenerResumenDashboard\(mes/);
  assert.match(pagina, /resolverSeccion\(/);
  assert.doesNotMatch(pagina, /construirMetricasDashboard/);
});

test("el Dashboard conserva el selector de mes y los controles táctiles", () => {
  assert.match(pagina, /type="month"/);
  assert.match(pagina, /aria-label="Mes y año del dashboard"/);
  assert.match(pagina, /aria-expanded=\{menuMovil\}/);
});

test("el resumen inferior solo aparece tras una carga exitosa", () => {
  assert.match(pagina, /puedeMostrarResumenInferior/);
  assert.match(pagina, /mostrarResumenInferior\s*&&/);
  assert.match(pagina, /setResumenPeriodo\(null\)/);
});

test("el Dashboard cancela solicitudes anteriores al cambiar de mes", () => {
  assert.match(pagina, /new AbortController\(\)/);
  assert.match(pagina, /controlador\.abort\(\)/);
  assert.match(pagina, /if \(!activo/);
});

test("las gráficas usan barras verticales sin badges de categoría", () => {
  assert.match(pagina, /BarrasVerticales/);
  assert.doesNotMatch(pagina, /dash-panel-badge/);
  assert.doesNotMatch(pagina, /POLIC[IÍ]A/i);
});

test("el Dashboard conserva la identidad floral y rosada del mockup", () => {
  assert.match(estilos, /--dash-rosa:\s*#e9a9a5/);
  assert.match(estilos, /--dash-rosa-oscuro:\s*#d8898f/);
  assert.match(estilos, /fondo-floral\.(png|webp)/);
  assert.doesNotMatch(estilos, /beige|salvia/i);
});

test("el Dashboard muestra seis tarjetas y equilibra su distribución", () => {
  assert.match(pagina, /devolucion/i);
  assert.match(estilos, /dash-stat-devoluciones/);
  assert.match(estilos, /\.dash-stats \{\s*grid-template-columns: repeat\(3/);
  assert.match(estilos, /@media \(max-width: 980px\)/);
});

test("el panel permite actualizar manualmente e invalidar la caché", () => {
  assert.match(pagina, /actualizarPanel/);
  assert.match(pagina, /dash-refresh/);
  assert.match(pagina, /invalidarCacheAdmin/);
  assert.match(pagina, /versionSeccion/);
  assert.match(estilos, /\.dash-refresh/);
});


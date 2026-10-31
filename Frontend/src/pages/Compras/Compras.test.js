import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const directorio = dirname(fileURLToPath(import.meta.url));
const pagina = readFileSync(
  join(directorio, "Compras.jsx"),
  "utf8",
);
const servicio = readFileSync(
  join(directorio, "../../services/compras.js"),
  "utf8",
);

test("Compras permite varias líneas y recepción parcial", () => {
  assert.match(pagina, /lineasCompra/);
  assert.match(pagina, /Añadir otra línea/);
  assert.match(pagina, /Cantidad recibida/);
  assert.match(pagina, /asignacionesDisponibles/);
  assert.match(pagina, /Asignar a pedidos/);
  assert.match(pagina, /calcularTotalCompra/);
});

test("Compras envía asignaciones explícitas a líneas de pedido", () => {
  assert.match(servicio, /detalle_pedido_id/);
  assert.match(servicio, /asignaciones/);
  assert.match(servicio, /cantidad_recibida/);
  assert.match(servicio, /No se puede asignar dos veces/);
  assert.match(servicio, /superan la cantidad recibida/);
  assert.match(
    pagina,
    /"confirmado",\s*"por_comprar",\s*"comprado"/,
  );
});

test("Compras conserva el historial y muestra recibidas y pendientes", () => {
  assert.match(pagina, /Compras recientes/);
  assert.match(pagina, /Recibidas:/);
  assert.match(pagina, /Pendientes:/);
  assert.match(pagina, /detalle\.asignaciones/);
});

test("Compras separa el registro de la recepción física", () => {
  assert.match(pagina, /registrarRecepcionCompra/);
  assert.match(pagina, /Registrar recepción/);
  assert.match(pagina, /Cantidad recibida ahora/);
  assert.match(pagina, /no se ha/);
  assert.match(pagina, /abrirRecepcion/);
});

test("Compras elimina explicaciones técnicas sin tocar su diseño", () => {
  assert.doesNotMatch(pagina, /compras-ayuda-costo/);
  assert.doesNotMatch(pagina, /backend generó/);
  assert.doesNotMatch(pagina, /costos reales/);
  assert.match(pagina, /Compra registrada correctamente/);
  assert.match(pagina, /compras-linea/);
  assert.match(pagina, /compras-asignaciones/);
});

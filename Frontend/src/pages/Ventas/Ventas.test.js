import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const directorio = dirname(fileURLToPath(import.meta.url));
const pagina = readFileSync(
  join(directorio, "Ventas.jsx"),
  "utf8",
);

test("Ventas elimina banners técnicos de la interfaz", () => {
  assert.doesNotMatch(pagina, /ventas-real-notice/);
  assert.doesNotMatch(pagina, /costo de compra vigente/);
  assert.doesNotMatch(pagina, /Se validan la presentación/);
  assert.doesNotMatch(pagina, /abono inicial se registra/);
});

test("Ventas conserva el formulario manual y los errores accionables", () => {
  assert.match(pagina, /Registrar venta manual/);
  assert.match(pagina, /El precio de venta debe ser mayor que cero/);
  assert.match(pagina, /Indica el valor del abono inicial/);
  assert.match(pagina, /Ventas registradas/);
});

test("Ventas distingue el abastecimiento completo y por comprar", () => {
  assert.match(pagina, /estado_abastecimiento/);
  assert.match(pagina, /unidades_pendientes_abastecimiento/);
  assert.match(pagina, /Por comprar/);
  assert.match(pagina, /Abastecimiento/);
});

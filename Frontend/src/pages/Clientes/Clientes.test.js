import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const directorio = dirname(fileURLToPath(import.meta.url));
const pagina = readFileSync(
  join(directorio, "Clientes.jsx"),
  "utf8",
);

test("Clientes usa el resumen financiero del backend", () => {
  assert.match(pagina, /listarResumenClientes/);
  assert.match(pagina, /construirClientesDesdeResumen/);
  assert.match(pagina, /total_acordado|totalAcordado/);
  assert.match(pagina, /total_pagado|totalPagado/);
  assert.match(pagina, /saldo_pendiente|saldoPendiente/);
});

test("Clientes muestra pedidos pendientes de venta sin duplicar deuda", () => {
  assert.match(pagina, /Pedidos pendientes de venta/);
  assert.match(pagina, /unidadesPendientesCompra/);
  assert.match(pagina, /pedido\.montoPagado/);
  assert.match(pagina, /pedido\.saldo/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const directorio = dirname(fileURLToPath(import.meta.url));
const pagina = readFileSync(
  join(directorio, "Pedidos.jsx"),
  "utf8",
);
const servicio = readFileSync(
  join(directorio, "../../services/pedidosAdmin.js"),
  "utf8",
);

test("Pedidos confirma comercialmente sin crear la venta", () => {
  assert.match(pagina, /estadoPago: "pendiente"/);
  assert.match(pagina, /Pendiente de compra/);
  assert.doesNotMatch(pagina, /crearVenta/);
});

test("Pedidos elimina banners técnicos y mantiene errores accionables", () => {
  assert.doesNotMatch(pagina, /pedidos-aviso-real/);
  assert.doesNotMatch(pagina, /costos reales/);
  assert.doesNotMatch(pagina, /venta financiera/);
  assert.match(pagina, /No se pudo confirmar el pedido/);
  assert.match(pagina, /El monto recibido debe ser mayor que cero/);
});

test("Pedidos confirma la entrega y muestra cantidades de inventario", () => {
  assert.match(pagina, /window\.confirm/);
  assert.match(pagina, /unidades_pendientes_compra/);
  assert.match(pagina, /cantidad_disponible/);
  assert.match(pagina, /cantidad_pendiente/);
  assert.match(pagina, /entregado_en/);
});

test("Pedidos integra ventas manuales pendientes sin acciones de pedido", () => {
  assert.match(pagina, /construirPedidosDesdeVentasPendientes/);
  assert.match(pagina, /conPendientes: true/);
  assert.match(pagina, /Venta manual/);
  assert.match(pagina, /La recepción se gestiona desde Compras/);
});

test("Pedidos muestra los estados y acciones del flujo bajo pedido", () => {
  assert.match(pagina, /FILTROS_PEDIDO/);
  assert.match(pagina, /etiquetaEstadoPedido/);
  assert.match(pagina, /pedidoPendienteDeCompra/);
  assert.match(pagina, /pedidoPuedeRegistrarAnticipo/);
  assert.match(pagina, /siguienteEstadoPedido/);
  assert.match(pagina, /puedeGenerarVentaPedido/);
  assert.match(pagina, /Cancelar/);
});

test("Pedidos registra anticipos y cancelaciones idempotentes", () => {
  assert.match(servicio, /\/pedidos\/\$\{id\}\/anticipos\//);
  assert.match(servicio, /\/pedidos\/\$\{id\}\/cancelar\//);
  assert.match(servicio, /\/pedidos\/\$\{id\}\/venta\//);
  assert.match(servicio, /\/pedidos\/\$\{id\}\/estado\//);
  assert.match(servicio, /Idempotency-Key/);
  assert.match(servicio, /registrarAnticipo/);
  assert.match(servicio, /cambiarEstadoPedido/);
});

test("Pedidos permite pagos totales o parciales antes de la venta", () => {
  assert.match(pagina, /Registrar pago/);
  assert.match(pagina, /Monto recibido/);
  assert.match(pagina, /Pagos y anticipos/);
  assert.match(pagina, /Pendiente de definir/);
  assert.match(pagina, /Saldo por definir/);
  assert.match(pagina, /puedeConfirmarConPrecios/);
});

test("Pedidos refresca la lista antes de abrir un pedido notificado", () => {
  assert.match(pagina, /pedidoInicialObjetivoRef/);
  assert.match(pagina, /procesarPedidoInicial/);
  assert.match(
    pagina,
    /setRecarga\(\(actual\) => actual \+ 1\)/,
  );
  assert.match(pagina, /onPedidoInicialAbiertoRef\.current\?\./);
  assert.match(pagina, /No se encontró el pedido/);
  assert.match(pagina, /Reintentar/);
  assert.doesNotMatch(pagina, /onPedidoInicialConsumido/);
});

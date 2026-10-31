import assert from "node:assert/strict";
import { test } from "node:test";

import {
  construirClientes,
  construirClientesDesdeResumen,
  datosVenta,
  filtrarClientes,
  resumenLineas,
} from "./clientesResumen.js";

const clientesApi = [
  {
    id: 1,
    nombre: "Laura Méndez",
    telefono: "+573001234567",
    notas: "Cliente VIP",
  },
  {
    id: 2,
    nombre: "Ana Torres",
    telefono: "3105550188",
    notas: "",
  },
  {
    id: 3,
    nombre: "Camila Rojas",
    telefono: "",
    notas: "",
  },
];

const ventasApi = [
  {
    id: 10,
    cliente: 1,
    fecha: "2026-10-20",
    total: "100000.00",
    saldo: "40000.00",
    estado_pago: "abonado",
    abonos: [{ id: 1, monto: "60000.00" }],
    detalles: [
      {
        id: 1,
        producto_nombre: "Perfume Floral",
        porcentaje: 60,
        cantidad: 2,
      },
    ],
  },
  {
    id: 11,
    cliente: 2,
    fecha: "2026-10-19",
    total: "50000.00",
    saldo: "0.00",
    estado_pago: "pagado",
    abonos: [],
    detalles: [],
  },
];

const pedidosApi = [
  {
    id: 20,
    cliente: 1,
    estado: "pendiente",
    total: "90000.00",
    precios_completos: true,
    creado_en: "2026-10-21T10:00:00Z",
  },
  {
    id: 21,
    cliente: 1,
    estado: "confirmado",
    total: "100000.00",
    precios_completos: true,
    creado_en: "2026-10-20T10:00:00Z",
  },
  {
    id: 22,
    cliente: 2,
    estado: "rechazado",
    total: "0.00",
    precios_completos: false,
    creado_en: "2026-10-18T10:00:00Z",
  },
];

test("calcula métricas y estados reales por cliente", () => {
  const clientes = construirClientes(clientesApi, ventasApi, pedidosApi);
  const laura = clientes.find((cliente) => cliente.id === 1);
  const ana = clientes.find((cliente) => cliente.id === 2);
  const camila = clientes.find((cliente) => cliente.id === 3);

  assert.equal(laura.totalVendido, 100000);
  assert.equal(laura.totalPagado, 60000);
  assert.equal(laura.saldoPendiente, 40000);
  assert.equal(laura.estado, "Abonado");
  assert.equal(laura.ventas.length, 1);
  assert.equal(laura.pedidos.length, 1);
  assert.equal(laura.pedidos[0].id, 20);

  assert.equal(ana.totalVendido, 50000);
  assert.equal(ana.saldoPendiente, 0);
  assert.equal(ana.estado, "Pagado");
  assert.equal(ana.pedidos[0].estado, "rechazado");

  assert.equal(camila.estado, "Sin ventas");
  assert.equal(camila.totalVendido, 0);
});

test("deriva el pago desde total y saldo del backend", () => {
  const pago = datosVenta({
    total: "200000.00",
    saldo: "75000.00",
    estado_pago: "abonado",
  });

  assert.equal(pago.total, 200000);
  assert.equal(pago.saldo, 75000);
  assert.equal(pago.montoPagado, 125000);
  assert.equal(pago.estadoPago, "abonado");
  assert.equal(pago.etiquetaPago, "Abonado");
});

test("busca por nombre, teléfono o notas", () => {
  const clientes = construirClientes(clientesApi, ventasApi, pedidosApi);

  assert.deepEqual(
    filtrarClientes(clientes, "laura", "Todos").map((c) => c.id),
    [1],
  );
  assert.deepEqual(
    filtrarClientes(clientes, "300 123", "Todos").map((c) => c.id),
    [1],
  );
  assert.deepEqual(
    filtrarClientes(clientes, "VIP", "Todos").map((c) => c.id),
    [1],
  );
  assert.deepEqual(
    filtrarClientes(clientes, "ana", "Todos").map((c) => c.id),
    [2],
  );
});

test("aplica filtros sobre datos reales", () => {
  const clientes = construirClientes(clientesApi, ventasApi, pedidosApi);

  assert.deepEqual(
    filtrarClientes(clientes, "", "Con saldo").map((c) => c.id),
    [1],
  );
  assert.deepEqual(
    filtrarClientes(clientes, "", "Al día").map((c) => c.id),
    [2],
  );
  assert.deepEqual(
    filtrarClientes(clientes, "", "Pedidos sin confirmar").map((c) => c.id),
    [1],
  );
});

test("usa pedidos confirmados sin venta sin duplicar la deuda", () => {
  const clientes = construirClientesDesdeResumen([
    {
      id: 1,
      nombre: "Laura Méndez",
      telefono: "+573001234567",
      notas: "",
      total_ventas: "0.00",
      total_pedidos: "300000.00",
      total_acordado: "300000.00",
      total_pagado: "100000.00",
      saldo_pendiente: "200000.00",
      estado: "Por comprar",
      ventas: [],
      pedidos: [
        {
          id: 20,
          estado: "por_comprar",
          total: "300000.00",
          monto_pagado: "100000.00",
          saldo: "200000.00",
          estado_pago: "abonado",
          unidades_pendientes_compra: 2,
          detalles: [],
        },
      ],
    },
  ]);

  const laura = clientes[0];

  assert.equal(laura.totalVendido, 0);
  assert.equal(laura.totalAcordado, 300000);
  assert.equal(laura.totalPagado, 100000);
  assert.equal(laura.saldoPendiente, 200000);
  assert.equal(laura.pedidos.length, 1);
  assert.equal(laura.pedidos[0].unidadesPendientesCompra, 2);
  assert.equal(laura.pedidos[0].etiquetaPago, "Abonado");
});

test("resume las líneas de una venta", () => {
  assert.equal(
    resumenLineas(ventasApi[0]),
    "Perfume Floral 60 % × 2",
  );
  assert.equal(resumenLineas({ detalles: [] }), "Sin detalle de líneas");
  assert.equal(
    resumenLineas({
      detalles: [
        {
          producto_nombre: "Perfume Floral",
          porcentaje: 60,
          cantidad: 2,
          cantidad_pendiente: 1,
        },
      ],
    }),
    "Perfume Floral 60 % × 2 (1 por abastecer)",
  );
});

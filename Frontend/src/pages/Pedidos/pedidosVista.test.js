import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buscarPedidoInicial,
  calcularTotalEstimado,
  construirLineasPrecioConfirmacion,
  construirPedidosDesdeVentasPendientes,
  contarPedidosPorEstado,
  etiquetaEstadoPedido,
  etiquetaPagoPedido,
  filtrarPedidos,
  pedidoPendienteDeCompra,
  pedidoPuedeCancelar,
  pedidoPuedeConfirmar,
  pedidoPuedeRegistrarAnticipo,
  puedeConfirmarConPrecios,
  puedeGenerarVentaPedido,
  resumenPagoPedido,
  siguienteEstadoPedido,
} from "./pedidosVista.js";

const pedidoPendiente = {
  id: 1,
  estado: "pendiente",
  total: "100000.00",
  precios_completos: true,
  puede_confirmar: true,
  detalles: [
    {
      id: 1,
      cantidad: 1,
      precio_unitario: "100000.00",
      precio_pendiente: false,
    },
  ],
};

const pedidoConfirmado = {
  id: 2,
  estado: "confirmado",
  venta: null,
  total: "100000.00",
  monto_pagado: "30000.00",
  saldo: "70000.00",
  estado_pago: "abonado",
  puede_generar_venta: false,
  detalles: [
    {
      id: 2,
      cantidad: 1,
      cantidad_recibida: 0,
      precio_unitario: "100000.00",
      precio_pendiente: false,
    },
  ],
};

test("muestra las etiquetas de todos los estados comerciales", () => {
  assert.equal(etiquetaEstadoPedido("pendiente"), "Pendiente");
  assert.equal(etiquetaEstadoPedido("confirmado"), "Confirmado");
  assert.equal(etiquetaEstadoPedido("por_comprar"), "Por comprar");
  assert.equal(etiquetaEstadoPedido("comprado"), "Comprado");
  assert.equal(etiquetaEstadoPedido("preparando"), "Preparando");
  assert.equal(etiquetaEstadoPedido("listo"), "Listo");
  assert.equal(etiquetaEstadoPedido("entregado"), "Entregado");
  assert.equal(etiquetaEstadoPedido("cancelado"), "Cancelado");
  assert.equal(etiquetaEstadoPedido("rechazado"), "Rechazado");
  assert.equal(etiquetaPagoPedido("abonado"), "Abonado");
});

test("confirma sin compra previa y sin crear una venta", () => {
  assert.equal(pedidoPuedeConfirmar(pedidoPendiente), true);
  assert.equal(
    pedidoPuedeConfirmar({
      ...pedidoPendiente,
      detalles: [
        {
          ...pedidoPendiente.detalles[0],
          precio_pendiente: true,
        },
      ],
      precios_completos: false,
    }),
    false,
  );
  assert.equal(pedidoPendienteDeCompra(pedidoConfirmado), true);
  assert.equal(
    pedidoPendienteDeCompra({
      ...pedidoConfirmado,
      estado: "por_comprar",
    }),
    true,
  );
  assert.equal(
    pedidoPendienteDeCompra({
      ...pedidoConfirmado,
      venta: 9,
    }),
    false,
  );
});

test("habilita anticipos solo antes de la venta y con saldo", () => {
  assert.equal(
    pedidoPuedeRegistrarAnticipo(pedidoConfirmado),
    true,
  );
  assert.equal(
    pedidoPuedeRegistrarAnticipo({
      ...pedidoConfirmado,
      saldo: "0.00",
    }),
    false,
  );
  assert.equal(
    pedidoPuedeRegistrarAnticipo({
      ...pedidoConfirmado,
      venta: 10,
    }),
    false,
  );
  assert.equal(
    pedidoPuedeRegistrarAnticipo(pedidoPendiente),
    false,
  );
});

test("calcula el total de líneas pendientes y prepara precios", () => {
  const detalles = [
    {
      id: 5,
      cantidad: 1,
      precio_unitario: "0.00",
      precio_pendiente: true,
    },
    {
      id: 6,
      cantidad: 2,
      precio_unitario: "50000.00",
      precio_pendiente: false,
    },
  ];

  assert.equal(
    calcularTotalEstimado(detalles, { 5: "80000" }),
    180000,
  );
  assert.deepEqual(
    construirLineasPrecioConfirmacion(detalles, {
      5: "80000",
      6: "99999",
    }),
    [{ detalleId: 5, precioVenta: "80000" }],
  );
});

test("habilita la confirmación cuando se capturan los precios pendientes", () => {
  const pedido = {
    id: 8,
    estado: "pendiente",
    total: "0.00",
  };
  const detalles = [
    {
      id: 21,
      cantidad: 2,
      precio_unitario: "0.00",
      precio_pendiente: true,
    },
    {
      id: 22,
      cantidad: 3,
      precio_unitario: "0.00",
      precio_pendiente: true,
    },
  ];

  assert.equal(
    puedeConfirmarConPrecios(pedido, detalles, {}),
    false,
  );
  assert.equal(
    puedeConfirmarConPrecios(pedido, detalles, {
      21: "125000",
      22: "90000",
    }),
    true,
  );
  assert.equal(
    puedeConfirmarConPrecios(pedido, detalles, {
      21: "125000",
      22: "0",
    }),
    false,
  );
});

test("controla transiciones y cancelación de pedidos", () => {
  assert.deepEqual(
    siguienteEstadoPedido({ estado: "comprado" }),
    { estado: "preparando", etiqueta: "Marcar preparando" },
  );
  assert.equal(
    siguienteEstadoPedido({ estado: "pendiente" }),
    null,
  );
  assert.equal(
    pedidoPuedeCancelar({ estado: "entregado" }),
    false,
  );
  assert.equal(
    pedidoPuedeCancelar({ estado: "confirmado" }),
    true,
  );
  assert.equal(
    puedeGenerarVentaPedido({ puede_generar_venta: true }),
    true,
  );
});

test("cuenta y filtra pedidos por estado y búsqueda", () => {
  const pedidos = [
    pedidoPendiente,
    pedidoConfirmado,
    { ...pedidoConfirmado, id: 3, estado: "comprado" },
  ];

  assert.deepEqual(
    {
      todos: contarPedidosPorEstado(pedidos).todos,
      pendiente: contarPedidosPorEstado(pedidos).pendiente,
      confirmado: contarPedidosPorEstado(pedidos).confirmado,
      comprado: contarPedidosPorEstado(pedidos).comprado,
    },
    { todos: 3, pendiente: 1, confirmado: 1, comprado: 1 },
  );

  assert.equal(
    filtrarPedidos(pedidos, "confirmado").length,
    1,
  );
  assert.equal(
    filtrarPedidos(pedidos, "todos", "cliente").length,
    0,
  );
});

test("resume pagos sin sumar dos veces los anticipos", () => {
  const resumen = resumenPagoPedido(pedidoConfirmado);

  assert.equal(resumen.montoPagado, 30000);
  assert.equal(resumen.saldo, 70000);
  assert.equal(resumen.etiquetaPago, "Abonado");
});

test("muestra pagos de pedidos aunque todavía no exista venta", () => {
  const sinPago = {
    estado: "confirmado",
    venta: null,
    total: "180000.00",
    monto_pagado: "0.00",
    saldo: "180000.00",
    estado_pago: "pendiente",
  };
  const parcial = {
    ...sinPago,
    monto_pagado: "50000.00",
    saldo: "130000.00",
    estado_pago: "abonado",
  };
  const pagado = {
    ...sinPago,
    monto_pagado: "180000.00",
    saldo: "0.00",
    estado_pago: "pagado",
  };

  assert.deepEqual(resumenPagoPedido(sinPago), {
    montoPagado: 0,
    saldo: 180000,
    estadoPago: "pendiente",
    etiquetaPago: "Pendiente",
  });
  assert.equal(resumenPagoPedido(parcial).montoPagado, 50000);
  assert.equal(resumenPagoPedido(parcial).saldo, 130000);
  assert.equal(resumenPagoPedido(parcial).etiquetaPago, "Abonado");
  assert.equal(resumenPagoPedido(pagado).saldo, 0);
  assert.equal(resumenPagoPedido(pagado).etiquetaPago, "Pagado");
  assert.equal(pedidoPuedeRegistrarAnticipo(sinPago), true);
  assert.equal(pedidoPuedeRegistrarAnticipo(parcial), true);
  assert.equal(pedidoPuedeRegistrarAnticipo(pagado), false);
});

test("integra ventas manuales pendientes en Por comprar", () => {
  const ventas = [
    {
      id: 30,
      origen: "manual",
      cliente: 1,
      cliente_nombre: "Laura Méndez",
      cliente_telefono: "+573001234567",
      fecha: "2026-10-30",
      creado_en: "2026-10-30T10:00:00Z",
      estado_pago: "abonado",
      estado_abastecimiento: "parcial",
      unidades_pendientes_abastecimiento: 1,
      total: "150000.00",
      saldo: "100000.00",
      monto_pagado: "50000.00",
      abonos: [],
      detalles: [
        {
          id: 40,
          producto_nombre: "Perfume Floral",
          porcentaje: 60,
          cantidad: 2,
          cantidad_cubierta: 1,
          cantidad_pendiente: 1,
          precio_venta: "75000.00",
          subtotal: "150000.00",
        },
      ],
    },
    {
      id: 31,
      origen: "manual",
      unidades_pendientes_abastecimiento: 0,
      detalles: [],
    },
    {
      id: 32,
      origen: "pedido",
      unidades_pendientes_abastecimiento: 1,
      detalles: [],
    },
  ];

  const pedidos = construirPedidosDesdeVentasPendientes(ventas);

  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].esVentaManual, true);
  assert.equal(pedidos[0].estado, "por_comprar");
  assert.equal(pedidos[0].cliente_nombre, "Laura Méndez");
  assert.equal(pedidos[0].unidades_pendientes_compra, 1);
  assert.equal(pedidos[0].detalles[0].porcentaje_recarga, 60);
  assert.equal(pedidos[0].detalles[0].cantidad_pendiente, 1);
  assert.equal(pedidoPendienteDeCompra(pedidos[0]), true);
  assert.equal(
    filtrarPedidos(pedidos, "por_comprar").length,
    1,
  );
  assert.equal(
    filtrarPedidos(
      construirPedidosDesdeVentasPendientes([
        {
          ...ventas[0],
          unidades_pendientes_abastecimiento: 0,
        },
      ]),
      "por_comprar",
    ).length,
    0,
  );
});

test("no inventa saldo cuando el precio está pendiente", () => {
  const pendiente = {
    estado: "pendiente",
    venta: null,
    total: "0.00",
    monto_pagado: "0.00",
    saldo: "0.00",
    estado_pago: "pendiente",
    precios_completos: false,
  };

  assert.equal(pedidoPuedeRegistrarAnticipo(pendiente), false);
  assert.equal(pedidoPendienteDeCompra(pendiente), false);
});

test("encuentra un pedido nuevo en la lista actualizada", () => {
  const listaAnterior = [{ id: 1, estado: "pendiente" }];
  const listaActualizada = [
    { id: 1, estado: "pendiente" },
    { id: 99, estado: "pendiente", cliente_nombre: "Nueva" },
  ];

  assert.equal(buscarPedidoInicial(listaAnterior, 99), null);
  assert.equal(buscarPedidoInicial(listaActualizada, 99).id, 99);
  assert.equal(buscarPedidoInicial(listaActualizada, "1").id, 1);
  assert.equal(buscarPedidoInicial([], 99), null);
});

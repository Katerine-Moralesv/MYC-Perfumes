import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { ApiError, api } from "./api.js";
import { limpiarCacheAdmin } from "./adminCache.js";
import {
  OperacionEnCursoError,
  cambiarEstadoPedido,
  cancelarPedido,
  completarVentaPedido,
  confirmarPedido,
  construirPayloadAnticipo,
  construirPayloadCancelacion,
  construirPayloadConfirmacion,
  listarPedidos,
  rechazarPedido,
  registrarAnticipo,
} from "./pedidosAdmin.js";

const getOriginal = api.get;
const postOriginal = api.post;

beforeEach(() => {
  api.get = getOriginal;
  api.post = postOriginal;
  limpiarCacheAdmin();
});

afterEach(() => {
  api.get = getOriginal;
  api.post = postOriginal;
  limpiarCacheAdmin();
});

test("lista los pedidos reales del panel administrativo", async () => {
  let solicitud = null;

  api.get = async (url, config) => {
    solicitud = { url, config };
    return {
      data: [
        {
          id: 12,
          estado: "pendiente",
          cliente_nombre: "Laura Méndez",
          detalles: [{ id: 4, producto_nombre: "Perfume" }],
        },
      ],
    };
  };

  const pedidos = await listarPedidos();

  assert.equal(solicitud.url, "/pedidos/");
  assert.equal(pedidos[0].id, 12);
  assert.equal(pedidos[0].detalles[0].id, 4);
});

test("acepta una respuesta paginada del listado", async () => {
  api.get = async () => ({
    data: { results: [{ id: 8, estado: "confirmado" }] },
  });

  const pedidos = await listarPedidos();

  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].id, 8);
});

test("construye la confirmación sin enviar ventas, totales ni costos", () => {
  const payload = construirPayloadConfirmacion({
    estadoPago: "abonado",
    lineasPrecio: [
      { detalleId: 5, precioVenta: "180000" },
      { detalleId: 6, precioVenta: "95000.50" },
    ],
    montoRecibido: "50000",
  });

  assert.deepEqual(payload, {
    estado_pago: "abonado",
    lineas_precio: [
      { detalle_id: 5, precio_venta: "180000" },
      { detalle_id: 6, precio_venta: "95000.50" },
    ],
    monto_recibido: "50000",
  });
  assert.equal("total" in payload, false);
  assert.equal("venta" in payload, false);
  assert.equal("costo" in payload, false);
});

test("incluye la fecha de pago inicial cuando corresponde", () => {
  const payload = construirPayloadConfirmacion({
    estadoPago: "pagado",
    fechaPago: "2026-10-27",
  });

  assert.deepEqual(payload, {
    estado_pago: "pagado",
    fecha_pago: "2026-10-27",
  });
  assert.throws(
    () =>
      construirPayloadConfirmacion({
        estadoPago: "pagado",
        fechaPago: "27-10-2026",
      }),
    /fecha de pago/,
  );
});

test("omite líneas y monto cuando no son necesarios", () => {
  assert.deepEqual(
    construirPayloadConfirmacion({ estadoPago: "pagado" }),
    { estado_pago: "pagado" },
  );

  assert.deepEqual(
    construirPayloadConfirmacion({ estadoPago: "pendiente" }),
    { estado_pago: "pendiente" },
  );
});

test("rechaza confirmaciones incompletas antes de enviar", () => {
  assert.throws(
    () => construirPayloadConfirmacion({ estadoPago: "otro" }),
    /estado de pago/,
  );
  assert.throws(
    () =>
      construirPayloadConfirmacion({
        estadoPago: "abonado",
      }),
    /monto recibido/,
  );
  assert.throws(
    () =>
      construirPayloadConfirmacion({
        estadoPago: "pendiente",
        lineasPrecio: [{ detalleId: 1, precioVenta: "0" }],
      }),
    /precios pendientes/,
  );
  assert.throws(
    () =>
      construirPayloadConfirmacion({
        estadoPago: "pendiente",
        lineasPrecio: [
          { detalleId: 1, precioVenta: "1000" },
          { detalleId: 1, precioVenta: "2000" },
        ],
      }),
    /repetir una línea/,
  );
});

test("registra la confirmación mediante el endpoint real", async () => {
  let solicitud = null;

  api.post = async (url, body) => {
    solicitud = { url, body };
    return {
      data: {
        id: 21,
        estado: "confirmado",
        venta: 44,
        total: "180000.00",
        estado_pago: "abonado",
        saldo: "130000.00",
      },
    };
  };

  const pedido = await confirmarPedido(21, {
    estadoPago: "abonado",
    lineasPrecio: [{ detalleId: 9, precioVenta: "180000" }],
    montoRecibido: "50000",
  });

  assert.equal(solicitud.url, "/pedidos/21/confirmar/");
  assert.equal(solicitud.body.estado_pago, "abonado");
  assert.equal(solicitud.body.monto_recibido, "50000");
  assert.equal(solicitud.body.lineas_precio[0].detalle_id, 9);
  assert.equal(pedido.estado, "confirmado");
  assert.equal(pedido.venta, 44);
});

test("registra el rechazo mediante el endpoint real", async () => {
  let solicitud = null;

  api.post = async (url, body) => {
    solicitud = { url, body };
    return {
      data: {
        id: 7,
        estado: "rechazado",
        motivo_rechazo: "No disponible",
      },
    };
  };

  const pedido = await rechazarPedido(7, "  No disponible  ");

  assert.equal(solicitud.url, "/pedidos/7/rechazar/");
  assert.deepEqual(solicitud.body, { motivo: "No disponible" });
  assert.equal(pedido.estado, "rechazado");
  assert.equal(pedido.motivo_rechazo, "No disponible");
});

test("propaga 401 y 403 sin simular éxito", async () => {
  for (const status of [401, 403]) {
    const error = new ApiError({
      status,
      message:
        status === 401
          ? "Tu sesión expiró."
          : "No tienes permisos.",
    });

    api.get = async () => {
      throw error;
    };
    api.post = async () => {
      throw error;
    };

    await assert.rejects(
      listarPedidos(),
      /sesión|permisos/,
    );
    await assert.rejects(
      confirmarPedido(30, { estadoPago: "pendiente" }),
      /sesión|permisos/,
    );
    await assert.rejects(
      rechazarPedido(30, "Motivo"),
      /sesión|permisos/,
    );
  }
});

test("propaga fallos de red y validación sin devolver éxito", async () => {
  const errores = [
    new ApiError({
      message: "No se pudo conectar con el servidor.",
      isNetworkError: true,
    }),
    new ApiError({
      status: 400,
      message: "Faltan precios para las recargas pendientes.",
      fieldErrors: {
        lineas_precio: "Faltan precios para las recargas pendientes.",
      },
    }),
  ];

  for (const error of errores) {
    api.post = async () => {
      throw error;
    };

    await assert.rejects(
      confirmarPedido(32, { estadoPago: "pendiente" }),
      (recibido) => recibido === error,
    );
  }
});

test("bloquea operaciones duplicadas sobre el mismo pedido", async () => {
  let resolver;
  let llamadas = 0;

  api.post = () => {
    llamadas += 1;
    return new Promise((resolve) => {
      resolver = resolve;
    });
  };

  const primera = confirmarPedido(31, { estadoPago: "pagado" });

  await assert.rejects(
    confirmarPedido(31, { estadoPago: "pagado" }),
    OperacionEnCursoError,
  );
  await assert.rejects(
    rechazarPedido(31, "Motivo"),
    OperacionEnCursoError,
  );

  assert.equal(llamadas, 1);

  resolver({ data: { id: 31, estado: "confirmado" } });

  const pedido = await primera;

  assert.equal(pedido.estado, "confirmado");
});

test("construye y envía un anticipo con Idempotency-Key", async () => {
  let solicitud = null;

  api.post = async (url, body, config) => {
    solicitud = { url, body, config };
    return {
      data: {
        pedido: { id: 40, estado: "confirmado" },
        anticipo: { id: 3, monto: "50000.00" },
      },
    };
  };

  const respuesta = await registrarAnticipo(40, {
    monto: "50000",
    fecha: "2026-10-28",
    metodoPago: "transferencia",
    referencia: "TRX-1",
    claveIdempotencia: "anticipo-test-0001",
  });

  assert.equal(solicitud.url, "/pedidos/40/anticipos/");
  assert.equal(solicitud.body.monto, "50000");
  assert.equal(solicitud.body.fecha, "2026-10-28");
  assert.equal(solicitud.body.metodo_pago, "transferencia");
  assert.equal(solicitud.body.referencia, "TRX-1");
  assert.equal(
    solicitud.config.headers["Idempotency-Key"],
    "anticipo-test-0001",
  );
  assert.equal(respuesta.anticipo.id, 3);
});

test("rechaza anticipos sin clave o con datos inválidos", async () => {
  await assert.rejects(
    registrarAnticipo(40, {
      monto: "50000",
      fecha: "2026-10-28",
    }),
    /idempotencia/,
  );

  assert.throws(
    () =>
      construirPayloadAnticipo({
        monto: "0",
        fecha: "2026-10-28",
      }),
    /monto/,
  );
  assert.throws(
    () =>
      construirPayloadAnticipo({
        monto: "1000",
        fecha: "2027-01-01",
      }),
    /fecha del anticipo/,
  );
});

test("construye la cancelación y el cambio de estado", async () => {
  let solicitud = null;

  api.post = async (url, body, config) => {
    solicitud = { url, body, config };
    return { data: { id: 9, estado: "cancelado" } };
  };

  const cancelado = await cancelarPedido(9, {
    motivo: "Devolución total",
    montoDevolucion: "30000",
    fechaDevolucion: "2026-10-28",
    metodoPago: "transferencia",
    referencia: "DEV-1",
    claveIdempotencia: "cancelacion-test-0001",
  });

  assert.equal(solicitud.url, "/pedidos/9/cancelar/");
  assert.equal(solicitud.body.motivo, "Devolución total");
  assert.equal(solicitud.body.monto_devolucion, "30000");
  assert.equal(solicitud.body.metodo_pago, "transferencia");
  assert.equal(
    solicitud.config.headers["Idempotency-Key"],
    "cancelacion-test-0001",
  );
  assert.equal(cancelado.estado, "cancelado");

  assert.deepEqual(
    construirPayloadCancelacion({ motivo: "Sin devolución" }),
    { motivo: "Sin devolución" },
  );

  await cambiarEstadoPedido(9, "preparando");

  assert.equal(solicitud.url, "/pedidos/9/estado/");
  assert.deepEqual(solicitud.body, { estado: "preparando" });

  await completarVentaPedido(9);

  assert.equal(solicitud.url, "/pedidos/9/venta/");
  assert.deepEqual(solicitud.body, {});
});

test("mantiene la confirmación comercial sin crear una venta", async () => {
  let solicitud = null;

  api.post = async (url, body) => {
    solicitud = { url, body };
    return {
      data: {
        id: 50,
        estado: "confirmado",
        venta: null,
        estado_pago: "pendiente",
        saldo: "150000.00",
      },
    };
  };

  const pedido = await confirmarPedido(50, {
    estadoPago: "pendiente",
  });

  assert.equal(solicitud.url, "/pedidos/50/confirmar/");
  assert.deepEqual(solicitud.body, { estado_pago: "pendiente" });
  assert.equal(pedido.estado, "confirmado");
  assert.equal(pedido.venta, null);
  assert.equal(pedido.saldo, "150000.00");
});

test("una mutación invalida la lista cacheada de pedidos", async () => {
  let lecturas = 0;
  let escrituras = 0;

  api.get = async () => {
    lecturas += 1;
    return {
      data: [{ id: 1, estado: "pendiente" }],
    };
  };

  api.post = async () => {
    escrituras += 1;
    return {
      data: { id: 1, estado: "preparando" },
    };
  };

  await listarPedidos();
  await listarPedidos();

  assert.equal(lecturas, 1);

  await cambiarEstadoPedido(1, "preparando");

  assert.equal(escrituras, 1);

  await listarPedidos();

  assert.equal(lecturas, 2);
});


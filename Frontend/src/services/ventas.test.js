import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { ApiError, api } from "./api.js";
import {
  OperacionEnCursoError,
  construirPayloadVenta,
  crearVenta,
} from "./ventas.js";

const postOriginal = api.post;

beforeEach(() => {
  api.post = postOriginal;
});

afterEach(() => {
  api.post = postOriginal;
});

function lineasBase() {
  return [
    {
      presentacionId: 7,
      cantidad: 2,
      precioVenta: "120000",
    },
    {
      presentacionId: 9,
      cantidad: 1,
      precioVenta: "95000.50",
    },
  ];
}

test("construye el payload con los datos del cliente", () => {
  const payload = construirPayloadVenta({
    clienteNombre: "  Laura Méndez  ",
    clienteTelefono: " 300 123 4567 ",
    fecha: "2026-10-26",
    estadoPago: "pendiente",
    lineas: lineasBase(),
  });

  assert.deepEqual(payload, {
    cliente_nombre: "Laura Méndez",
    cliente_telefono: "300 123 4567",
    fecha: "2026-10-26",
    estado_pago: "pendiente",
    lineas: [
      {
        presentacion_id: 7,
        cantidad: 2,
        precio_venta: "120000",
      },
      {
        presentacion_id: 9,
        cantidad: 1,
        precio_venta: "95000.50",
      },
    ],
  });
  assert.equal("cliente_id" in payload, false);
  assert.equal("total" in payload, false);
});

test("mantiene compatibilidad con cliente_id existente", () => {
  const payload = construirPayloadVenta({
    clienteId: 3,
    fecha: "2026-10-26",
    estadoPago: "pendiente",
    lineas: lineasBase(),
  });

  assert.equal(payload.cliente_id, 3);
});

test("construye una venta abonada con pago inicial y fecha de pago", () => {
  const payload = construirPayloadVenta({
    clienteId: 3,
    fecha: "2026-10-26",
    estadoPago: "abonado",
    montoInicial: "50000",
    fechaPago: "2026-10-27",
    lineas: lineasBase(),
  });

  assert.equal(payload.estado_pago, "abonado");
  assert.equal(payload.monto_inicial, "50000");
  assert.equal(payload.fecha_pago, "2026-10-27");
});

test("rechaza una venta abonada sin monto inicial válido", () => {
  assert.throws(
    () =>
      construirPayloadVenta({
        clienteId: 3,
        fecha: "2026-10-26",
        estadoPago: "abonado",
        lineas: lineasBase(),
      }),
    /monto inicial/,
  );
  assert.throws(
    () =>
      construirPayloadVenta({
        clienteId: 3,
        fecha: "2026-10-26",
        estadoPago: "abonado",
        montoInicial: "335000.50",
        lineas: lineasBase(),
      }),
    /menor que el total/,
  );
});

test("rechaza ventas inválidas antes de enviar", () => {
  const base = {
    clienteId: 3,
    fecha: "2026-10-26",
    estadoPago: "pendiente",
    lineas: lineasBase(),
  };

  assert.throws(
    () => construirPayloadVenta({ ...base, clienteId: 0 }),
    /cliente/,
  );
  assert.throws(
    () => construirPayloadVenta({ ...base, fecha: "26-10-2026" }),
    /fecha/,
  );
  assert.throws(
    () => construirPayloadVenta({ ...base, lineas: [] }),
    /presentación/,
  );
  assert.throws(
    () =>
      construirPayloadVenta({
        ...base,
        lineas: [{ presentacionId: 1, cantidad: 0, precioVenta: "1000" }],
      }),
    /cantidad/,
  );
  assert.throws(
    () =>
      construirPayloadVenta({
        ...base,
        lineas: [{ presentacionId: 1, cantidad: 1, precioVenta: "0" }],
      }),
    /precio/,
  );
  assert.throws(
    () =>
      construirPayloadVenta({
        ...base,
        lineas: [
          { presentacionId: 1, cantidad: 1, precioVenta: "1000" },
          { presentacionId: 1, cantidad: 2, precioVenta: "2000" },
        ],
      }),
    /repetir/,
  );
});

test("registra la venta mediante el endpoint real", async () => {
  let solicitud = null;

  api.post = async (url, body, config) => {
    solicitud = { url, body, config };
    return {
      data: {
        id: 42,
        cliente: 3,
        cliente_nombre: "Laura",
        estado_pago: "pendiente",
        total: "335000.50",
        saldo: "335000.50",
        detalles: [],
        abonos: [],
      },
    };
  };

  const venta = await crearVenta({
    clienteNombre: "Laura Méndez",
    clienteTelefono: "300 123 4567",
    fecha: "2026-10-26",
    estadoPago: "pendiente",
    lineas: lineasBase(),
    claveIdempotencia: "venta-clave-001",
  });

  assert.equal(
    solicitud.url,
    "/finanzas/ventas/registrar/",
  );
  assert.equal(
    solicitud.config.headers["Idempotency-Key"],
    "venta-clave-001",
  );
  assert.equal(
    solicitud.body.cliente_nombre,
    "Laura Méndez",
  );
  assert.equal(
    solicitud.body.cliente_telefono,
    "300 123 4567",
  );
  assert.equal("cliente_id" in solicitud.body, false);
  assert.equal(solicitud.body.estado_pago, "pendiente");
  assert.equal(solicitud.body.lineas.length, 2);
  assert.equal("total" in solicitud.body, false);
  assert.equal(venta.id, 42);
});

test("propaga 401, 403 y errores de red sin simular éxito", async () => {
  const errores = [
    new ApiError({ status: 401, message: "Tu sesión expiró." }),
    new ApiError({ status: 403, message: "No tienes permisos." }),
    new ApiError({
      message: "No se pudo conectar con el servidor.",
      isNetworkError: true,
    }),
  ];

  for (const error of errores) {
    api.post = async () => {
      throw error;
    };

    await assert.rejects(
      crearVenta({
        clienteId: 3,
        fecha: "2026-10-26",
        estadoPago: "pendiente",
        lineas: lineasBase(),
      }),
      (recibido) => recibido === error,
    );
  }
});

test("bloquea ventas duplicadas concurrentes", async () => {
  let resolver;
  let llamadas = 0;

  api.post = () => {
    llamadas += 1;
    return new Promise((resolve) => {
      resolver = resolve;
    });
  };

  const primera = crearVenta({
    clienteId: 3,
    fecha: "2026-10-26",
    estadoPago: "pendiente",
    lineas: lineasBase(),
  });

  await assert.rejects(
    crearVenta({
      clienteId: 3,
      fecha: "2026-10-26",
      estadoPago: "pagado",
      lineas: lineasBase(),
    }),
    OperacionEnCursoError,
  );

  assert.equal(llamadas, 1);

  resolver({ data: { id: 50, estado_pago: "pendiente" } });

  const venta = await primera;

  assert.equal(venta.id, 50);
});

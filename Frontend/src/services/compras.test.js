import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { ApiError, api } from "./api.js";
import {
  calcularTotalCompra,
  construirPayloadCompra,
  construirPayloadRecepcion,
  crearProveedor,
  incorporarProveedor,
  listarCompras,
  listarProveedores,
  registrarCompra,
  registrarRecepcionCompra,
} from "./compras.js";

const getOriginal = api.get;
const postOriginal = api.post;

beforeEach(() => {
  api.get = getOriginal;
  api.post = postOriginal;
});

afterEach(() => {
  api.get = getOriginal;
  api.post = postOriginal;
});

test("lista compras reales desde Django", async () => {
  let url = "";

  api.get = async (solicitada) => {
    url = solicitada;
    return { data: [{ id: 1, total: "75000.00" }] };
  };

  const compras = await listarCompras();

  assert.equal(url, "/finanzas/compras/");
  assert.equal(compras[0].id, 1);
});

test("lista proveedores reales desde Django", async () => {
  let url = "";

  api.get = async (solicitada) => {
    url = solicitada;
    return { data: [{ id: 2, nombre: "Proveedor" }] };
  };

  const proveedores = await listarProveedores();

  assert.equal(url, "/finanzas/proveedores/");
  assert.equal(proveedores[0].id, 2);
});

test("crea un proveedor mínimo", async () => {
  let solicitud = null;

  api.post = async (url, body) => {
    solicitud = { url, body };
    return { data: { id: 4, nombre: "Proveedor nuevo" } };
  };

  const proveedor = await crearProveedor({
    nombre: "  Proveedor nuevo  ",
    telefono: " 3001234567 ",
  });

  assert.equal(solicitud.url, "/finanzas/proveedores/");
  assert.equal(solicitud.body.nombre, "Proveedor nuevo");
  assert.equal(solicitud.body.telefono, "3001234567");
  assert.equal(proveedor.id, 4);
});

test("construye el payload de compra sin enviar total", () => {
  const payload = construirPayloadCompra({
    proveedorId: "3",
    fecha: "2026-02-10",
    presentacionId: "7",
    cantidad: "2",
    costoUnitario: "25000.00",
  });

  assert.deepEqual(payload, {
    proveedor_id: 3,
    fecha: "2026-02-10",
    lineas: [
      {
        presentacion_id: 7,
        cantidad: 2,
        costo_unitario: "25000.00",
      },
    ],
  });
  assert.equal("total" in payload, false);
  assert.equal("total" in payload.lineas[0], false);
});

test("registra la compra mediante el endpoint real", async () => {
  let solicitud = null;

  api.post = async (url, body) => {
    solicitud = { url, body };
    return {
      data: {
        id: 9,
        proveedor: 3,
        total: "50000.00",
        detalles: [
          {
            presentacion: 7,
            cantidad: 2,
            costo_unitario: "25000.00",
            subtotal: "50000.00",
          },
        ],
      },
    };
  };

  const compra = await registrarCompra({
    proveedorId: 3,
    fecha: "2026-02-10",
    presentacionId: 7,
    cantidad: 2,
    costoUnitario: "25000.00",
  });

  assert.equal(
    solicitud.url,
    "/finanzas/compras/registrar/"
  );
  assert.equal(solicitud.body.proveedor_id, 3);
  assert.equal(solicitud.body.lineas[0].presentacion_id, 7);
  assert.equal(solicitud.body.lineas[0].cantidad, 2);
  assert.equal(
    solicitud.body.lineas[0].costo_unitario,
    "25000.00",
  );
  assert.equal(compra.total, "50000.00");
});

test("envía Idempotency-Key al registrar la compra", async () => {
  let config = null;

  api.post = async (_url, _body, opciones) => {
    config = opciones;
    return { data: { id: 11 } };
  };

  await registrarCompra({
    proveedorId: 3,
    fecha: "2026-02-10",
    presentacionId: 7,
    cantidad: 2,
    costoUnitario: "25000.00",
    claveIdempotencia: "compra-frontend-0001",
  });

  assert.equal(
    config.headers["Idempotency-Key"],
    "compra-frontend-0001",
  );
});

test("construye la recepción de una compra pendiente", () => {
  const payload = construirPayloadRecepcion({
    fecha: "2026-10-29",
    lineas: [
      {
        detalleCompraId: 4,
        cantidad: 2,
        asignaciones: [
          { detallePedidoId: 8, cantidad: 1 },
        ],
      },
    ],
  });

  assert.deepEqual(payload, {
    fecha: "2026-10-29",
    lineas: [
      {
        detalle_compra_id: 4,
        cantidad: 2,
        asignaciones: [
          { detalle_pedido_id: 8, cantidad: 1 },
        ],
      },
    ],
  });
});

test("registra la recepción con idempotencia", async () => {
  let solicitud = null;

  api.post = async (url, body, opciones) => {
    solicitud = { url, body, opciones };
    return { data: { id: 4, detalles: [] } };
  };

  await registrarRecepcionCompra(4, {
    fecha: "2026-10-29",
    lineas: [{ detalleCompraId: 7, cantidad: 1 }],
    claveIdempotencia: "recepcion-frontend-0001",
  });

  assert.equal(
    solicitud.url,
    "/finanzas/compras/4/recibir/",
  );
  assert.equal(solicitud.body.lineas[0].cantidad, 1);
  assert.equal(
    solicitud.opciones.headers["Idempotency-Key"],
    "recepcion-frontend-0001",
  );
});

test("rechaza datos inválidos antes de enviar", () => {
  const base = {
    proveedorId: 1,
    fecha: "2026-02-10",
    presentacionId: 1,
    cantidad: 1,
    costoUnitario: "1000.00",
  };

  assert.throws(
    () => construirPayloadCompra({ ...base, proveedorId: "" }),
    /proveedor/,
  );
  assert.throws(
    () => construirPayloadCompra({ ...base, presentacionId: null }),
    /presentación/,
  );
  assert.throws(
    () => construirPayloadCompra({ ...base, cantidad: 0 }),
    /cantidad/,
  );
  assert.throws(
    () => construirPayloadCompra({ ...base, costoUnitario: "0" }),
    /costo unitario/,
  );
  assert.throws(
    () => construirPayloadCompra({ ...base, fecha: "" }),
    /fecha/,
  );
});

test("propaga 401 y 403 sin simular éxito", async () => {
  for (const status of [401, 403]) {
    api.post = async () => {
      throw new ApiError({
        status,
        message:
          status === 401
            ? "Tu sesión expiró."
            : "No tienes permisos.",
      });
    };

    await assert.rejects(
      registrarCompra({
        proveedorId: 1,
        fecha: "2026-02-10",
        presentacionId: 1,
        cantidad: 1,
        costoUnitario: "1000.00",
      }),
      /sesión|permisos/,
    );
  }
});

test("selecciona el proveedor creado y conserva los anteriores", () => {
  const anteriores = [
    { id: 1, nombre: "Proveedor Uno" },
    { id: 2, nombre: "Proveedor Dos" },
  ];
  const nuevo = { id: 3, nombre: "Proveedor Tres" };

  const resultado = incorporarProveedor(anteriores, nuevo);

  assert.deepEqual(
    resultado.proveedores.map((proveedor) => proveedor.id),
    [1, 2, 3],
  );
  assert.equal(resultado.proveedorId, "3");
  assert.equal(anteriores.length, 2);
});

test("permite crear proveedores distintos sin reemplazar los anteriores", async () => {
  const creados = [];
  let llamadas = 0;

  api.post = async (_url, body) => {
    llamadas += 1;
    const proveedor = {
      id: llamadas + 20,
      nombre: body.nombre,
      telefono: body.telefono,
    };
    creados.push(proveedor);
    return { data: proveedor };
  };

  const primero = await crearProveedor({
    nombre: "Proveedor Uno",
    telefono: "3001110001",
  });
  const segundo = await crearProveedor({
    nombre: "Proveedor Dos",
    telefono: "3001110002",
  });

  assert.equal(llamadas, 2);
  assert.equal(primero.id, 21);
  assert.equal(segundo.id, 22);
  assert.deepEqual(
    creados.map((proveedor) => proveedor.nombre),
    ["Proveedor Uno", "Proveedor Dos"],
  );
});

test("propaga el error del backend al crear un proveedor", async () => {
  api.post = async () => {
    throw new ApiError({
      status: 400,
      message: "El nombre del proveedor no es válido.",
    });
  };

  await assert.rejects(
    crearProveedor({
      nombre: "Proveedor",
      telefono: "3001110001",
    }),
    /nombre del proveedor no es válido/,
  );
});

test("construye una compra con varias líneas, recepción y asignaciones", () => {
  const payload = construirPayloadCompra({
    proveedorId: "3",
    fecha: "2026-10-28",
    lineas: [
      {
        presentacionId: "7",
        cantidad: "2",
        cantidadRecibida: "1",
        costoUnitario: "25000",
        asignaciones: [
          { detallePedidoId: 11, cantidad: "1" },
        ],
      },
      {
        presentacionId: "9",
        cantidad: "3",
        cantidadRecibida: "3",
        costoUnitario: "10000",
      },
    ],
  });

  assert.deepEqual(payload, {
    proveedor_id: 3,
    fecha: "2026-10-28",
    lineas: [
      {
        presentacion_id: 7,
        cantidad: 2,
        costo_unitario: "25000",
        cantidad_recibida: 1,
        asignaciones: [
          { detalle_pedido_id: 11, cantidad: 1 },
        ],
      },
      {
        presentacion_id: 9,
        cantidad: 3,
        costo_unitario: "10000",
        cantidad_recibida: 3,
      },
    ],
  });

  assert.equal(
    calcularTotalCompra([
      { cantidad: 2, costoUnitario: 25000 },
      { cantidad: 3, costoUnitario: 10000 },
    ]),
    80000,
  );
});

test("evita asignar dos veces o superar la cantidad recibida", () => {
  const base = {
    proveedorId: 3,
    fecha: "2026-10-28",
    lineas: [
      {
        presentacionId: 7,
        cantidad: 2,
        cantidadRecibida: 1,
        costoUnitario: "25000",
        asignaciones: [
          { detallePedidoId: 11, cantidad: 1 },
        ],
      },
    ],
  };

  assert.throws(
    () =>
      construirPayloadCompra({
        ...base,
        lineas: [
          {
            ...base.lineas[0],
            asignaciones: [
              { detallePedidoId: 11, cantidad: 1 },
              { detallePedidoId: 11, cantidad: 1 },
            ],
          },
        ],
      }),
    /dos veces/,
  );

  assert.throws(
    () =>
      construirPayloadCompra({
        ...base,
        lineas: [
          {
            ...base.lineas[0],
            asignaciones: [
              { detallePedidoId: 11, cantidad: 2 },
            ],
          },
        ],
      }),
    /superan la cantidad recibida/,
  );

  assert.throws(
    () =>
      construirPayloadCompra({
        ...base,
        lineas: [
          {
            ...base.lineas[0],
            cantidadRecibida: 3,
          },
        ],
      }),
    /cantidad recibida/,
  );
});

test("rechaza presentaciones repetidas en una compra múltiple", () => {
  assert.throws(
    () =>
      construirPayloadCompra({
        proveedorId: 3,
        fecha: "2026-10-28",
        lineas: [
          {
            presentacionId: 7,
            cantidad: 1,
            costoUnitario: "1000",
          },
          {
            presentacionId: 7,
            cantidad: 1,
            costoUnitario: "1000",
          },
        ],
      }),
    /repetir una presentación/,
  );
});


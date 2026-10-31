import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { ApiError, api } from "./api.js";
import {
  CLAVE_INTENTO_COMPRA,
  aplicarRecargas,
  claveLineaChat,
  construirPayloadPedido,
  crearHuellaPayload,
  eliminarSeleccionEnviada,
  generarClaveIdempotencia,
  leerIntentoCompra,
  limpiarIntentoCompra,
  mensajeErrorPedido,
  obtenerClaveIntento,
  registrarPedido,
} from "./pedidos.js";

const postOriginal = api.post;

function crearStorageMock() {
  const datos = new Map();

  return {
    getItem(clave) {
      return datos.has(clave) ? datos.get(clave) : null;
    },
    setItem(clave, valor) {
      datos.set(clave, String(valor));
    },
    removeItem(clave) {
      datos.delete(clave);
    },
  };
}

function instalarSessionStorage() {
  const storage = crearStorageMock();
  globalThis.window = { sessionStorage: storage };
  return storage;
}

function itemsBase() {
  return [
    {
      productId: "1",
      cantidad: "2",
      concentracion: "40",
    },
    {
      productId: 2,
      cantidad: 1,
      concentracion: "70",
    },
  ];
}

beforeEach(() => {
  instalarSessionStorage();
  limpiarIntentoCompra();
  api.post = postOriginal;
});

afterEach(() => {
  api.post = postOriginal;
  limpiarIntentoCompra();
  delete globalThis.window;
});

test("construye el body con solo los campos permitidos", () => {
  const payload = construirPayloadPedido({
    items: itemsBase(),
    telefono: "300 123 4567",
    nombreCliente: "  Laura Méndez  ",
  });

  assert.deepEqual(payload, {
    telefono: "3001234567",
    nombre_cliente: "Laura Méndez",
    lineas: [
      {
        producto_id: 1,
        cantidad: 2,
        recarga_solicitada: false,
        porcentaje: 40,
      },
      {
        producto_id: 2,
        cantidad: 1,
        recarga_solicitada: true,
        porcentaje: 70,
      },
    ],
  });

  assert.deepEqual(
    Object.keys(payload).sort(),
    ["lineas", "nombre_cliente", "telefono"],
  );
  assert.deepEqual(
    Object.keys(payload.lineas[0]).sort(),
    ["cantidad", "porcentaje", "producto_id", "recarga_solicitada"],
  );
});

test("aplica recargas independientes por línea", () => {
  const items = [
    {
      lineKey: "linea-a",
      productId: 1,
      cantidad: 2,
      concentracion: "40",
      precioBase: 100000,
      precioUnitario: 100000,
    },
    {
      lineKey: "linea-b",
      productId: 2,
      cantidad: 1,
      concentracion: "70",
      precioBase: 50000,
      precioUnitario: 0,
    },
    {
      lineKey: "linea-c",
      productId: 3,
      cantidad: 1,
      concentracion: "60",
      precioBase: 80000,
      precioUnitario: 0,
    },
  ];

  const resultado = aplicarRecargas(items, {
    "linea-a": "60",
    "linea-b": "40",
    "linea-c": "80",
  });

  assert.equal(claveLineaChat(items[0], 0), "linea-a");
  assert.equal(resultado[0].concentracion, "60");
  assert.equal(resultado[0].precioUnitario, 0);
  assert.equal(resultado[1].concentracion, "40");
  assert.equal(resultado[1].precioUnitario, 50000);
  assert.equal(resultado[2].concentracion, "80");
  assert.equal(resultado[2].precioUnitario, 0);
});

test("mantiene la elección original si aún no se eligió recarga", () => {
  const items = [
    {
      lineKey: "sin-elegir",
      productId: 1,
      cantidad: 1,
      concentracion: "40",
      precioBase: 90000,
      precioUnitario: 90000,
    },
  ];

  const resultado = aplicarRecargas(items, {});

  assert.equal(resultado[0].concentracion, "40");
  assert.equal(resultado[0].precioUnitario, 90000);
});

test("construye el body con las recargas elegidas por línea", () => {
  const items = [
    {
      lineKey: "uno",
      productId: 1,
      cantidad: 2,
      concentracion: "40",
      precioBase: 100000,
      precioUnitario: 100000,
    },
    {
      lineKey: "dos",
      productId: 2,
      cantidad: 1,
      concentracion: "40",
      precioBase: 60000,
      precioUnitario: 60000,
    },
  ];

  const payload = construirPayloadPedido({
    items: aplicarRecargas(items, {
      uno: "60",
      dos: "40",
    }),
    telefono: "3001234567",
    nombreCliente: "Laura",
  });

  assert.deepEqual(payload.lineas, [
    {
      producto_id: 1,
      cantidad: 2,
      recarga_solicitada: true,
      porcentaje: 60,
    },
    {
      producto_id: 2,
      cantidad: 1,
      recarga_solicitada: false,
      porcentaje: 40,
    },
  ]);
});

test("rechaza selección vacía, ids, cantidades y porcentajes inválidos", () => {
  assert.throws(
    () => construirPayloadPedido({
      items: [],
      telefono: "3001234567",
      nombreCliente: "Laura",
    }),
    /vacía/,
  );

  assert.throws(
    () => construirPayloadPedido({
      items: [{ productId: null, cantidad: 1, concentracion: 40 }],
      telefono: "3001234567",
      nombreCliente: "Laura",
    }),
    /identificador/,
  );

  assert.throws(
    () => construirPayloadPedido({
      items: [{ productId: 1, cantidad: 0, concentracion: 40 }],
      telefono: "3001234567",
      nombreCliente: "Laura",
    }),
    /cantidad/,
  );

  assert.throws(
    () => construirPayloadPedido({
      items: [{ productId: 1, cantidad: 1, concentracion: 55 }],
      telefono: "3001234567",
      nombreCliente: "Laura",
    }),
    /porcentaje/,
  );
});

test("no permite repetir producto con el mismo porcentaje", () => {
  assert.throws(
    () => construirPayloadPedido({
      items: [
        { productId: 1, cantidad: 1, concentracion: 40 },
        { productId: 1, cantidad: 2, concentracion: 40 },
      ],
      telefono: "3001234567",
      nombreCliente: "Laura",
    }),
    /repetir/,
  );
});

test("valida teléfono y nombre", () => {
  assert.throws(
    () => construirPayloadPedido({
      items: itemsBase(),
      telefono: "123",
      nombreCliente: "Laura",
    }),
    /teléfono/,
  );

  assert.throws(
    () => construirPayloadPedido({
      items: itemsBase(),
      telefono: "3001234567",
      nombreCliente: "   ",
    }),
    /nombre/,
  );
});

test("genera claves de idempotencia válidas y diferentes", () => {
  const primera = generarClaveIdempotencia();
  const segunda = generarClaveIdempotencia();

  assert.ok(primera.length >= 8);
  assert.ok(primera.length <= 64);
  assert.notEqual(primera, segunda);
});

test("reutiliza la clave con el mismo contenido y la cambia al cambiar", () => {
  const payload = construirPayloadPedido({
    items: itemsBase(),
    telefono: "3001234567",
    nombreCliente: "Laura",
  });

  const primera = obtenerClaveIntento(payload);
  const segunda = obtenerClaveIntento(payload);
  const intento = leerIntentoCompra();

  assert.equal(primera, segunda);
  assert.equal(intento.clave, primera);
  assert.equal(intento.huella, crearHuellaPayload(payload));
  assert.equal(intento.nombre_cliente, undefined);
  assert.equal(intento.telefono, undefined);

  const otroPayload = construirPayloadPedido({
    items: itemsBase(),
    telefono: "3001234567",
    nombreCliente: "Otra persona",
  });

  assert.notEqual(primera, obtenerClaveIntento(otroPayload));
});

test("envía el body y la Idempotency-Key por el servicio compartido", async () => {
  let solicitud = null;

  api.post = async (url, body, config) => {
    solicitud = { url, body, config };
    return {
      status: 201,
      data: { id: 55, estado: "pendiente", reutilizado: false },
    };
  };

  const resultado = await registrarPedido({
    items: itemsBase(),
    telefono: "300 123 4567",
    nombreCliente: "Laura",
  });

  assert.equal(solicitud.url, "/pedidos/tienda/");
  assert.equal(solicitud.config.headers["Content-Type"], "application/json");
  assert.equal(
    solicitud.config.headers["Idempotency-Key"],
    resultado.claveIdempotencia,
  );
  assert.equal(solicitud.body.telefono, "3001234567");
  assert.equal(solicitud.body.nombre_cliente, "Laura");
  assert.equal(solicitud.body.lineas.length, 2);
  assert.equal(resultado.status, 201);
  assert.equal(resultado.pedido.id, 55);
  assert.equal(leerIntentoCompra(), null);
});

test("maneja respuesta 200 reutilizada sin crear un intento nuevo", async () => {
  let llamadas = 0;

  api.post = async () => {
    llamadas += 1;
    return {
      status: 200,
      data: { id: 77, estado: "pendiente", reutilizado: true },
    };
  };

  const resultado = await registrarPedido({
    items: itemsBase(),
    telefono: "3001234567",
    nombreCliente: "Laura",
  });

  assert.equal(llamadas, 1);
  assert.equal(resultado.status, 200);
  assert.equal(resultado.reutilizado, true);
  assert.equal(resultado.pedido.id, 77);
  assert.equal(leerIntentoCompra(), null);
});

test("conserva la clave ante error de red y la reutiliza al reintentar", async () => {
  const payload = construirPayloadPedido({
    items: itemsBase(),
    telefono: "3001234567",
    nombreCliente: "Laura",
  });
  const claveInicial = obtenerClaveIntento(payload);

  api.post = async () => {
    throw new ApiError({
      message: "Sin conexión",
      status: 0,
      isNetworkError: true,
    });
  };

  await assert.rejects(
    registrarPedido({
      items: itemsBase(),
      telefono: "3001234567",
      nombreCliente: "Laura",
    }),
    /Sin conexión/,
  );

  const intento = leerIntentoCompra();
  assert.equal(intento.clave, claveInicial);
  assert.equal(intento.huella, crearHuellaPayload(payload));

  let headerReintento = "";

  api.post = async (_url, _body, config) => {
    headerReintento = config.headers["Idempotency-Key"];
    return {
      status: 201,
      data: { id: 88, estado: "pendiente", reutilizado: false },
    };
  };

  await registrarPedido({
    items: itemsBase(),
    telefono: "3001234567",
    nombreCliente: "Laura",
  });

  assert.equal(headerReintento, claveInicial);
  assert.equal(leerIntentoCompra(), null);
});

test("presenta mensajes comprensibles para cada estado de error", () => {
  assert.equal(
    mensajeErrorPedido(
      new ApiError({ status: 400, message: "Teléfono inválido." })
    ),
    "Teléfono inválido.",
  );
  assert.match(
    mensajeErrorPedido(
      new ApiError({ status: 409, message: "Solicitud distinta." })
    ),
    /Solicitud distinta/,
  );
  assert.match(
    mensajeErrorPedido(
      new ApiError({ status: 429, message: "" })
    ),
    /demasiados intentos/i,
  );
  assert.match(
    mensajeErrorPedido(
      new ApiError({ status: 503, message: "Error interno" })
    ),
    /No pudimos confirmar/,
  );
  assert.match(
    mensajeErrorPedido(
      new ApiError({
        status: 0,
        message: "",
        isNetworkError: true,
      })
    ),
    /No pudimos confirmar/,
  );
});

test("elimina solo las líneas enviadas con la misma cantidad", () => {
  const actual = [
    { lineKey: "a", cantidad: 2 },
    { lineKey: "b", cantidad: 1 },
    { lineKey: "c", cantidad: 3 },
  ];
  const enviados = [
    { lineKey: "a", cantidad: 2 },
    { lineKey: "b", cantidad: 2 },
  ];

  assert.deepEqual(
    eliminarSeleccionEnviada(actual, enviados),
    [
      { lineKey: "b", cantidad: 1 },
      { lineKey: "c", cantidad: 3 },
    ],
  );
});

test("conserva una selección nueva agregada durante el envío", () => {
  const actual = [
    { lineKey: "enviada", cantidad: 1 },
    { lineKey: "nueva", cantidad: 4 },
  ];

  assert.deepEqual(
    eliminarSeleccionEnviada(actual, [
      { lineKey: "enviada", cantidad: 1 },
    ]),
    [{ lineKey: "nueva", cantidad: 4 }],
  );
});

test("guarda el intento en sessionStorage sin datos de contacto", () => {
  const payload = construirPayloadPedido({
    items: itemsBase(),
    telefono: "3001234567",
    nombreCliente: "Laura",
  });

  obtenerClaveIntento(payload);

  const guardado = globalThis.window.sessionStorage.getItem(
    CLAVE_INTENTO_COMPRA,
  );
  const intento = JSON.parse(guardado);

  assert.ok(intento.clave);
  assert.ok(intento.huella);
  assert.equal(Object.hasOwn(intento, "telefono"), false);
  assert.equal(Object.hasOwn(intento, "nombre_cliente"), false);
});

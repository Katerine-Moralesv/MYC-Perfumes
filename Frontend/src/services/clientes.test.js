import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { ApiError, api } from "./api.js";
import {
  OperacionEnCursoError,
  buscarClientePorTelefono,
  construirPayloadCliente,
  crearClaveIdempotencia,
  crearCliente,
  listarClientes,
  listarVentas,
  normalizarTelefono,
  registrarAbono,
} from "./clientes.js";

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

test("lista clientes reales desde Django", async () => {
  let solicitud = null;

  api.get = async (url, config) => {
    solicitud = { url, config };
    return {
      data: [
        {
          id: 2,
          nombre: "Laura Méndez",
          telefono: "+573001234567",
          notas: "Cliente frecuente",
        },
      ],
    };
  };

  const clientes = await listarClientes();

  assert.equal(solicitud.url, "/finanzas/clientes/");
  assert.equal(clientes[0].id, 2);
  assert.equal(clientes[0].telefono, "+573001234567");
});

test("acepta una respuesta paginada de clientes", async () => {
  api.get = async () => ({
    data: { results: [{ id: 8, nombre: "Cliente" }] },
  });

  const clientes = await listarClientes();

  assert.equal(clientes.length, 1);
  assert.equal(clientes[0].id, 8);
});

test("normaliza teléfonos como el backend", () => {
  assert.equal(normalizarTelefono("300 123 4567"), "+573001234567");
  assert.equal(normalizarTelefono("573001234567"), "+573001234567");
  assert.equal(normalizarTelefono("+57 300 123 4567"), "+573001234567");
  assert.equal(normalizarTelefono("6011234567"), "6011234567");
  assert.equal(normalizarTelefono(""), "");
});

test("detecta un cliente existente por teléfono normalizado", () => {
  const clientes = [
    { id: 1, nombre: "Laura", telefono: "+573001234567" },
    { id: 2, nombre: "Ana", telefono: "3105550188" },
  ];

  assert.equal(
    buscarClientePorTelefono(clientes, "300 123 4567")?.id,
    1,
  );
  assert.equal(
    buscarClientePorTelefono(clientes, "+57 310 555 0188")?.id,
    2,
  );
  assert.equal(buscarClientePorTelefono(clientes, ""), null);
});

test("construye el payload de cliente con campos permitidos", () => {
  const payload = construirPayloadCliente({
    nombre: "  Laura Méndez  ",
    telefono: "300 123 4567",
    notas: "  Cliente frecuente  ",
  });

  assert.deepEqual(payload, {
    nombre: "Laura Méndez",
    telefono: "+573001234567",
    notas: "Cliente frecuente",
  });
});

test("rechaza nombres y teléfonos inválidos antes de enviar", () => {
  assert.throws(
    () => construirPayloadCliente({ nombre: "   " }),
    /nombre/,
  );
  assert.throws(
    () =>
      construirPayloadCliente({
        nombre: "Cliente",
        telefono: "abc",
      }),
    /teléfono/,
  );
  assert.throws(
    () =>
      construirPayloadCliente({
        nombre: "Cliente",
        telefono: "123",
      }),
    /7 y 15/,
  );
});

test("crea un cliente mediante el endpoint real", async () => {
  let solicitud = null;

  api.post = async (url, body) => {
    solicitud = { url, body };
    return {
      data: {
        id: 9,
        nombre: "Laura Méndez",
        telefono: "+573001234567",
        notas: "Cliente frecuente",
      },
    };
  };

  const cliente = await crearCliente({
    nombre: "  Laura Méndez ",
    telefono: "300 123 4567",
    notas: " Cliente frecuente ",
  });

  assert.equal(solicitud.url, "/finanzas/clientes/");
  assert.equal(solicitud.body.nombre, "Laura Méndez");
  assert.equal(solicitud.body.telefono, "+573001234567");
  assert.equal(solicitud.body.notas, "Cliente frecuente");
  assert.equal("id" in solicitud.body, false);
  assert.equal(cliente.id, 9);
});

test("lista ventas visibles para el usuario", async () => {
  let url = "";

  api.get = async (solicitada) => {
    url = solicitada;
    return {
      data: [
        {
          id: 4,
          cliente: 2,
          total: "150000.00",
          saldo: "50000.00",
          estado_pago: "abonado",
          detalles: [],
          abonos: [],
        },
      ],
    };
  };

  const ventas = await listarVentas();

  assert.equal(url, "/finanzas/ventas/");
  assert.equal(ventas[0].id, 4);
  assert.equal(ventas[0].saldo, "50000.00");
});

test("genera una clave de idempotencia no vacía", () => {
  const clave = crearClaveIdempotencia();

  assert.equal(typeof clave, "string");
  assert.ok(clave.trim().length >= 8);
});

test("registra un abono mediante el endpoint real", async () => {
  let solicitud = null;

  api.post = async (url, body, config) => {
    solicitud = { url, body, config };
    return {
      data: {
        id: 4,
        saldo: "30000.00",
        estado_pago: "abonado",
      },
    };
  };

  const venta = await registrarAbono(4, {
    monto: "20000",
    fecha: "2026-10-26",
    claveIdempotencia: "abono-clave-001",
  });

  assert.equal(
    solicitud.url,
    "/finanzas/ventas/4/abonos/",
  );
  assert.deepEqual(solicitud.body, {
    monto: "20000",
    fecha: "2026-10-26",
  });
  assert.equal(
    solicitud.config.headers["Idempotency-Key"],
    "abono-clave-001",
  );
  assert.equal(venta.saldo, "30000.00");
});

test("rechaza abonos inválidos antes de enviar", async () => {
  await assert.rejects(
    registrarAbono(4, { monto: "0", fecha: "2026-10-26" }),
    /mayor que cero/,
  );
  await assert.rejects(
    registrarAbono(4, { monto: "1000", fecha: "fecha" }),
    /fecha/,
  );
  await assert.rejects(
    registrarAbono("x", { monto: "1000", fecha: "2026-10-26" }),
    /venta/,
  );
});

test("propaga 401 y 403 en listado, creación y abonos", async () => {
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

    await assert.rejects(listarClientes(), /sesión|permisos/);
    await assert.rejects(listarVentas(), /sesión|permisos/);
    await assert.rejects(
      crearCliente({ nombre: "Cliente", telefono: "3001234567" }),
      /sesión|permisos/,
    );
    await assert.rejects(
      registrarAbono(4, {
        monto: "1000",
        fecha: "2026-10-26",
      }),
      /sesión|permisos/,
    );
  }
});

test("bloquea creación y abonos duplicados concurrentes", async () => {
  let resolverCliente;
  let resolverAbono;
  let llamadas = 0;

  api.post = (url, body) => {
    llamadas += 1;

    return new Promise((resolve) => {
      if (url === "/finanzas/clientes/") {
        resolverCliente = () =>
          resolve({ data: { id: 20, ...body } });
      } else {
        resolverAbono = () => resolve({ data: { id: 4 } });
      }
    });
  };

  const cliente = crearCliente({
    nombre: "Cliente",
    telefono: "3001234567",
  });

  await assert.rejects(
    crearCliente({
      nombre: "Otro cliente",
      telefono: "300 123 4567",
    }),
    OperacionEnCursoError,
  );

  const abono = registrarAbono(4, {
    monto: "1000",
    fecha: "2026-10-26",
  });

  await assert.rejects(
    registrarAbono(4, {
      monto: "2000",
      fecha: "2026-10-26",
    }),
    OperacionEnCursoError,
  );

  assert.equal(llamadas, 2);

  resolverCliente();
  resolverAbono();

  assert.equal((await cliente).id, 20);
  assert.equal((await abono).id, 4);
});

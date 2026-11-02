import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { ApiError, api } from "./api.js";
import { limpiarCacheAdmin } from "./adminCache.js";
import {
  actualizarActivoPresentacion,
  construirPayloadPresentacion,
  crearPresentacion,
  listarPresentaciones,
} from "./presentaciones.js";

const getOriginal = api.get;
const postOriginal = api.post;
const patchOriginal = api.patch;

beforeEach(() => {
  api.get = getOriginal;
  api.post = postOriginal;
  api.patch = patchOriginal;
  limpiarCacheAdmin();
});

afterEach(() => {
  api.get = getOriginal;
  api.post = postOriginal;
  api.patch = patchOriginal;
  limpiarCacheAdmin();
});

test("lista presentaciones y permite filtrar por producto", async () => {
  const solicitudes = [];

  api.get = async (url, config) => {
    solicitudes.push({ url, config });
    return { data: [{ id: 1, porcentaje: 40 }] };
  };

  await listarPresentaciones();
  await listarPresentaciones({ producto: "7" });

  assert.equal(
    solicitudes[0].url,
    "/catalogo/presentaciones/"
  );
  assert.equal(solicitudes[0].config.params, undefined);
  assert.deepEqual(solicitudes[1].config.params, {
    producto: "7",
  });
});

test("construye y envía el payload de creación", async () => {
  let solicitud = null;

  api.post = async (url, body) => {
    solicitud = { url, body };
    return {
      data: {
        id: 3,
        producto: 2,
        porcentaje: 60,
        activo: true,
      },
    };
  };

  const presentacion = await crearPresentacion({
    producto: "2",
    porcentaje: "60",
    activo: true,
  });

  assert.deepEqual(construirPayloadPresentacion({
    producto: "2",
    porcentaje: "60",
    activo: true,
  }), {
    producto: 2,
    porcentaje: 60,
    activo: true,
  });
  assert.equal(
    solicitud.url,
    "/catalogo/presentaciones/"
  );
  assert.equal(solicitud.body.producto, 2);
  assert.equal(solicitud.body.porcentaje, 60);
  assert.equal(presentacion.id, 3);
});

test("rechaza producto y porcentaje inválidos", () => {
  assert.throws(
    () => construirPayloadPresentacion({
      producto: "",
      porcentaje: "40",
    }),
    /producto válido/,
  );

  assert.throws(
    () => construirPayloadPresentacion({
      producto: 1,
      porcentaje: "55",
    }),
    /porcentaje/,
  );
});

test("actualiza únicamente el estado activo", async () => {
  let solicitud = null;

  api.patch = async (url, body) => {
    solicitud = { url, body };
    return { data: { id: 3, activo: false } };
  };

  const presentacion = await actualizarActivoPresentacion(
    3,
    false
  );

  assert.equal(
    solicitud.url,
    "/catalogo/presentaciones/3/"
  );
  assert.deepEqual(solicitud.body, { activo: false });
  assert.equal(presentacion.activo, false);
});

test("propaga 401 y 403 sin simular éxito", async () => {
  for (const status of [401, 403]) {
    api.patch = async () => {
      throw new ApiError({
        status,
        message:
          status === 401
            ? "Tu sesión expiró."
            : "No tienes permisos.",
      });
    };

    await assert.rejects(
      actualizarActivoPresentacion(3, false),
      /sesión|permisos/,
    );
  }
});

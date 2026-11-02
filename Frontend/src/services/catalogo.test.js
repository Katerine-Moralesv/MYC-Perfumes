import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { ApiError, api } from "./api.js";
import { limpiarCacheAdmin } from "./adminCache.js";
import {
  actualizarFamiliaOlfativa,
  crearFamiliaOlfativa,
  eliminarFamiliaOlfativa,
  listarFamiliasOlfativas,
  normalizarNombreFamilia,
  obtenerErrorNombreFamilia,
} from "./catalogo.js";

const getOriginal = api.get;
const postOriginal = api.post;
const patchOriginal = api.patch;
const deleteOriginal = api.delete;

beforeEach(() => {
  api.get = getOriginal;
  api.post = postOriginal;
  api.patch = patchOriginal;
  api.delete = deleteOriginal;
  limpiarCacheAdmin();
});

afterEach(() => {
  api.get = getOriginal;
  api.post = postOriginal;
  api.patch = patchOriginal;
  api.delete = deleteOriginal;
  limpiarCacheAdmin();
});

test("lista las familias olfativas reales", async () => {
  let url = "";

  api.get = async (solicitada) => {
    url = solicitada;
    return {
      data: [
        { id: 1, nombre: "Floral" },
        { id: 2, nombre: "Amaderada" },
      ],
    };
  };

  const familias = await listarFamiliasOlfativas();

  assert.equal(url, "/catalogo/familias-olfativas/");
  assert.equal(familias.length, 2);
});

test("crea una familia olfativa con el endpoint real", async () => {
  let solicitud = null;

  api.post = async (url, body) => {
    solicitud = { url, body };
    return { data: { id: 7, nombre: "Gourmand" } };
  };

  const familia = await crearFamiliaOlfativa("  Gourmand  ");

  assert.equal(
    solicitud.url,
    "/catalogo/familias-olfativas/",
  );
  assert.deepEqual(solicitud.body, { nombre: "Gourmand" });
  assert.equal(familia.id, 7);
});

test("rechaza nombres vacíos antes de enviar", async () => {
  await assert.rejects(
    crearFamiliaOlfativa("   "),
    /obligatorio/,
  );

  await assert.rejects(
    actualizarFamiliaOlfativa(1, "   "),
    /obligatorio/,
  );
});

test("normaliza espacios y detecta duplicados sin distinguir mayúsculas", () => {
  assert.equal(
    normalizarNombreFamilia("  Floral   Suave  "),
    "Floral Suave",
  );

  const familias = [
    { id: 1, nombre: "Floral" },
    { id: 2, nombre: "Amaderada" },
  ];

  assert.equal(
    obtenerErrorNombreFamilia(" floral ", familias),
    "Ya existe una familia olfativa con este nombre.",
  );
  assert.equal(
    obtenerErrorNombreFamilia("FLORAL", familias, 1),
    "",
  );
  assert.equal(
    obtenerErrorNombreFamilia("   ", familias),
    "El nombre de la familia olfativa es obligatorio.",
  );
});

test("actualiza una familia y conserva el contrato PATCH", async () => {
  let solicitud = null;

  api.patch = async (url, body) => {
    solicitud = { url, body };
    return { data: { id: 3, nombre: "Floral Suave" } };
  };

  const familia = await actualizarFamiliaOlfativa(
    3,
    "  Floral   Suave ",
  );

  assert.equal(
    solicitud.url,
    "/catalogo/familias-olfativas/3/",
  );
  assert.deepEqual(solicitud.body, { nombre: "Floral Suave" });
  assert.equal(familia.nombre, "Floral Suave");
});

test("elimina una familia mediante DELETE", async () => {
  let url = "";

  api.delete = async (solicitada) => {
    url = solicitada;
    return { data: "" };
  };

  await eliminarFamiliaOlfativa(8);

  assert.equal(url, "/catalogo/familias-olfativas/8/");
});

test("propaga el conflicto 409 al eliminar una familia asociada", async () => {
  api.delete = async () => {
    throw new ApiError({
      status: 409,
      message:
        "No se puede eliminar la familia olfativa porque tiene productos asociados.",
    });
  };

  await assert.rejects(
    eliminarFamiliaOlfativa(1),
    /productos asociados/,
  );
});

test("propaga 403 al editar o eliminar sin permisos", async () => {
  const error = new ApiError({
    status: 403,
    message: "No tienes permisos para realizar esta acción.",
  });

  api.patch = async () => {
    throw error;
  };
  api.delete = async () => {
    throw error;
  };

  await assert.rejects(
    actualizarFamiliaOlfativa(1, "Nueva"),
    /No tienes permisos/,
  );
  await assert.rejects(
    eliminarFamiliaOlfativa(1),
    /No tienes permisos/,
  );
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
      listarFamiliasOlfativas(),
      /sesión|permisos/,
    );
    await assert.rejects(
      crearFamiliaOlfativa("Gourmand"),
      /sesión|permisos/,
    );
  }
});

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { ApiError, api } from "./api.js";
import {
  actualizarActivo,
  actualizarProducto,
  construirFormDataProducto,
  construirPayloadProducto,
  crearProducto,
  listarProductosAdmin,
} from "./catalogoAdmin.js";
import {
  listarCategorias,
  listarFamiliasOlfativas,
} from "./catalogo.js";

const getOriginal = api.get;
const postOriginal = api.post;
const patchOriginal = api.patch;

function formularioBase() {
  return {
    nombre: "  Perfume Botánico  ",
    descripcion: "  Notas florales  ",
    categoria: "2",
    familias_olfativas: ["3", "4"],
    precio: "125000.00",
    contenido_ml: "100",
    dias_entrega: "2",
    activo: true,
  };
}

beforeEach(() => {
  api.get = getOriginal;
  api.post = postOriginal;
  api.patch = patchOriginal;
});

afterEach(() => {
  api.get = getOriginal;
  api.post = postOriginal;
  api.patch = patchOriginal;
});

test("lista productos desde el endpoint administrativo", async () => {
  let solicitud = null;

  api.get = async (url, config) => {
    solicitud = { url, config };
    return { data: [{ id: 1, nombre: "Perfume" }] };
  };

  const productos = await listarProductosAdmin();

  assert.equal(solicitud.url, "/catalogo/productos/admin/");
  assert.deepEqual(productos, [{ id: 1, nombre: "Perfume" }]);
});

test("carga categorías y familias desde los endpoints existentes", async () => {
  const urls = [];

  api.get = async (url) => {
    urls.push(url);

    if (url.endsWith("/categorias/")) {
      return { data: [{ id: 1, nombre: "Mujer" }] };
    }

    return { data: [{ id: 3, nombre: "Floral" }] };
  };

  const categorias = await listarCategorias();
  const familias = await listarFamiliasOlfativas();

  assert.deepEqual(urls, [
    "/catalogo/categorias/",
    "/catalogo/familias-olfativas/",
  ]);
  assert.deepEqual(categorias, [{ id: 1, nombre: "Mujer" }]);
  assert.deepEqual(familias, [{ id: 3, nombre: "Floral" }]);
});

test("construye el payload JSON con ids y tipos correctos", () => {
  assert.deepEqual(construirPayloadProducto(formularioBase()), {
    nombre: "Perfume Botánico",
    descripcion: "Notas florales",
    categoria: 2,
    familias_olfativas: [3, 4],
    precio: "125000.00",
    contenido_ml: 100,
    dias_entrega: 2,
    activo: true,
  });
});

test("construye FormData con foto y familias múltiples", () => {
  const archivo = new File(["imagen"], "producto.png", {
    type: "image/png",
  });

  const data = construirFormDataProducto(
    formularioBase(),
    archivo,
  );

  assert.equal(data.get("nombre"), "Perfume Botánico");
  assert.equal(data.get("categoria"), "2");
  assert.deepEqual(data.getAll("familias_olfativas"), ["3", "4"]);
  assert.equal(data.get("contenido_ml"), "100");
  assert.equal(data.get("dias_entrega"), "2");
  assert.equal(data.get("activo"), "true");
  assert.equal(data.get("foto").name, "producto.png");
});

test("crea un producto con JSON y actualiza con la respuesta", async () => {
  let solicitud = null;

  api.post = async (url, body) => {
    solicitud = { url, body };
    return {
      data: {
        id: 9,
        nombre: "Perfume Botánico",
        categoria: 2,
        activo: true,
      },
    };
  };

  const producto = await crearProducto({
    formulario: formularioBase(),
  });

  assert.equal(solicitud.url, "/catalogo/productos/");
  assert.equal(solicitud.body.categoria, 2);
  assert.equal(solicitud.body.familias_olfativas.length, 2);
  assert.equal(producto.id, 9);
});

test("crea un producto usando FormData cuando hay foto", async () => {
  let bodyRecibido = null;
  const archivo = new File(["imagen"], "foto.jpg", {
    type: "image/jpeg",
  });

  api.post = async (_url, body) => {
    bodyRecibido = body;
    return { data: { id: 10 } };
  };

  await crearProducto({
    formulario: formularioBase(),
    archivoFoto: archivo,
  });

  assert.ok(bodyRecibido instanceof FormData);
  assert.equal(bodyRecibido.get("foto").name, "foto.jpg");
});

test("actualiza un producto y permite quitar la foto", async () => {
  let solicitud = null;

  api.patch = async (url, body) => {
    solicitud = { url, body };
    return { data: { id: 5, activo: true } };
  };

  await actualizarProducto(5, {
    formulario: formularioBase(),
    quitarFoto: true,
  });

  assert.equal(solicitud.url, "/catalogo/productos/5/");
  assert.equal(solicitud.body.foto, null);
  assert.equal(solicitud.body.categoria, 2);
});

test("actualiza solo el estado activo mediante PATCH", async () => {
  let solicitud = null;

  api.patch = async (url, body) => {
    solicitud = { url, body };
    return { data: { id: 7, activo: false } };
  };

  const producto = await actualizarActivo(7, false);

  assert.equal(solicitud.url, "/catalogo/productos/7/");
  assert.deepEqual(solicitud.body, { activo: false });
  assert.equal(producto.activo, false);
});

test("propaga errores 401 y 403 sin simular éxito", async () => {
  const casos = [
    {
      status: 401,
      message: "Tu sesión expiró. Inicia sesión nuevamente.",
      patron: /sesión expiró/,
    },
    {
      status: 403,
      message: "No tienes permisos para realizar esta acción.",
      patron: /No tienes permisos/,
    },
  ];

  for (const caso of casos) {
    api.patch = async () => {
      throw new ApiError({
        status: caso.status,
        message: caso.message,
      });
    };

    await assert.rejects(
      actualizarActivo(7, false),
      caso.patron,
    );
  }
});

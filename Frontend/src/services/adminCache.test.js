import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, test } from "node:test";

import {
  invalidarCacheAdmin,
  limpiarCacheAdmin,
  obtenerConCache,
} from "./adminCache.js";

const directorio = dirname(fileURLToPath(import.meta.url));

beforeEach(() => {
  limpiarCacheAdmin();
});

afterEach(() => {
  limpiarCacheAdmin();
});

test("la primera consulta carga y la segunda usa la caché", async () => {
  let llamadas = 0;
  const cargar = async () => {
    llamadas += 1;
    return { total: llamadas };
  };

  const primera = await obtenerConCache("prueba:uno", cargar, {
    ttl: 60_000,
  });
  const segunda = await obtenerConCache("prueba:uno", cargar, {
    ttl: 60_000,
  });

  assert.equal(llamadas, 1);
  assert.deepEqual(primera, { total: 1 });
  assert.equal(segunda, primera);
});

test("dos solicitudes simultáneas comparten una sola petición", async () => {
  let llamadas = 0;
  let resolver = null;

  const cargar = () => {
    llamadas += 1;
    return new Promise((resolve) => {
      resolver = resolve;
    });
  };

  const primera = obtenerConCache("prueba:simultanea", cargar);
  const segunda = obtenerConCache("prueba:simultanea", cargar);

  await Promise.resolve();
  assert.equal(llamadas, 1);

  resolver({ id: 1 });

  const [uno, dos] = await Promise.all([primera, segunda]);

  assert.equal(uno, dos);
});

test("invalidar la caché obliga a pedir datos recientes", async () => {
  let llamadas = 0;
  const cargar = async () => {
    llamadas += 1;
    return { version: llamadas };
  };

  await obtenerConCache("prueba:invalidar", cargar);
  invalidarCacheAdmin();
  const actualizado = await obtenerConCache(
    "prueba:invalidar",
    cargar,
  );

  assert.equal(llamadas, 2);
  assert.deepEqual(actualizado, { version: 2 });
});

test("forzar la consulta ignora la caché vigente", async () => {
  let llamadas = 0;
  const cargar = async () => {
    llamadas += 1;
    return llamadas;
  };

  await obtenerConCache("prueba:forzar", cargar);
  const forzado = await obtenerConCache(
    "prueba:forzar",
    cargar,
    { forzar: true },
  );

  assert.equal(llamadas, 2);
  assert.equal(forzado, 2);
});

test("un TTL vencido no devuelve datos viejos", async () => {
  let llamadas = 0;
  const cargar = async () => {
    llamadas += 1;
    return llamadas;
  };

  await obtenerConCache("prueba:ttl", cargar, { ttl: -1 });
  const segunda = await obtenerConCache(
    "prueba:ttl",
    cargar,
    { ttl: -1 },
  );

  assert.equal(llamadas, 2);
  assert.equal(segunda, 2);
});

test("los errores no se guardan en caché", async () => {
  let llamadas = 0;
  const cargar = async () => {
    llamadas += 1;

    if (llamadas === 1) {
      throw new Error("fallo temporal");
    }

    return "ok";
  };

  await assert.rejects(
    obtenerConCache("prueba:error", cargar),
    /fallo temporal/,
  );

  const resultado = await obtenerConCache(
    "prueba:error",
    cargar,
  );

  assert.equal(llamadas, 2);
  assert.equal(resultado, "ok");
});

test("limpiar la caché evita reutilizar datos de otra sesión", async () => {
  const cargarAdminA = async () => ({ usuario: "admin-a" });
  const cargarAdminB = async () => ({ usuario: "admin-b" });

  const primera = await obtenerConCache(
    "usuarios:lista",
    cargarAdminA,
  );

  limpiarCacheAdmin();

  const segunda = await obtenerConCache(
    "usuarios:lista",
    cargarAdminB,
  );

  assert.equal(primera.usuario, "admin-a");
  assert.equal(segunda.usuario, "admin-b");
});

test("el catálogo público no usa la caché administrativa", () => {
  const catalogo = readFileSync(
    join(directorio, "catalogo.js"),
    "utf8",
  );
  const bloqueProductos = catalogo.match(
    /export async function listarProductos[\s\S]*?\n}/,
  )?.[0] || "";

  assert.match(bloqueProductos, /api\.get/);
  assert.doesNotMatch(bloqueProductos, /obtenerConCache/);
});

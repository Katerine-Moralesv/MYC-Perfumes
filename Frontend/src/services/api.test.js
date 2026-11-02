import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { AxiosError } from "axios";

import { normalizeApiError } from "./api.js";

const directorio = dirname(fileURLToPath(import.meta.url));
const fuenteApi = readFileSync(
  join(directorio, "api.js"),
  "utf8",
);

test("un timeout de Render no se confunde con un error de CORS", () => {
  const error = new AxiosError(
    "timeout of 15000ms exceeded",
    "ECONNABORTED",
  );

  const normalizado = normalizeApiError(error);

  assert.equal(normalizado.isTimeout, true);
  assert.equal(normalizado.isNetworkError, true);
  assert.match(normalizado.message, /tardó demasiado/i);
  assert.doesNotMatch(
    normalizado.message,
    /No se pudo conectar con el servidor/,
  );
});

test("un fallo sin respuesta se informa como problema de conexión", () => {
  const error = new AxiosError(
    "Network Error",
    "ERR_NETWORK",
  );

  const normalizado = normalizeApiError(error);

  assert.equal(normalizado.isNetworkError, true);
  assert.equal(normalizado.isTimeout, false);
  assert.match(
    normalizado.message,
    /No se pudo conectar con el servidor/,
  );
});

test("la renovación de JWT comparte una sola promesa en curso", () => {
  assert.match(fuenteApi, /let refreshPromise = null/);
  assert.match(fuenteApi, /if \(refreshPromise\)/);
  assert.match(fuenteApi, /return refreshPromise/);
  assert.match(
    fuenteApi,
    /refreshPromise = refreshClient\s*\.post/,
  );
  assert.match(
    fuenteApi,
    /\.finally\(\(\) => \{\s*refreshPromise = null;/,
  );
});

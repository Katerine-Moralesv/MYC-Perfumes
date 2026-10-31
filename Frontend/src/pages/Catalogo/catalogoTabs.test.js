import assert from "node:assert/strict";
import { test } from "node:test";

import { PESTANAS_CATALOGO } from "./catalogoTabs.js";

test("Catálogo conserva solo Productos y Familias olfativas", () => {
  assert.deepEqual(
    PESTANAS_CATALOGO.map((pestana) => pestana.etiqueta),
    ["Productos", "Familias olfativas"],
  );
  assert.deepEqual(
    PESTANAS_CATALOGO.map((pestana) => pestana.valor),
    ["productos", "familias"],
  );
});

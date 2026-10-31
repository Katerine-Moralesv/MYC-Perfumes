import assert from "node:assert/strict";
import { test } from "node:test";

import { detalleCompatibleConPresentacion } from "./asignacionesCompra.js";

const presentacion40 = {
  id: 10,
  producto: 1,
  porcentaje: 40,
};
const presentacion70 = {
  id: 11,
  producto: 1,
  porcentaje: 70,
};
const presentacionOtroProducto = {
  id: 20,
  producto: 2,
  porcentaje: 70,
};

test("rechaza el mismo perfume con porcentaje distinto", () => {
  const detalle = {
    producto: 1,
    porcentaje_recarga: 70,
    presentacion: null,
  };

  assert.equal(
    detalleCompatibleConPresentacion(detalle, presentacion40),
    false,
  );
});

test("permite el mismo producto y porcentaje", () => {
  const detalle = {
    producto: 1,
    porcentaje_recarga: 70,
    presentacion: null,
  };

  assert.equal(
    detalleCompatibleConPresentacion(detalle, presentacion70),
    true,
  );
});

test("respeta el identificador de presentación solicitado", () => {
  const detalle = {
    producto: 1,
    porcentaje_recarga: 70,
    presentacion: 11,
  };

  assert.equal(
    detalleCompatibleConPresentacion(detalle, presentacion70),
    true,
  );
  assert.equal(
    detalleCompatibleConPresentacion(
      detalle,
      { ...presentacion70, id: 99 },
    ),
    false,
  );
});

test("rechaza un producto diferente aunque coincida el porcentaje", () => {
  const detalle = {
    producto: 1,
    porcentaje_recarga: 70,
    presentacion: null,
  };

  assert.equal(
    detalleCompatibleConPresentacion(
      detalle,
      presentacionOtroProducto,
    ),
    false,
  );
});

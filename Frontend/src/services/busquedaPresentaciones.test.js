import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MENSAJE_PORCENTAJE_INVALIDO,
  construirOpcionesPresentaciones,
  construirOpcionesProductos,
  filtrarSugerencias,
  porcentajeRecargaValido,
  resolverPresentacion,
} from "./busquedaPresentaciones.js";

const productos = [
  {
    id: 1,
    nombre: "Moshino",
    contenido_ml: 100,
    activo: true,
    precio: "120000.00",
  },
  {
    id: 2,
    nombre: "Perfume Floral",
    contenido_ml: 50,
    activo: true,
    precio: "90000.00",
  },
  {
    id: 3,
    nombre: "Producto inactivo",
    contenido_ml: 80,
    activo: false,
  },
];

const presentaciones = [
  { id: 10, producto: 1, porcentaje: 40, activo: true },
  { id: 11, producto: 1, porcentaje: 60, activo: true },
  { id: 12, producto: 1, porcentaje: 70, activo: true },
  { id: 13, producto: 1, porcentaje: 80, activo: true },
  { id: 20, producto: 2, porcentaje: 40, activo: false },
];

const productosPorId = new Map(
  productos.map((producto) => [String(producto.id), producto]),
);
const presentacionesActivas = presentaciones.filter(
  (presentacion) => presentacion.activo,
);

test("acepta únicamente los porcentajes permitidos", () => {
  for (const valor of ["40", "60", "70", "80"]) {
    assert.equal(porcentajeRecargaValido(valor), true);
  }

  for (const valor of ["0", "50", "90", "-10", "40.5", "abc", ""]) {
    assert.equal(porcentajeRecargaValido(valor), false);
  }

  assert.match(MENSAJE_PORCENTAJE_INVALIDO, /40 %/);
});

test("resuelve la presentación real por producto y porcentaje", () => {
  assert.equal(
    resolverPresentacion(presentaciones, "1", "60")?.id,
    11,
  );
  assert.equal(
    resolverPresentacion(presentaciones, 1, "80")?.id,
    13,
  );
  assert.equal(
    resolverPresentacion(presentaciones, "1", "50"),
    null,
  );
  assert.equal(
    resolverPresentacion(presentaciones, "2", "40"),
    null,
  );
  assert.equal(
    resolverPresentacion(presentaciones, "", "40"),
    null,
  );
});

test("construye productos activos con presentaciones disponibles", () => {
  const opciones = construirOpcionesProductos(
    productos,
    presentaciones,
  );

  assert.deepEqual(
    opciones.map((item) => item.label),
    ["Moshino"],
  );
  assert.equal(opciones[0].description, "100 ml");
  assert.equal(opciones[0].searchText.includes("Moshino"), true);
});

test("construye opciones de presentación con porcentaje y recarga", () => {
  const opciones = construirOpcionesPresentaciones(
    presentacionesActivas,
    productosPorId,
  );
  const sinRecarga = opciones.find((item) => item.id === 10);
  const recarga = opciones.find((item) => item.id === 11);
  const recarga70 = opciones.find((item) => item.id === 12);
  const recarga80 = opciones.find((item) => item.id === 13);

  assert.equal(sinRecarga.label, "Moshino · 100 ml");
  assert.equal(sinRecarga.description, "40 % · Sin recarga");
  assert.equal(recarga.description, "60 % · Recarga");
  assert.equal(recarga70.description, "70 % · Recarga");
  assert.equal(recarga80.description, "80 % · Recarga");
});

test("busca productos por nombre y detecta ausencia de coincidencias", () => {
  const opciones = construirOpcionesProductos(
    productos,
    presentaciones,
  );

  assert.deepEqual(
    filtrarSugerencias(opciones, "mosh").map((item) => item.id),
    [1],
  );
  assert.equal(
    filtrarSugerencias(opciones, "inexistente").length,
    0,
  );
});

test("filtra sugerencias por nombre sin distinguir tildes", () => {
  const opciones = construirOpcionesPresentaciones(
    presentacionesActivas,
    productosPorId,
  );

  assert.deepEqual(
    filtrarSugerencias(opciones, "moshino").map((item) => item.id),
    [10, 11, 12, 13],
  );
  assert.deepEqual(
    filtrarSugerencias(opciones, "PERFUME").map((item) => item.id),
    [],
  );
  assert.equal(
    filtrarSugerencias(opciones, "no existe").length,
    0,
  );
});

test("limita la cantidad de sugerencias", () => {
  const opciones = construirOpcionesPresentaciones(
    presentacionesActivas,
    productosPorId,
  );

  assert.equal(
    filtrarSugerencias(opciones, "", 2).length,
    2,
  );
});

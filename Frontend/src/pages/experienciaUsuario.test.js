import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const directorio = dirname(fileURLToPath(import.meta.url));

const paginas = [
  "Catalogo/Catalogo.jsx",
  "Compras/Compras.jsx",
  "Ventas/Ventas.jsx",
  "Clientes/Clientes.jsx",
  "Pedidos/Pedidos.jsx",
  "Dashboard/Dashboard.jsx",
].map((archivo) => ({
  archivo,
  contenido: readFileSync(join(directorio, archivo), "utf8"),
}));

const frasesTecnicas = [
  "Datos reales de Django",
  "guardan en Django",
  "Django calcula",
  "Django valida",
  "Django asumirá",
  "se consultan y registran en Django",
  "se gestionan en Django",
  "Ventas creadas en Django",
  "Historial real registrado",
  "endpoint de abonos",
];

test("las páginas de administración no muestran frases técnicas", () => {
  for (const { archivo, contenido } of paginas) {
    for (const frase of frasesTecnicas) {
      assert.equal(
        contenido.includes(frase),
        false,
        `${archivo} todavía contiene: ${frase}`,
      );
    }
  }
});

test("las páginas de administración no mencionan Django", () => {
  for (const { archivo, contenido } of paginas) {
    assert.doesNotMatch(
      contenido,
      /\bDjango\b/,
      `${archivo} menciona Django`,
    );
  }
});

test("los porcentajes renderizados usan espacio antes del símbolo", () => {
  for (const { archivo, contenido } of paginas) {
    assert.doesNotMatch(
      contenido,
      /porcentaje(?:_recarga)?\}%/,
      `${archivo} tiene un porcentaje pegado al símbolo %`,
    );
  }
});

test("los porcentajes de venta usan el formato exacto y no se traducen", () => {
  const ventas = paginas.find(
    ({ archivo }) => archivo === "Ventas/Ventas.jsx",
  );

  assert.match(ventas.contenido, /translate="no"/);
  for (const etiqueta of ["40 %", "60 %", "70 %", "80 %"]) {
    assert.equal(
      ventas.contenido.includes(`<span>${etiqueta}</span>`),
      true,
      `Falta la etiqueta ${etiqueta}`,
    );
  }
  assert.doesNotMatch(ventas.contenido, /por ciento/i);
});

test("Compras conserva la opción para crear proveedores", () => {
  const compras = paginas.find(
    ({ archivo }) => archivo === "Compras/Compras.jsx",
  );

  assert.match(compras.contenido, /\+ Nuevo proveedor/);
  assert.match(compras.contenido, /<h3>Nuevo proveedor<\/h3>/);
});

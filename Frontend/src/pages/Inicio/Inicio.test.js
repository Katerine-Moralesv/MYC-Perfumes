import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const directorio = dirname(fileURLToPath(import.meta.url));
const pagina = readFileSync(join(directorio, "Inicio.jsx"), "utf8");
const estilos = readFileSync(join(directorio, "Inicio.css"), "utf8");

test("el inicio conserva el hero editorial solicitado", () => {
  assert.match(
    pagina,
    /El aroma correcto habla <em>sin decir una palabra<\/em>\./,
  );
  assert.match(
    pagina,
    /Explora una selección de fragancias y encuentra la que mejor/,
  );
  assert.match(pagina, /Explorar catálogo/);
  assert.match(pagina, /src=\{heroImagen\}/);
  assert.doesNotMatch(pagina, /photo-1673710672680/);
});

test("el inicio conserva la marca y la selección real de productos", () => {
  assert.match(pagina, /<strong>Perfumes MYC<\/strong>/);
  assert.match(pagina, /slice\(0, 3\)/);
  assert.match(pagina, /variante="destacado"/);
  assert.match(pagina, /<h2>Más vendidos<\/h2>/);
  assert.match(pagina, />\s*Ver todos\s*</);
});

test("el inicio usa la paleta pública y dos columnas en móvil", () => {
  assert.match(estilos, /#f5e8d8/i);
  assert.match(estilos, /#d8dcc9/i);
  assert.match(estilos, /#383438/i);
  assert.match(estilos, /#fff9f3/i);
  assert.match(estilos, /@media \(max-width: 560px\)/);
  assert.match(
    estilos,
    /\.inicio-home \.inicio-destacados-grid \{\s*grid-template-columns: repeat\(2,/,
  );
});

test("el catálogo público actualiza solo colores y conserva su estructura", () => {
  assert.match(pagina, /inicio-catalogo-encabezado/);
  assert.match(pagina, /inicio-busqueda/);
  assert.match(pagina, /inicio-filtros/);
  assert.match(pagina, /inicio-sin-resultados/);
  assert.match(pagina, /vista === "catalogo" \? " inicio-catalogo"/);
  assert.match(
    estilos,
    /\.inicio-catalogo \.inicio-filtros button\.activo/,
  );
  assert.match(estilos, /background: #d8dcc9/);
  assert.match(estilos, /background: #fff9f3/);
});

test("Nosotros actualiza solo colores y conserva su estructura", () => {
  assert.match(pagina, /inicio-nosotros-vista/);
  assert.match(pagina, /nosotros-editorial-hero/);
  assert.match(pagina, /nosotros-filosofia/);
  assert.match(pagina, /nosotros-cierre/);
  assert.match(
    estilos,
    /\.nosotros-editorial-texto \{\s*padding:[\s\S]*?background: #fff9f3;\s*color: #383438;/,
  );
  assert.match(
    estilos,
    /\.nosotros-boton \{\s*border-color: #bfc7ad;\s*background: #d8dcc9;\s*color: #383438;/,
  );
  assert.match(estilos, /background: #d8dcc9/);
  assert.match(estilos, /color: #383438/);
});

test("Nosotros conserva acceso directo y recarga de la vista", () => {
  assert.match(pagina, /obtenerVistaDesdeUrl/);
  assert.match(pagina, /hashchange/);
  assert.match(pagina, /window\.history\.replaceState/);
  assert.match(pagina, /inicio-nosotros-vista/);
});

test("el asistente conserva el flujo real de compra", () => {
  assert.match(pagina, /ChatbotCompra/);
  assert.match(pagina, /registrarPedido/);
  assert.match(pagina, /Elegir recarga/);
  assert.match(pagina, /Registrar pedido/);
  assert.match(pagina, /Producto elegido/);
});

test("las páginas públicas no heredan el fondo floral", () => {
  const bloqueBase = estilos.match(/\.inicio \{[\s\S]*?\}/)?.[0] || "";

  assert.doesNotMatch(estilos, /--inicio-flores/);
  assert.doesNotMatch(
    estilos,
    /\.inicio\.inicio-(catalogo|nosotros|seleccion)\s*\{/,
  );
  assert.doesNotMatch(bloqueBase, /fondo-floral/);
  assert.match(bloqueBase, /radial-gradient/);
});

test("Mi colección actualiza solo colores y conserva su estructura", () => {
  assert.match(pagina, /mi-seleccion-vista/);
  assert.match(pagina, /mi-seleccion-vacia/);
  assert.match(pagina, /mi-seleccion-item/);
  assert.match(pagina, /mi-seleccion-resumen/);
  assert.match(pagina, /vista === "seleccion" \? " inicio-seleccion"/);
  assert.match(estilos, /\.inicio-seleccion \.mi-seleccion-vacia-icono \{/);
  assert.match(
    estilos,
    /\.inicio-seleccion \.mi-seleccion-resumen \.inicio-boton-principal \{/,
  );
  assert.match(estilos, /background: #d8dcc9/);
  assert.match(estilos, /background: #fff9f3/);
});

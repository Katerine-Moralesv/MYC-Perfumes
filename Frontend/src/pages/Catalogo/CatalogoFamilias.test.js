import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const directorio = dirname(fileURLToPath(import.meta.url));
const pagina = readFileSync(join(directorio, "Catalogo.jsx"), "utf8");
const estilos = readFileSync(join(directorio, "Catalogo.css"), "utf8");

test("cada familia ofrece editar y eliminar sin duplicar tarjetas", () => {
  assert.match(pagina, /className="categoria-card-acciones"/);
  assert.match(pagina, /abrirEditarFamilia\(familia\)/);
  assert.match(pagina, /abrirEliminarFamilia\(familia\)/);
  assert.match(
    pagina,
    /key=\{familia\.id\}\s*>\s*<div className="categoria-card-superior">/,
  );
});

test("la edición muestra el nombre actual y actualiza la tarjeta", () => {
  assert.match(
    pagina,
    /setNombreEdicionFamilia\(familia\.nombre \|\| ""\)/,
  );
  assert.match(pagina, /actualizarFamiliaOlfativa\(/);
  assert.match(
    pagina,
    /actuales\s*\.map\(\(familia\) =>\s*String\(familia\.id\) === String\(actualizada\.id\)/,
  );
});

test("cancelar la edición cierra sin llamar a la API", () => {
  const cierre = pagina.match(
    /function cerrarEditarFamilia\(\) \{[\s\S]*?\n  \}/,
  );

  assert.ok(cierre);
  assert.doesNotMatch(
    cierre[0],
    /actualizarFamiliaOlfativa|api\.(patch|put|delete)/,
  );
  assert.match(cierre[0], /setFamiliaEditando\(null\)/);
});

test("la confirmación de borrado informa los productos asociados", () => {
  assert.match(pagina, /familiaEliminando\.cantidad > 0/);
  assert.match(pagina, /productos asociados/);
  assert.match(pagina, /eliminarFamiliaOlfativa\(/);
  assert.match(
    pagina,
    /disabled=\{\s*eliminandoFamilia \|\|\s*familiaEliminando\.cantidad > 0\s*\}/,
  );
});

test("editar y eliminar actualizan el listado y muestran errores de API", () => {
  assert.match(
    pagina,
    /setFamilias\(\(actuales\) =>\s*actuales\s*\.map/,
  );
  assert.match(
    pagina,
    /setFamilias\(\(actuales\) =>\s*actuales\.filter/,
  );
  assert.match(pagina, /errorEdicion\?\.message/);
  assert.match(pagina, /errorEliminar\?\.message/);
  assert.match(estilos, /\.categoria-card \.categoria-accion\.eliminar/);
  assert.match(estilos, /\.catalogo-modal\.catalogo-modal-compacto/);
});

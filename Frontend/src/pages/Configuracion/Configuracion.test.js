import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const directorio = dirname(fileURLToPath(import.meta.url));
const pagina = readFileSync(
  join(directorio, "Configuracion.jsx"),
  "utf8",
);

test("Configuración usa el mismo rol efectivo en perfil y usuarios", () => {
  assert.match(pagina, /rolVisible\s*=\s*etiquetaRolUsuario\(user\)/);
  assert.match(pagina, /etiquetaRolUsuario\(admin\)/);
  assert.match(pagina, /rolNormalizadoUsuario\(admin\)/);
  assert.match(pagina, /rolNormalizadoUsuario\(user\)/);
  assert.doesNotMatch(pagina, /admin\.rol === "admin" \? "Administrador"/);
});

test("Configuración conserva la edición y no permite autoeliminarse", () => {
  assert.match(pagina, /abrirEditarAdministrador/);
  assert.match(pagina, /guardarAdministrador/);
  assert.match(pagina, /disabled=\{esMiCuenta\}/);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  esUsuarioAdministrador,
  etiquetaRolUsuario,
  rolNormalizadoUsuario,
} from "./roles.js";

test("un usuario admin muestra rol Administrador", () => {
  const usuario = { rol: "admin", is_superuser: false };

  assert.equal(esUsuarioAdministrador(usuario), true);
  assert.equal(rolNormalizadoUsuario(usuario), "admin");
  assert.equal(etiquetaRolUsuario(usuario), "Administrador");
});

test("un superusuario con rol persistido vendedor muestra Administrador", () => {
  const usuario = { rol: "vendedor", is_superuser: true };

  assert.equal(esUsuarioAdministrador(usuario), true);
  assert.equal(rolNormalizadoUsuario(usuario), "admin");
  assert.equal(etiquetaRolUsuario(usuario), "Administrador");
});

test("un vendedor normal muestra rol Vendedor", () => {
  const usuario = { rol: "vendedor", is_superuser: false };

  assert.equal(esUsuarioAdministrador(usuario), false);
  assert.equal(rolNormalizadoUsuario(usuario), "vendedor");
  assert.equal(etiquetaRolUsuario(usuario), "Vendedor");
});

test("maneja usuarios ausentes sin otorgar administración", () => {
  assert.equal(esUsuarioAdministrador(null), false);
  assert.equal(rolNormalizadoUsuario(undefined), "vendedor");
  assert.equal(etiquetaRolUsuario(null), "Vendedor");
});

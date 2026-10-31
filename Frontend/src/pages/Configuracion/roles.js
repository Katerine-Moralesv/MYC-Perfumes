export function esUsuarioAdministrador(usuario) {
  return Boolean(
    usuario &&
      (usuario.rol === "admin" || usuario.is_superuser === true),
  );
}

export function rolNormalizadoUsuario(usuario) {
  return esUsuarioAdministrador(usuario) ? "admin" : "vendedor";
}

export function etiquetaRolUsuario(usuario) {
  return esUsuarioAdministrador(usuario)
    ? "Administrador"
    : "Vendedor";
}

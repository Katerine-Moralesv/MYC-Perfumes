import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const directorio = dirname(fileURLToPath(import.meta.url));
const paginaDir = join(directorio);

const app = readFileSync(
  join(paginaDir, "App.jsx"),
  "utf8",
);
const dashboard = readFileSync(
  join(paginaDir, "pages/Dashboard/Dashboard.jsx"),
  "utf8",
);
const auth = readFileSync(
  join(paginaDir, "context/AuthContext.jsx"),
  "utf8",
);
const servicio = readFileSync(
  join(paginaDir, "services/notificaciones.js"),
  "utf8",
);

test("App mantiene un único listener foreground para administradores", () => {
  assert.match(app, /useNotificacionesAdmin/);
  assert.match(app, /habilitado: isAdmin/);
  assert.match(app, /notificaciones\.aviso/);
  assert.match(app, /abrirPedidoDesdeNotificacion/);
  assert.doesNotMatch(dashboard, /useNotificacionesAdmin\(/);
  assert.match(
    dashboard,
    /Configuracion[\s\S]*?notificaciones=\{notificaciones\}/,
  );
});

test("la caché administrativa se limpia al cambiar de sesión", () => {
  assert.match(auth, /limpiarCacheAdmin/);
  assert.match(dashboard, /invalidarCacheAdmin/);
  assert.match(dashboard, /versionSeccion/);
});

test("App persiste, recupera y limpia el pedido pendiente", () => {
  assert.match(app, /obtenerPedidoPendienteInicial/);
  assert.match(app, /guardarPedidoPendiente/);
  assert.match(app, /borrarPedidoPendiente/);
  assert.match(app, /resolverPedidoPendiente/);
  assert.match(servicio, /sessionStorage/);
  assert.match(servicio, /CLAVE_PEDIDO_PENDIENTE/);
});

test("el logout intenta desactivar antes de limpiar la sesión", () => {
  assert.match(auth, /cerrarNotificaciones/);
  assert.match(auth, /getAccessToken/);
  assert.match(auth, /void cerrarNotificaciones/);
  assert.doesNotMatch(auth, /localStorage/);

  const posicionDesactivar = auth.indexOf(
    "limpiarNotificacionesDeSesion();",
  );
  const posicionLimpiarJwt = auth.indexOf("clearTokens();");

  assert.ok(posicionDesactivar >= 0);
  assert.ok(posicionLimpiarJwt >= 0);
  assert.ok(posicionDesactivar < posicionLimpiarJwt);
});

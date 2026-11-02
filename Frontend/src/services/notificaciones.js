import { api } from "./api.js";
import { revocarTokenFCM } from "./firebase.js";

export const CLAVE_TOKEN_FCM = "myc_fcm_token";
export const CLAVE_PEDIDO_PENDIENTE = "myc_pedido_pendiente";
export const TIPO_MENSAJE_SW = "MYC_PEDIDO_NOTIFICACION";

function ventanaActual(windowRef) {
  if (windowRef) return windowRef;

  return typeof window !== "undefined" ? window : null;
}

function navegadorActual(navigatorRef) {
  if (navigatorRef) return navigatorRef;

  return typeof navigator !== "undefined" ? navigator : null;
}

function notificacionActual(NotificationRef) {
  if (NotificationRef) return NotificationRef;

  return typeof Notification !== "undefined"
    ? Notification
    : null;
}

function almacenamientoLocal(storage) {
  if (storage) return storage;

  try {
    return ventanaActual()?.localStorage || null;
  } catch {
    return null;
  }
}

function almacenamientoSesion(storage) {
  if (storage) return storage;

  try {
    return ventanaActual()?.sessionStorage || null;
  } catch {
    return null;
  }
}

export function evaluarSoporteNavegador(opciones = {}) {
  const ventana = ventanaActual(opciones.windowRef);
  const navegador = navegadorActual(opciones.navigatorRef);
  const Notificacion = notificacionActual(
    opciones.NotificationRef,
  );

  if (!ventana || !navegador) {
    return {
      soportado: false,
      motivo:
        "No se pudo detectar un navegador compatible con notificaciones.",
    };
  }

  if (!("serviceWorker" in navegador)) {
    return {
      soportado: false,
      motivo: "Este navegador no soporta Service Workers.",
    };
  }

  if (!("PushManager" in ventana)) {
    return {
      soportado: false,
      motivo: "Este navegador no soporta notificaciones push.",
    };
  }

  if (
    !Notificacion ||
    typeof Notificacion.requestPermission !== "function"
  ) {
    return {
      soportado: false,
      motivo: "Este navegador no permite notificaciones web.",
    };
  }

  return { soportado: true, motivo: "" };
}

export async function solicitarPermisoNotificaciones(
  NotificationRef,
) {
  const Notificacion = notificacionActual(NotificationRef);

  if (
    !Notificacion ||
    typeof Notificacion.requestPermission !== "function"
  ) {
    throw new Error(
      "Este navegador no permite solicitar notificaciones.",
    );
  }

  const permiso = await Notificacion.requestPermission();

  if (permiso !== "granted") {
    throw new Error(
      permiso === "denied"
        ? "El permiso de notificaciones fue denegado. Puedes habilitarlo desde la configuración del navegador."
        : "No se concedió el permiso de notificaciones.",
    );
  }

  return permiso;
}

export async function registrarDispositivo(
  token,
  plataforma = "web",
) {
  const valor = String(token ?? "").trim();

  if (!valor) {
    throw new Error("El token FCM del dispositivo no es válido.");
  }

  const respuesta = await api.post(
    "/notificaciones/dispositivos/",
    {
      token: valor,
      plataforma,
    },
  );

  return respuesta.data;
}

export async function desactivarDispositivo(
  token,
  { accessToken = "", skipAuthRefresh = false } = {},
) {
  const valor = String(token ?? "").trim();

  if (!valor) {
    return { desactivado: false };
  }

  const cuerpo = { token: valor };
  const configuracion = {};

  if (accessToken) {
    configuracion.headers = {
      Authorization: `Bearer ${accessToken}`,
    };
  }

  if (skipAuthRefresh) {
    configuracion.skipAuthRefresh = true;
  }

  const respuesta =
    Object.keys(configuracion).length > 0
      ? await api.post(
          "/notificaciones/dispositivos/desactivar/",
          cuerpo,
          configuracion,
        )
      : await api.post(
          "/notificaciones/dispositivos/desactivar/",
          cuerpo,
        );

  return respuesta.data;
}

export async function cerrarNotificaciones({
  token,
  accessToken = "",
  storage,
  desactivar = desactivarDispositivo,
  revocar = revocarTokenFCM,
  limpiar = borrarTokenLocal,
} = {}) {
  const tokenFcm = String(
    token ?? leerTokenLocal(storage) ?? "",
  ).trim();

  if (!tokenFcm) {
    return { desactivado: false, token: "" };
  }

  const tokenSigueSiendoElMismo = () => {
    const actual = leerTokenLocal(storage);
    return !actual || actual === tokenFcm;
  };

  try {
    try {
      await desactivar(tokenFcm, {
        accessToken,
        skipAuthRefresh: true,
      });
    } catch {
      // El logout no debe fallar si el backend no responde.
    }

    if (tokenSigueSiendoElMismo()) {
      try {
        await revocar();
      } catch {
        // El logout no debe fallar si Firebase no responde.
      }
    }
  } finally {
    if (tokenSigueSiendoElMismo()) {
      limpiar(storage);
    }
  }

  return { desactivado: true, token: tokenFcm };
}

export function guardarTokenLocal(token, storage) {
  const almacenamiento = almacenamientoLocal(storage);

  if (!almacenamiento) return false;

  try {
    almacenamiento.setItem(CLAVE_TOKEN_FCM, String(token));
    return true;
  } catch {
    return false;
  }
}

export function leerTokenLocal(storage) {
  const almacenamiento = almacenamientoLocal(storage);

  if (!almacenamiento) return "";

  try {
    return almacenamiento.getItem(CLAVE_TOKEN_FCM) || "";
  } catch {
    return "";
  }
}

export function borrarTokenLocal(storage) {
  const almacenamiento = almacenamientoLocal(storage);

  if (!almacenamiento) return false;

  try {
    almacenamiento.removeItem(CLAVE_TOKEN_FCM);
    return true;
  } catch {
    return false;
  }
}

function normalizarPedidoId(valor) {
  const numero = Number(valor);

  if (!Number.isInteger(numero) || numero <= 0) {
    return null;
  }

  return numero;
}

export function guardarPedidoPendiente(pedidoId, storage) {
  const numero = normalizarPedidoId(pedidoId);
  const almacenamiento = almacenamientoSesion(storage);

  if (!numero || !almacenamiento) return false;

  try {
    almacenamiento.setItem(
      CLAVE_PEDIDO_PENDIENTE,
      String(numero),
    );
    return true;
  } catch {
    return false;
  }
}

export function leerPedidoPendiente(storage) {
  const almacenamiento = almacenamientoSesion(storage);

  if (!almacenamiento) return null;

  try {
    return normalizarPedidoId(
      almacenamiento.getItem(CLAVE_PEDIDO_PENDIENTE),
    );
  } catch {
    return null;
  }
}

export function borrarPedidoPendiente(storage) {
  const almacenamiento = almacenamientoSesion(storage);

  if (!almacenamiento) return false;

  try {
    almacenamiento.removeItem(CLAVE_PEDIDO_PENDIENTE);
    return true;
  } catch {
    return false;
  }
}

export function resolverPedidoPendiente({
  pedidoPendiente,
  isAuthenticated,
  status,
} = {}) {
  if (!pedidoPendiente) {
    return { accion: "ninguna", pedidoId: null };
  }

  if (isAuthenticated) {
    return { accion: "abrir", pedidoId: pedidoPendiente };
  }

  if (status === "anonymous") {
    return { accion: "login", pedidoId: pedidoPendiente };
  }

  return { accion: "esperar", pedidoId: pedidoPendiente };
}

export function extraerPedidoDeMensaje(payload) {
  const datos =
    payload?.data && typeof payload.data === "object"
      ? payload.data
      : payload || {};

  const numero = Number(
    datos.pedido_id ?? datos.pedidoId,
  );

  if (!Number.isInteger(numero) || numero <= 0) {
    return null;
  }

  return {
    pedidoId: numero,
    titulo:
      datos.titulo ||
      payload?.notification?.title ||
      `Nuevo pedido #${numero}`,
    cuerpo:
      datos.cuerpo ||
      payload?.notification?.body ||
      "Una clienta registró un pedido en MYC Perfumes.",
  };
}

export function crearManejadorMensajeForeground(mostrarAviso) {
  return (payload) => {
    const pedido = extraerPedidoDeMensaje(payload);

    if (!pedido) return null;

    if (typeof mostrarAviso === "function") {
      mostrarAviso(pedido);
    }

    return pedido;
  };
}

export function leerPedidoDeMensajeSW(mensaje) {
  let valor = mensaje;

  if (typeof valor === "string") {
    try {
      valor = JSON.parse(valor);
    } catch {
      return null;
    }
  }

  if (!valor || typeof valor !== "object") {
    return null;
  }

  if (valor.type && valor.type !== TIPO_MENSAJE_SW) {
    return null;
  }

  const numero = Number(valor.pedidoId ?? valor.pedido_id);

  if (!Number.isInteger(numero) || numero <= 0) {
    return null;
  }

  return numero;
}

export function leerPedidoDesdeUrl(locationRef) {
  const ubicacion = locationRef ?? ventanaActual()?.location;

  if (!ubicacion) return null;

  try {
    const url = new URL(
      ubicacion.href || String(ubicacion),
      "https://myc.local",
    );
    const numero = Number(url.searchParams.get("pedido"));

    if (!Number.isInteger(numero) || numero <= 0) {
      return null;
    }

    return numero;
  } catch {
    return null;
  }
}

export function limpiarPedidoDeUrl(opciones = {}) {
  const ubicacion =
    opciones.locationRef ?? ventanaActual()?.location;
  const historial =
    opciones.historyRef ?? ventanaActual()?.history;

  if (!ubicacion || !historial?.replaceState) return false;

  try {
    const url = new URL(
      ubicacion.href || String(ubicacion),
      "https://myc.local",
    );

    url.searchParams.delete("pedido");
    historial.replaceState(
      historial.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );

    return true;
  } catch {
    return false;
  }
}

export function obtenerPedidoPendienteInicial({
  locationRef,
  storage,
} = {}) {
  const desdeUrl = leerPedidoDesdeUrl(locationRef);

  if (desdeUrl) {
    guardarPedidoPendiente(desdeUrl, storage);
    return desdeUrl;
  }

  return leerPedidoPendiente(storage);
}

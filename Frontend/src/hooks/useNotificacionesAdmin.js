import { useCallback, useEffect, useState } from "react";

import {
  escucharMensajesForeground,
  obtenerTokenFCM,
  revocarTokenFCM,
} from "../services/firebase.js";
import {
  borrarTokenLocal,
  crearManejadorMensajeForeground,
  desactivarDispositivo,
  evaluarSoporteNavegador,
  guardarTokenLocal,
  leerTokenLocal,
  registrarDispositivo,
  solicitarPermisoNotificaciones,
} from "../services/notificaciones.js";

// Recuerda en este navegador que el administrador desactivó las
// notificaciones a propósito, para no reactivarlas solas al iniciar
// sesión. No guarda datos sensibles.
const CLAVE_DESACTIVADO_MANUAL = "myc_fcm_desactivado_manual";

const ICONO_NOTIFICACION = "/favicon.svg";

function permisoActual() {
  if (typeof Notification === "undefined") return "default";

  return Notification.permission || "default";
}

function leerDesactivadoManual() {
  try {
    return (
      typeof window !== "undefined" &&
      window.localStorage.getItem(CLAVE_DESACTIVADO_MANUAL) === "1"
    );
  } catch {
    return false;
  }
}

function guardarDesactivadoManual(valor) {
  try {
    if (typeof window === "undefined") return;

    if (valor) {
      window.localStorage.setItem(CLAVE_DESACTIVADO_MANUAL, "1");
    } else {
      window.localStorage.removeItem(CLAVE_DESACTIVADO_MANUAL);
    }
  } catch {
    // Sin almacenamiento local se mantiene el comportamiento manual.
  }
}

/**
 * Cuando la pestaña está visible pero la ventana no tiene el foco
 * (otra aplicación encima, segundo monitor), Firebase entrega el
 * mensaje a la página y NO muestra la notificación del sistema. En ese
 * caso se muestra aquí, con el mismo "tag" que usa el Service Worker
 * para que nunca aparezca duplicada.
 */
async function mostrarNotificacionSistema(pedido) {
  if (
    typeof document === "undefined" ||
    typeof navigator === "undefined" ||
    !navigator.serviceWorker ||
    permisoActual() !== "granted"
  ) {
    return;
  }

  if (document.visibilityState === "visible" && document.hasFocus()) {
    // El administrador está mirando la app: basta con el aviso interno.
    return;
  }

  try {
    const registro = await navigator.serviceWorker.getRegistration("/");

    if (!registro) return;

    const pedidoId = String(pedido.pedidoId);

    await registro.showNotification(pedido.titulo, {
      body: pedido.cuerpo,
      icon: ICONO_NOTIFICACION,
      badge: ICONO_NOTIFICACION,
      tag: `myc-pedido-${pedidoId}`,
      data: {
        pedidoId,
        url: `/?pedido=${encodeURIComponent(pedidoId)}`,
      },
    });
  } catch (error) {
    console.warn(
      "[MYC] No se pudo mostrar la notificación del sistema:",
      error,
    );
  }
}

function estadoInicial() {
  const token = leerTokenLocal();
  const permiso = permisoActual();

  return {
    soportado: null,
    activo: Boolean(token) && permiso !== "denied",
    permiso,
    cargando: false,
    error: "",
    mensaje: "",
  };
}

export function useNotificacionesAdmin({ habilitado = true } = {}) {
  const [estado, setEstado] = useState(estadoInicial);
  const [aviso, setAviso] = useState(null);

  useEffect(() => {
    if (!habilitado) return;

    const soporte = evaluarSoporteNavegador();
    const permiso = permisoActual();

    setEstado((actual) => ({
      ...actual,
      soportado: soporte.soportado,
      permiso,
      activo:
        Boolean(leerTokenLocal()) &&
        soporte.soportado &&
        permiso !== "denied",
      error: soporte.soportado ? "" : soporte.motivo,
    }));
  }, [habilitado]);

  // Registro automático tras iniciar sesión.
  //
  // El cierre de sesión (o su expiración) desactiva el dispositivo en
  // el backend y revoca el token. Sin este paso, después de volver a
  // entrar no quedaba ningún dispositivo activo y el backend no tenía a
  // quién notificar. Solo se ejecuta si el permiso ya fue concedido
  // antes (no muestra el diálogo del navegador) y si el administrador no
  // desactivó las notificaciones manualmente. También renueva el token
  // cuando Firebase lo rota.
  useEffect(() => {
    if (!habilitado || estado.soportado !== true) {
      return undefined;
    }

    if (permisoActual() !== "granted" || leerDesactivadoManual()) {
      return undefined;
    }

    let cancelado = false;

    (async () => {
      try {
        const token = await obtenerTokenFCM();

        if (cancelado) return;

        await registrarDispositivo(token, "web");

        if (cancelado) return;

        guardarTokenLocal(token);
        console.info(
          "[MYC] Notificaciones: dispositivo registrado para este administrador.",
        );

        setEstado((actual) => ({
          ...actual,
          activo: true,
          permiso: "granted",
          error: "",
        }));
      } catch (error) {
        if (cancelado) return;

        console.warn(
          "[MYC] No se pudo registrar el dispositivo para notificaciones:",
          error,
        );

        setEstado((actual) => ({
          ...actual,
          activo: false,
          error:
            error?.message ||
            "No se pudieron activar las notificaciones en este dispositivo.",
        }));
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [habilitado, estado.soportado]);

  useEffect(() => {
    if (!habilitado || estado.soportado === false) {
      return undefined;
    }

    let cancelado = false;
    let desuscribir = () => {};

    const manejarMensaje = crearManejadorMensajeForeground(
      (pedido) => {
        if (cancelado) return;

        setAviso(pedido);
        void mostrarNotificacionSistema(pedido);
      },
    );

    escucharMensajesForeground(manejarMensaje)
      .then((fn) => {
        if (cancelado) {
          fn();
        } else {
          desuscribir = fn;
        }
      })
      .catch(() => {
        // La falta de mensajes en primer plano no rompe el panel.
      });

    return () => {
      cancelado = true;
      desuscribir();
    };
  }, [habilitado, estado.soportado]);

  const activar = useCallback(async () => {
    if (!habilitado) return;

    if (estado.soportado === false) {
      setEstado((actual) => ({
        ...actual,
        error:
          actual.error ||
          "Este navegador no soporta notificaciones push.",
      }));
      return;
    }

    setEstado((actual) => ({
      ...actual,
      cargando: true,
      error: "",
      mensaje: "",
    }));

    try {
      const permiso = await solicitarPermisoNotificaciones();
      const token = await obtenerTokenFCM();

      await registrarDispositivo(token, "web");
      guardarTokenLocal(token);
      guardarDesactivadoManual(false);

      setEstado((actual) => ({
        ...actual,
        activo: true,
        permiso,
        cargando: false,
        error: "",
        mensaje:
          "Notificaciones activadas en este dispositivo.",
      }));
    } catch (error) {
      setEstado((actual) => ({
        ...actual,
        activo: false,
        permiso: permisoActual(),
        cargando: false,
        error:
          error?.message ||
          "No se pudieron activar las notificaciones.",
        mensaje: "",
      }));
    }
  }, [estado.soportado, habilitado]);

  const desactivar = useCallback(async () => {
    if (!habilitado) return;

    setEstado((actual) => ({
      ...actual,
      cargando: true,
      error: "",
      mensaje: "",
    }));

    const token = leerTokenLocal();

    try {
      if (token) {
        await desactivarDispositivo(token);
      }
    } catch (error) {
      setEstado((actual) => ({
        ...actual,
        cargando: false,
        error:
          error?.message ||
          "No se pudieron desactivar las notificaciones.",
      }));
      return;
    }

    borrarTokenLocal();
    guardarDesactivadoManual(true);

    try {
      await revocarTokenFCM();
    } catch {
      // El token local ya fue desactivado en el backend.
    }

    setEstado((actual) => ({
      ...actual,
      activo: false,
      cargando: false,
      error: "",
      mensaje: "Notificaciones desactivadas en este dispositivo.",
    }));
  }, [habilitado]);

  const cerrarAviso = useCallback(() => setAviso(null), []);

  return {
    ...estado,
    aviso,
    activar,
    desactivar,
    cerrarAviso,
  };
}
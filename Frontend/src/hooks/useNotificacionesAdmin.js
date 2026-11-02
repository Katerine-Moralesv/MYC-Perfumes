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

function permisoActual() {
  if (typeof Notification === "undefined") return "default";

  return Notification.permission || "default";
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

  useEffect(() => {
    if (!habilitado || estado.soportado === false) {
      return undefined;
    }

    let cancelado = false;
    let desuscribir = () => {};

    const manejarMensaje = crearManejadorMensajeForeground(
      (pedido) => {
        if (!cancelado) setAviso(pedido);
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

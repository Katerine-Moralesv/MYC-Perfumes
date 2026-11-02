import { useCallback, useEffect, useMemo, useState } from "react";

import {
  actualizarPerfil as actualizarPerfilApi,
  iniciarSesion,
  obtenerPerfil,
} from "../services/auth";
import { setAuthExpiredHandler } from "../services/api";
import {
  cerrarNotificaciones,
  leerTokenLocal,
} from "../services/notificaciones.js";
import {
  clearTokens,
  getAccessToken,
  getAccessTokenExpiration,
  hasStoredSession,
  setTokens,
} from "../auth/tokenStorage";
import { AuthContext } from "./auth-context";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("loading");
  const [authNotice, setAuthNotice] = useState("");

  const limpiarNotificacionesDeSesion = useCallback(() => {
    const tokenFcm = leerTokenLocal();

    if (!tokenFcm) return;

    void cerrarNotificaciones({
      token: tokenFcm,
      accessToken: getAccessToken(),
    }).catch(() => {});
  }, []);

  const cerrarSesion = useCallback(() => {
    limpiarNotificacionesDeSesion();
    clearTokens();
    setUser(null);
    setStatus("anonymous");
    setAuthNotice("");
  }, [limpiarNotificacionesDeSesion]);

  const expirarSesion = useCallback(() => {
    limpiarNotificacionesDeSesion();
    clearTokens();
    setUser(null);
    setStatus("anonymous");
    setAuthNotice("Tu sesión expiró. Inicia sesión nuevamente.");
  }, [limpiarNotificacionesDeSesion]);

  const refrescarPerfil = useCallback(async () => {
    const perfil = await obtenerPerfil();
    setUser(perfil);
    setStatus("authenticated");
    return perfil;
  }, []);

  const login = useCallback(async ({ username, password }) => {
    setAuthNotice("");

    const tokens = await iniciarSesion({ username, password });

    setTokens({
      access: tokens.access,
      refresh: tokens.refresh,
    });

    try {
      const perfil = await obtenerPerfil();
      setUser(perfil);
      setStatus("authenticated");
      return perfil;
    } catch (error) {
      clearTokens();
      setUser(null);
      setStatus("anonymous");
      throw error;
    }
  }, []);

  const actualizarPerfil = useCallback(async (datos) => {
    const perfil = await actualizarPerfilApi(datos);
    setUser(perfil);
    return perfil;
  }, []);

  useEffect(() => {
    let cancelado = false;

    async function cargarSesion() {
      if (!hasStoredSession()) {
        if (!cancelado) {
          setStatus("anonymous");
          setAuthNotice("");
        }
        return;
      }

      try {
        const perfil = await obtenerPerfil();

        if (!cancelado) {
          setUser(perfil);
          setStatus("authenticated");
          setAuthNotice("");
        }
      } catch (error) {
        if (cancelado) return;

        if (error?.status === 401 || error?.status === 403) {
          clearTokens();
          setAuthNotice("Tu sesión expiró. Inicia sesión nuevamente.");
        } else {
          setAuthNotice(
            error?.message ||
              "No se pudo verificar la sesión con el servidor."
          );
        }

        setUser(null);
        setStatus("anonymous");
      }
    }

    cargarSesion();

    return () => {
      cancelado = true;
    };
  }, []);

  useEffect(() => {
    setAuthExpiredHandler(expirarSesion);

    return () => {
      setAuthExpiredHandler(null);
    };
  }, [expirarSesion]);

  useEffect(() => {
    if (status !== "authenticated" || typeof window === "undefined") {
      return undefined;
    }

    function revisarVencimiento() {
      const expiracion = getAccessTokenExpiration();

      if (!expiracion) return;

      const faltante = expiracion * 1000 - Date.now();

      if (faltante <= 30000) {
        refrescarPerfil().catch(() => {
          // El interceptor renueva o cierra la sesión según el error real.
        });
      }
    }

    const intervalo = window.setInterval(revisarVencimiento, 30000);
    revisarVencimiento();

    return () => window.clearInterval(intervalo);
  }, [status, refrescarPerfil]);

  const isAdmin = Boolean(
    user && (user.rol === "admin" || user.is_superuser === true),
  );
  const isVendedor = Boolean(user && !isAdmin && user.rol === "vendedor");
  const isAuthenticated = status === "authenticated" && Boolean(user);

  const value = useMemo(
    () => ({
      user,
      status,
      authNotice,
      isAuthenticated,
      isAdmin,
      isVendedor,
      login,
      logout: cerrarSesion,
      refrescarPerfil,
      actualizarPerfil,
    }),
    [
      user,
      status,
      authNotice,
      isAuthenticated,
      isAdmin,
      isVendedor,
      login,
      cerrarSesion,
      refrescarPerfil,
      actualizarPerfil,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

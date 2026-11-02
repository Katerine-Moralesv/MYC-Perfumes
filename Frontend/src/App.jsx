import { useEffect, useState } from "react";

import Inicio from "./pages/Inicio/Inicio";
import Login from "./pages/Login/Login";
import RecuperarPassword from "./pages/RecuperarPassword/RecuperarPassword";
import Dashboard from "./pages/Dashboard/Dashboard";
import ErrorBoundary from "./components/common/ErrorBoundary";
import { useAuth } from "./context/auth-context";
import { useNotificacionesAdmin } from "./hooks/useNotificacionesAdmin.js";
import {
  borrarPedidoPendiente,
  guardarPedidoPendiente,
  leerPedidoDeMensajeSW,
  limpiarPedidoDeUrl,
  obtenerPedidoPendienteInicial,
  resolverPedidoPendiente,
} from "./services/notificaciones.js";

import "./styles/global.css";

const VISTAS_PUBLICAS = ["inicio", "catalogo", "nosotros", "seleccion"];

function AuthLoading() {
  return (
    <main className="auth-loading" role="status" aria-live="polite">
      <span className="auth-loading-spinner" aria-hidden="true" />
      <p>Verificando sesión...</p>
    </main>
  );
}

function App() {
  const [pantalla, setPantalla] = useState("inicio");
  const [pedidoPendiente, setPedidoPendiente] = useState(
    () => obtenerPedidoPendienteInicial(),
  );
  const [pedidoDestinoId, setPedidoDestinoId] = useState(null);
  const {
    status,
    authNotice,
    isAuthenticated,
    isAdmin,
    login,
    logout,
  } = useAuth();

  const notificaciones = useNotificacionesAdmin({
    habilitado: isAdmin,
  });

  useEffect(() => {
    window.__mycReactMounted = true;
    window.dispatchEvent(new Event("myc:ready"));
  }, []);

  useEffect(() => {
    const decision = resolverPedidoPendiente({
      pedidoPendiente,
      isAuthenticated,
      status,
    });

    if (decision.accion === "abrir") {
      setPedidoDestinoId(decision.pedidoId);
      setPedidoPendiente(null);
      setPantalla("admin");
      limpiarPedidoDeUrl();
      return;
    }

    if (decision.accion === "login") {
      setPantalla("login");
    }
  }, [pedidoPendiente, isAuthenticated, status]);

  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !navigator.serviceWorker
    ) {
      return undefined;
    }

    function manejarMensajeServiceWorker(evento) {
      const pedidoId = leerPedidoDeMensajeSW(evento.data);

      if (!pedidoId) return;

      guardarPedidoPendiente(pedidoId);

      if (isAuthenticated) {
        setPedidoDestinoId(pedidoId);
        setPantalla("admin");
      } else {
        setPedidoPendiente(pedidoId);
        setPantalla("login");
      }
    }

    navigator.serviceWorker.addEventListener(
      "message",
      manejarMensajeServiceWorker,
    );

    return () => {
      navigator.serviceWorker.removeEventListener(
        "message",
        manejarMensajeServiceWorker,
      );
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    function volverAVistaPublica() {
      const hash = window.location.hash.replace(/^#\/?/, "").toLowerCase();

      if (hash === "" || VISTAS_PUBLICAS.includes(hash)) {
        setPantalla("inicio");
      }
    }

    window.addEventListener("hashchange", volverAVistaPublica);
    window.addEventListener("popstate", volverAVistaPublica);

    return () => {
      window.removeEventListener("hashchange", volverAVistaPublica);
      window.removeEventListener("popstate", volverAVistaPublica);
    };
  }, []);

  async function manejarLogin(credenciales) {
    await login(credenciales);
    setPantalla("admin");
  }

  function manejarCierreSesion() {
    notificaciones.cerrarAviso();
    logout();
    setPantalla("inicio");
  }

  function manejarPedidoInicialAbierto() {
    borrarPedidoPendiente();
    setPedidoDestinoId(null);
    setPedidoPendiente(null);
    limpiarPedidoDeUrl();
  }

  function abrirPedidoDesdeNotificacion(pedidoId) {
    if (!pedidoId || !isAdmin) return;

    guardarPedidoPendiente(pedidoId);
    setPedidoDestinoId(pedidoId);
    setPedidoPendiente(null);
    setPantalla("admin");
    notificaciones.cerrarAviso();
  }

  function abrirAdministracion() {
    setPantalla(isAuthenticated ? "admin" : "login");
  }

  const mostrandoLogin =
    pantalla === "login" || (pantalla === "admin" && status === "anonymous");
  const mostrandoCargaAdmin = pantalla === "admin" && status === "loading";
  const mostrandoDashboard = pantalla === "admin" && isAuthenticated;

  return (
    <ErrorBoundary>
      <div className="app">
        {isAdmin && notificaciones.aviso && (
          <div
            className="dash-notificacion-aviso"
            role="status"
            aria-live="polite"
          >
            <div>
              <strong>{notificaciones.aviso.titulo}</strong>
              <p>{notificaciones.aviso.cuerpo}</p>
            </div>

            <div className="dash-notificacion-acciones">
              <button
                type="button"
                onClick={() =>
                  abrirPedidoDesdeNotificacion(
                    notificaciones.aviso.pedidoId,
                  )
                }
              >
                Ver pedido
              </button>
              <button
                type="button"
                className="dash-notificacion-cerrar"
                onClick={notificaciones.cerrarAviso}
                aria-label="Cerrar aviso"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {pantalla === "inicio" && (
          <Inicio onAdminLogin={abrirAdministracion} />
        )}

        {mostrandoLogin && (
          <>
            <Login
              key={authNotice || "login"}
              mensajeInicial={authNotice}
              onForgotPassword={() => setPantalla("recuperar")}
              onLogin={manejarLogin}
            />

            <button
              type="button"
              onClick={() => setPantalla("inicio")}
              style={{
                position: "fixed",
                top: "18px",
                left: "18px",
                zIndex: 1000,
                padding: "10px 15px",
                border: "1px solid #efddd7",
                borderRadius: "9px",
                background: "#fffaf6",
                color: "#8d6069",
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              ← Volver a la tienda
            </button>
          </>
        )}

        {pantalla === "recuperar" && (
          <RecuperarPassword
            onVolver={() => setPantalla("login")}
          />
        )}

        {mostrandoCargaAdmin && <AuthLoading />}

        {mostrandoDashboard && (
          <Dashboard
            onCerrarSesion={manejarCierreSesion}
            pedidoInicialId={pedidoDestinoId}
            onPedidoInicialAbierto={manejarPedidoInicialAbierto}
            notificaciones={notificaciones}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}

export default App;

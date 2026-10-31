import { useEffect, useState } from "react";

import Inicio from "./pages/Inicio/Inicio";
import Login from "./pages/Login/Login";
import RecuperarPassword from "./pages/RecuperarPassword/RecuperarPassword";
import Dashboard from "./pages/Dashboard/Dashboard";
import ErrorBoundary from "./components/common/ErrorBoundary";
import { useAuth } from "./context/auth-context";

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
  const { status, authNotice, isAuthenticated, login, logout } = useAuth();

  useEffect(() => {
    window.__mycReactMounted = true;
    window.dispatchEvent(new Event("myc:ready"));
  }, []);

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
    logout();
    setPantalla("inicio");
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
          <Dashboard onCerrarSesion={manejarCierreSesion} />
        )}
      </div>
    </ErrorBoundary>
  );
}

export default App;

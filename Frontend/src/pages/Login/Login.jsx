import { useState } from "react";
import logoMYC from "../../assets/logo-myc.png";
import fondoFloral from "../../assets/fondo-floral.png";
import "./Login.css";

function Login({ onForgotPassword, onLogin, mensajeInicial = "" }) {
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(mensajeInicial);
  const [enviando, setEnviando] = useState(false);

  async function enviarFormulario(evento) {
    evento.preventDefault();
    setError("");
    setEnviando(true);

    try {
      await onLogin?.({
        username: usuario.trim(),
        password,
      });
    } catch (errorLogin) {
      if (errorLogin?.status === 401) {
        setError("Usuario o contraseña incorrectos.");
      } else if (errorLogin?.status === 403) {
        setError("Este usuario no tiene permisos para acceder al panel.");
      } else {
        setError(
          errorLogin?.message ||
            "No se pudo iniciar sesión. Inténtalo de nuevo."
        );
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main
      className="login"
      style={{ backgroundImage: `url(${fondoFloral})` }}
    >
      <section className="login-card">
        <img
          src={logoMYC}
          alt="MYC Perfumes"
          className="login-logo"
        />

        <p className="login-label">MYC PERFUMES</p>

        <h1>Iniciar sesión</h1>

        <p className="login-description">
          Ingresa tus datos para acceder al sistema administrativo.
        </p>

        <form
          className="login-form"
          onSubmit={enviarFormulario}
          aria-busy={enviando}
        >
          <div className="login-field">
            <label htmlFor="usuario">Usuario</label>

            <div className="login-input-icono">
              <svg
                className="login-icono-campo"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21v-2a8 8 0 0 1 16 0v2z" />
              </svg>

              <input
                id="usuario"
                name="usuario"
                type="text"
                placeholder="Nombre de usuario"
                value={usuario}
                onChange={(evento) => {
                  setUsuario(evento.target.value);
                  if (error) setError("");
                }}
                autoComplete="username"
                autoCapitalize="none"
                required
              />
            </div>
          </div>

          <div className="login-field">
            <label htmlFor="password">Contraseña</label>

            <div className="login-input-icono">
              <svg
                className="login-icono-campo"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <rect x="5" y="10" width="14" height="11" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>

              <input
                id="password"
                name="password"
                type={mostrarPassword ? "text" : "password"}
                placeholder="Ingresa tu contraseña"
                value={password}
                onChange={(evento) => {
                  setPassword(evento.target.value);
                  if (error) setError("");
                }}
                autoComplete="current-password"
                required
              />

              <button
                type="button"
                className="password-ojo"
                onClick={() => setMostrarPassword(!mostrarPassword)}
                aria-label={
                  mostrarPassword
                    ? "Ocultar contraseña"
                    : "Mostrar contraseña"
                }
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                  {mostrarPassword && <path d="M3 3l18 18" />}
                </svg>
              </button>
            </div>
          </div>

          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}

          <div className="login-forgot">
            <button type="button" onClick={onForgotPassword}>
              ¿Olvidaste tu contraseña?
            </button>
          </div>

          <button
            type="submit"
            className="login-button"
            disabled={enviando}
          >
            <span>{enviando ? "Ingresando..." : "Ingresar"}</span>
            <span className="login-flecha" aria-hidden="true">→</span>
          </button>
        </form>

        <div className="login-pie">
          <div className="login-pie-decoracion">
            <span />

            <svg viewBox="0 0 32 32" aria-hidden="true">
              <path d="M16 27C12 19 3 17 5 10c2-6 9-3 11 3 2-6 9-9 11-3 2 7-7 9-11 17z" />
              <path d="M16 13v14" />
            </svg>

            <span />
          </div>

          <p>Acceso exclusivo para administradores y vendedores</p>
        </div>
      </section>
    </main>
  );
}

export default Login;

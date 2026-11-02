import { useRef, useState } from "react";
import fondoFloral from "../../assets/fondo-floral.webp";
import logoMYC from "../../assets/logo-myc.webp";
import {
  restablecerPassword,
  solicitarRecuperacion,
  verificarCodigoRecuperacion,
} from "../../services/auth";
import "./RecuperarPassword.css";

function RecuperarPassword({ onVolver }) {
  const [paso, setPaso] = useState(1);
  const [correo, setCorreo] = useState("");
  const [codigo, setCodigo] = useState(["", "", "", "", "", ""]);
  const [resetToken, setResetToken] = useState("");
  const [nuevaPassword, setNuevaPassword] = useState("");
  const [confirmarPassword, setConfirmarPassword] = useState("");
  const [mostrarConfirmacion, setMostrarConfirmacion] = useState(false);
  const [cambioExitoso, setCambioExitoso] = useState(false);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  const inputsCodigo = useRef([]);

  function limpiarError() {
    if (error) setError("");
  }

  async function handleEnviarCorreo(event) {
    event.preventDefault();
    setError("");

    const email = correo.trim();

    if (!email) {
      setError("Ingresa tu correo electrónico.");
      return;
    }

    setCargando(true);

    try {
      await solicitarRecuperacion(email);
      setCorreo(email);
      setPaso(2);
    } catch (errorSolicitud) {
      setError(
        errorSolicitud?.isTimeout
          ? "El servidor tardó demasiado en responder. Revisa tu conexión e inténtalo de nuevo."
          : errorSolicitud?.message ||
              "No se pudo enviar el código. Inténtalo de nuevo."
      );
    } finally {
      setCargando(false);
    }
  }

  function handleCodigoChange(valor, indice) {
    if (!/^\d*$/.test(valor)) return;

    limpiarError();

    if (valor.length > 1) {
      const digitos = valor.slice(0, 6).split("");
      const nuevoCodigo = ["", "", "", "", "", ""];

      digitos.forEach((digito, i) => {
        nuevoCodigo[i] = digito;
      });

      setCodigo(nuevoCodigo);

      const siguiente = Math.min(digitos.length, 5);
      inputsCodigo.current[siguiente]?.focus();
      return;
    }

    if (codigo.join("").length >= 6 && codigo[indice] === "") {
      return;
    }

    const nuevoCodigo = [...codigo];
    nuevoCodigo[indice] = valor;
    setCodigo(nuevoCodigo);

    if (valor !== "" && indice < 5) {
      inputsCodigo.current[indice + 1]?.focus();
    }
  }

  function handleCodigoKeyDown(event, indice) {
    if (
      event.key === "Backspace" &&
      codigo[indice] === "" &&
      indice > 0
    ) {
      inputsCodigo.current[indice - 1]?.focus();
    }

    if (event.key === "ArrowLeft" && indice > 0) {
      inputsCodigo.current[indice - 1]?.focus();
    }

    if (event.key === "ArrowRight" && indice < 5) {
      inputsCodigo.current[indice + 1]?.focus();
    }
  }

  async function handleVerificarCodigo(event) {
    event.preventDefault();
    setError("");

    const codigoCompleto = codigo.join("");

    if (codigoCompleto.length !== 6) {
      setError("Por favor, ingresa los seis dígitos.");
      return;
    }

    setCargando(true);

    try {
      const respuesta = await verificarCodigoRecuperacion({
        email: correo.trim(),
        codigo: codigoCompleto,
      });

      if (!respuesta?.reset_token) {
        setError("No se pudo validar el código. Inténtalo de nuevo.");
        return;
      }

      setResetToken(respuesta.reset_token);
      setPaso(3);
    } catch (errorVerificacion) {
      setError(
        errorVerificacion?.message ||
          "El código no es válido o ha expirado."
      );
    } finally {
      setCargando(false);
    }
  }

  async function handleRestablecerPassword(event) {
    event.preventDefault();
    setError("");

    if (nuevaPassword.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }

    if (nuevaPassword !== confirmarPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setCargando(true);

    try {
      await restablecerPassword({
        email: correo.trim(),
        resetToken,
        nuevaPassword,
      });

      setCambioExitoso(true);
    } catch (errorRestablecer) {
      setError(
        errorRestablecer?.message ||
          "No se pudo restablecer la contraseña. Inténtalo de nuevo."
      );
    } finally {
      setCargando(false);
    }
  }

  function handleVolverLogin() {
    setCambioExitoso(false);
    setPaso(1);
    setCorreo("");
    setCodigo(["", "", "", "", "", ""]);
    setResetToken("");
    setNuevaPassword("");
    setConfirmarPassword("");
    setMostrarConfirmacion(false);
    setError("");
    onVolver();
  }

  return (
    <main
      className="recuperar"
      style={{ backgroundImage: `url(${fondoFloral})` }}
    >
      <section className="recuperar-card">
        <img
          src={logoMYC}
          alt="MYC Perfumes"
          className="recuperar-logo"
          width="256"
          height="256"
          decoding="async"
        />

        <p className="recuperar-label">MYC PERFUMES</p>

        {cambioExitoso ? (
          <>
            <div className="cambio-exitoso-titulo">
              <h1>¡Cambio exitoso!</h1>
              <span className="cambio-exitoso-icono" aria-hidden="true">
                ✓
              </span>
            </div>

            <p className="recuperar-descripcion">
              Tu contraseña se ha cambiado exitosamente.
              Ya puedes volver al inicio de sesión.
            </p>

            <button
              className="recuperar-boton"
              type="button"
              onClick={handleVolverLogin}
            >
              Volver al inicio de sesión
            </button>
          </>
        ) : paso === 1 ? (
          <>
            <h1>Recuperar contraseña</h1>

            <p className="recuperar-descripcion">
              Ingresa el correo electrónico asociado a tu cuenta.
              Te enviaremos un código para restablecer tu contraseña.
            </p>

            <form onSubmit={handleEnviarCorreo} aria-busy={cargando}>
              <div className="recuperar-campo">
                <label htmlFor="correo">Correo electrónico</label>

                <input
                  id="correo"
                  type="email"
                  placeholder="Ingresa tu correo"
                  value={correo}
                  onChange={(e) => {
                    setCorreo(e.target.value);
                    limpiarError();
                  }}
                  autoComplete="email"
                  required
                />
              </div>

              {error && (
                <p className="recuperar-error" role="alert">
                  {error}
                </p>
              )}

              <button
                className="recuperar-boton"
                type="submit"
                disabled={cargando}
              >
                {cargando ? "Enviando..." : "Enviar código"}
              </button>
            </form>
          </>
        ) : paso === 2 ? (
          <>
            <h1>Verifica tu correo</h1>

            <p className="recuperar-descripcion">
              Ingresa el código de 6 dígitos que enviamos a:
              <br />
              <strong>{correo}</strong>
            </p>

            <p className="recuperar-nota">
              Si no lo recibes en unos minutos, revisa la carpeta de
              spam o vuelve a solicitar el código.
            </p>

            <form onSubmit={handleVerificarCodigo} aria-busy={cargando}>
              <div className="codigo-campos">
                {codigo.map((numero, indice) => (
                  <input
                    key={indice}
                    ref={(elemento) => {
                      inputsCodigo.current[indice] = elemento;
                    }}
                    type="text"
                    inputMode="numeric"
                    autoComplete={
                      indice === 0 ? "one-time-code" : "off"
                    }
                    maxLength={1}
                    aria-label={`Dígito ${indice + 1}`}
                    value={numero}
                    onChange={(e) =>
                      handleCodigoChange(e.target.value, indice)
                    }
                    onKeyDown={(e) =>
                      handleCodigoKeyDown(e, indice)
                    }
                    required
                  />
                ))}
              </div>

              {error && (
                <p className="recuperar-error" role="alert">
                  {error}
                </p>
              )}

              <button
                className="recuperar-boton"
                type="submit"
                disabled={cargando}
              >
                {cargando ? "Verificando..." : "Verificar código"}
              </button>
            </form>

            <button
              className="recuperar-volver"
              type="button"
              onClick={() => {
                setPaso(1);
                setError("");
              }}
            >
              Cambiar correo electrónico
            </button>
          </>
        ) : (
          <>
            <h1>Cambiar contraseña</h1>

            <p className="recuperar-descripcion">
              Ingresa y confirma tu nueva contraseña para MYC Perfumes.
            </p>

            <form onSubmit={handleRestablecerPassword} aria-busy={cargando}>
              <div className="recuperar-campo">
                <label htmlFor="nueva-password">
                  Nueva contraseña
                </label>

                <input
                  id="nueva-password"
                  type="password"
                  placeholder="Mínimo 8 caracteres"
                  value={nuevaPassword}
                  onChange={(e) => {
                    setNuevaPassword(e.target.value);
                    limpiarError();
                  }}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>

              <div className="recuperar-campo">
                <label htmlFor="confirmarPassword">
                  Confirmar contraseña
                </label>

                <div className="password-contenedor">
                  <input
                    id="confirmarPassword"
                    name="confirmarPassword"
                    type={mostrarConfirmacion ? "text" : "password"}
                    placeholder="Confirma tu nueva contraseña"
                    value={confirmarPassword}
                    onChange={(e) => {
                      setConfirmarPassword(e.target.value);
                      limpiarError();
                    }}
                    autoComplete="new-password"
                    required
                  />

                  <button
                    type="button"
                    className="password-ojo"
                    onClick={() =>
                      setMostrarConfirmacion(!mostrarConfirmacion)
                    }
                    aria-label={
                      mostrarConfirmacion
                        ? "Ocultar contraseña"
                        : "Mostrar contraseña"
                    }
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                      <circle cx="12" cy="12" r="3" />
                      {mostrarConfirmacion && (
                        <path d="M3 3l18 18" />
                      )}
                    </svg>
                  </button>
                </div>
              </div>

              {error && (
                <p className="recuperar-error" role="alert">
                  {error}
                </p>
              )}

              <button
                className="recuperar-boton"
                type="submit"
                disabled={cargando}
              >
                {cargando ? "Guardando..." : "Restablecer contraseña"}
              </button>
            </form>
          </>
        )}

        {!cambioExitoso && (
          <button
            className="recuperar-volver"
            type="button"
            onClick={onVolver}
          >
            ← Volver al inicio de sesión
          </button>
        )}
      </section>
    </main>
  );
}

export default RecuperarPassword;

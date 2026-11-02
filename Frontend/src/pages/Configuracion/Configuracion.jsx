import { useEffect, useState } from "react";

import { useAuth } from "../../context/auth-context";
import {
  actualizarUsuario,
  crearUsuario,
  eliminarUsuario,
  listarUsuarios,
} from "../../services/usuarios";
import {
  etiquetaRolUsuario,
  rolNormalizadoUsuario,
} from "./roles.js";
import "./Configuracion.css";

function Icono({ tipo, size = 20 }) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };

  const dibujos = {
    usuario: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
      </>
    ),
    correo: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </>
    ),
    candado: (
      <>
        <rect x="4" y="10" width="16" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
      </>
    ),
    ajustes: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="m19.4 15 .1.1 1.1 1.8-2 2-1.8-1.1a8 8 0 0 1-1.7.7l-.5 2.1h-2.8l-.5-2.1a8 8 0 0 1-1.7-.7l-1.8 1.1-2-2 1.1-1.8a8 8 0 0 1-.7-1.7L4 12.8V10l2.1-.5a8 8 0 0 1 .7-1.7L5.7 6l2-2 1.8 1.1a8 8 0 0 1 1.7-.7L11.7 2h2.8l.5 2.1a8 8 0 0 1 1.7.7L18.5 3l2 2-1.1 1.8a8 8 0 0 1 .7 1.7l2.1.5v2.8l-2.1.5a8 8 0 0 1-.7 1.7Z" />
      </>
    ),
    usuarios: (
      <>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 15a5 5 0 0 1 5 5" />
      </>
    ),
    editar: (
      <>
        <path d="m15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z" />
      </>
    ),
    eliminar: (
      <>
        <path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7" />
      </>
    ),
    agregar: <path d="M12 5v14M5 12h14" />,
    cerrar: <path d="m6 6 12 12M18 6 6 18" />,
    guardar: (
      <>
        <path d="M5 3h12l4 4v14H3V3Z" />
        <path d="M7 3v6h10V3M7 21v-7h10v7" />
      </>
    ),
    campana: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21a2 2 0 0 0 4 0" />
      </>
    ),
  };

  return <svg {...props}>{dibujos[tipo] || dibujos.usuario}</svg>;
}

function iniciales(nombre = "") {
  return String(nombre)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte.charAt(0).toUpperCase())
    .join("");
}

const formularioAdminVacio = {
  username: "",
  email: "",
  rol: "vendedor",
  password: "",
  is_active: true,
};

export default function Configuracion({ notificaciones } = {}) {
  const {
    user,
    isAdmin,
    actualizarPerfil,
    refrescarPerfil,
  } = useAuth();

  const [nombreUsuario, setNombreUsuario] = useState(
    user?.username || ""
  );
  const [correoUsuario, setCorreoUsuario] = useState(
    user?.email || ""
  );
  const [guardandoPerfil, setGuardandoPerfil] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [tipoMensaje, setTipoMensaje] = useState("exito");

  const [administradores, setAdministradores] = useState([]);
  const [cargandoAdmins, setCargandoAdmins] = useState(false);
  const [errorAdmins, setErrorAdmins] = useState("");
  const [modal, setModal] = useState(null);
  const [formularioAdmin, setFormularioAdmin] = useState(
    formularioAdminVacio
  );
  const [errorAdmin, setErrorAdmin] = useState("");
  const [guardandoAdmin, setGuardandoAdmin] = useState(false);

  const rolVisible = etiquetaRolUsuario(user);

  useEffect(() => {
    setNombreUsuario(user?.username || "");
    setCorreoUsuario(user?.email || "");
  }, [user?.username, user?.email]);

  useEffect(() => {
    let cancelado = false;

    if (!isAdmin) {
      setAdministradores([]);
      setErrorAdmins("");
      return undefined;
    }

    setCargandoAdmins(true);

    listarUsuarios()
      .then((datos) => {
        if (!cancelado) {
          setAdministradores(Array.isArray(datos) ? datos : []);
          setErrorAdmins("");
        }
      })
      .catch((error) => {
        if (!cancelado) {
          setAdministradores([]);
          setErrorAdmins(
            error?.message ||
              "No se pudieron cargar los usuarios del sistema."
          );
        }
      })
      .finally(() => {
        if (!cancelado) setCargandoAdmins(false);
      });

    return () => {
      cancelado = true;
    };
  }, [isAdmin]);

  async function recargarAdministradores() {
    if (!isAdmin) return;

    setCargandoAdmins(true);

    try {
      const datos = await listarUsuarios();
      setAdministradores(Array.isArray(datos) ? datos : []);
      setErrorAdmins("");
    } catch (error) {
      setErrorAdmins(
        error?.message || "No se pudieron cargar los usuarios del sistema."
      );
    } finally {
      setCargandoAdmins(false);
    }
  }

  async function actualizarMisDatos(evento) {
    evento.preventDefault();
    setMensaje("");

    const username = nombreUsuario.trim();
    const email = correoUsuario.trim();

    if (!username || !email) {
      setTipoMensaje("error");
      setMensaje("Completa el nombre de usuario y el correo electrónico.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setTipoMensaje("error");
      setMensaje("Escribe un correo electrónico válido.");
      return;
    }

    setGuardandoPerfil(true);

    try {
      await actualizarPerfil({ username, email });

      if (isAdmin) {
        await recargarAdministradores();
      }

      setTipoMensaje("exito");
      setMensaje("Datos actualizados correctamente.");
    } catch (error) {
      setTipoMensaje("error");
      setMensaje(
        error?.message || "No se pudieron actualizar tus datos."
      );
    } finally {
      setGuardandoPerfil(false);
    }
  }

  function abrirNuevoAdministrador() {
    setFormularioAdmin({ ...formularioAdminVacio });
    setErrorAdmin("");
    setModal({ tipo: "nuevo", id: null });
  }

  function abrirEditarAdministrador(admin) {
    setFormularioAdmin({
      username: admin.username || "",
      email: admin.email || "",
      rol: rolNormalizadoUsuario(admin),
      password: "",
      is_active: admin.is_active !== false,
    });
    setErrorAdmin("");
    setModal({ tipo: "editar", id: admin.id });
  }

  function cerrarModal() {
    setModal(null);
    setErrorAdmin("");
  }

  async function guardarAdministrador(evento) {
    evento.preventDefault();
    setErrorAdmin("");

    const username = formularioAdmin.username.trim();
    const email = formularioAdmin.email.trim();
    const password = formularioAdmin.password;

    if (!username || !email) {
      setErrorAdmin("Completa el usuario y el correo.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErrorAdmin("Escribe un correo electrónico válido.");
      return;
    }

    if (modal.tipo === "nuevo" && password.length < 8) {
      setErrorAdmin("La contraseña debe tener al menos 8 caracteres.");
      return;
    }

    if (password && password.length < 8) {
      setErrorAdmin("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }

    const esMiCuenta = modal.id === user?.id;
    const payload = {
      username,
      email,
      rol: esMiCuenta
        ? rolNormalizadoUsuario(user)
        : formularioAdmin.rol,
      is_active: esMiCuenta
        ? user?.is_active !== false
        : formularioAdmin.is_active,
    };

    if (password) {
      payload.password = password;
    }

    setGuardandoAdmin(true);

    try {
      if (modal.tipo === "nuevo") {
        await crearUsuario(payload);
      } else {
        await actualizarUsuario(modal.id, payload);
      }

      await recargarAdministradores();

      if (esMiCuenta) {
        await refrescarPerfil();
      }

      cerrarModal();
    } catch (error) {
      const erroresCampo = error?.fieldErrors || {};
      setErrorAdmin(
        erroresCampo.username ||
          erroresCampo.email ||
          erroresCampo.password ||
          erroresCampo.rol ||
          error?.message ||
          "No se pudo guardar el usuario."
      );
    } finally {
      setGuardandoAdmin(false);
    }
  }

  async function eliminarAdministrador(admin) {
    if (admin.id === user?.id) return;

    const confirmar = window.confirm(
      `¿Quieres eliminar al usuario ${admin.username}?`
    );

    if (!confirmar) return;

    try {
      await eliminarUsuario(admin.id);
      await recargarAdministradores();
    } catch (error) {
      setErrorAdmins(
        error?.message || "No se pudo eliminar el usuario."
      );
    }
  }

  return (
    <main className="configuracion-modulo">
      <div className="configuracion-contenido">
        <header className="configuracion-encabezado">
          <p className="configuracion-etiqueta">MYC PERFUMES</p>
          <h1>Configuración</h1>
          <p className="configuracion-subtitulo">
            Administra tu información personal y los usuarios del sistema.
          </p>
        </header>

        <section className="configuracion-panel">
          <div className="configuracion-titulo-seccion">
            <span className="configuracion-icono">
              <Icono tipo="usuario" size={20} />
            </span>
            <div>
              <h2>Mis datos</h2>
              <p>Actualiza tu información de usuario.</p>
            </div>
          </div>

          <p className="configuracion-rol">
            Rol actual: <strong>{rolVisible}</strong>
          </p>

          <form
            className="configuracion-formulario"
            onSubmit={actualizarMisDatos}
            aria-busy={guardandoPerfil}
          >
            <div className="configuracion-campo">
              <label htmlFor="config-nombre">Nombre de usuario</label>
              <div className="configuracion-input">
                <Icono tipo="usuario" size={18} />
                <input
                  id="config-nombre"
                  value={nombreUsuario}
                  onChange={(evento) => {
                    setNombreUsuario(evento.target.value);
                    if (mensaje) setMensaje("");
                  }}
                  placeholder="Nombre de usuario"
                  autoComplete="username"
                  required
                />
              </div>
            </div>

            <div className="configuracion-campo">
              <label htmlFor="config-correo">Correo electrónico</label>
              <div className="configuracion-input">
                <Icono tipo="correo" size={18} />
                <input
                  id="config-correo"
                  type="email"
                  value={correoUsuario}
                  onChange={(evento) => {
                    setCorreoUsuario(evento.target.value);
                    if (mensaje) setMensaje("");
                  }}
                  placeholder="usuario@correo.com"
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <button
              className="configuracion-boton-principal"
              type="submit"
              disabled={guardandoPerfil}
            >
              <Icono tipo="guardar" size={17} />
              {guardandoPerfil ? "Guardando..." : "Actualizar"}
            </button>

            {mensaje && (
              <p
                className={`configuracion-mensaje ${tipoMensaje}`}
                role="status"
              >
                {mensaje}
              </p>
            )}

            <p className="configuracion-nota">
              Para cambiar tu contraseña, cierra sesión y usa la opción
              “¿Olvidaste tu contraseña?”.
            </p>
          </form>
        </section>

        {isAdmin && notificaciones && (
          <section className="configuracion-panel">
            <div className="configuracion-titulo-seccion">
              <span className="configuracion-icono">
                <Icono tipo="campana" size={20} />
              </span>
              <div>
                <h2>Notificaciones de pedidos</h2>
                <p>
                  Recibe un aviso en este dispositivo cuando una
                  clienta registre un pedido.
                </p>
              </div>
            </div>

            <div className="configuracion-notificaciones">
              {notificaciones.soportado === false ? (
                <p
                  className="configuracion-mensaje error"
                  role="alert"
                >
                  {notificaciones.error ||
                    "Este navegador no soporta notificaciones push."}
                </p>
              ) : (
                <>
                  <p className="configuracion-notificaciones-estado">
                    Estado:{" "}
                    <strong>
                      {notificaciones.activo
                        ? "Activadas"
                        : "Desactivadas"}
                    </strong>
                  </p>

                  {notificaciones.error && (
                    <p
                      className="configuracion-mensaje error"
                      role="alert"
                    >
                      {notificaciones.error}
                    </p>
                  )}

                  {notificaciones.mensaje && (
                    <p
                      className="configuracion-mensaje exito"
                      role="status"
                    >
                      {notificaciones.mensaje}
                    </p>
                  )}

                  <button
                    type="button"
                    className={
                      notificaciones.activo
                        ? "configuracion-boton-secundario"
                        : "configuracion-boton-principal"
                    }
                    onClick={
                      notificaciones.activo
                        ? notificaciones.desactivar
                        : notificaciones.activar
                    }
                    disabled={notificaciones.cargando}
                  >
                    <Icono tipo="campana" size={17} />
                    {notificaciones.cargando
                      ? "Procesando..."
                      : notificaciones.activo
                        ? "Desactivar notificaciones"
                        : "Activar notificaciones"}
                  </button>

                  <p className="configuracion-nota">
                    Solo los administradores pueden activar las
                    notificaciones. El navegador solicitará permiso
                    una sola vez.
                  </p>
                </>
              )}
            </div>
          </section>
        )}

        {isAdmin && (
          <section className="configuracion-panel configuracion-panel-admins">
            <div className="configuracion-admins-encabezado">
              <div className="configuracion-titulo-seccion">
                <span className="configuracion-icono">
                  <Icono tipo="usuarios" size={21} />
                </span>
                <div>
                  <h2>Usuarios del sistema</h2>
                  <p>Administra los usuarios y sus roles.</p>
                </div>
              </div>

              <button
                type="button"
                className="configuracion-boton-principal configuracion-boton-agregar"
                onClick={abrirNuevoAdministrador}
              >
                <Icono tipo="agregar" size={18} />
                Agregar
              </button>
            </div>

            {errorAdmins && (
              <p className="configuracion-mensaje error" role="alert">
                {errorAdmins}
              </p>
            )}

            <div className="configuracion-tabla-contenedor">
              <table className="configuracion-tabla">
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Correo</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>

                <tbody>
                  {administradores.map((admin, indice) => {
                    const esMiCuenta = admin.id === user?.id;
                    const rolNormalizado =
                      rolNormalizadoUsuario(admin);

                    return (
                      <tr key={admin.id}>
                        <td>
                          <div className="configuracion-identidad">
                            <span
                              className={`configuracion-avatar avatar-${indice % 3}`}
                            >
                              {iniciales(admin.username)}
                            </span>
                            <span>
                              {admin.username}
                              {esMiCuenta && (
                                <small className="configuracion-yo"> (tú)</small>
                              )}
                            </span>
                          </div>
                        </td>
                        <td>{admin.email || "Sin correo"}</td>
                        <td>
                          <span
                            className={`configuracion-rol-badge rol-${rolNormalizado}`}
                          >
                            {etiquetaRolUsuario(admin)}
                          </span>
                        </td>
                        <td>{admin.is_active === false ? "Inactivo" : "Activo"}</td>
                        <td>
                          <div className="configuracion-acciones">
                            <button
                              type="button"
                              className="configuracion-boton-secundario"
                              onClick={() => abrirEditarAdministrador(admin)}
                            >
                              <Icono tipo="editar" size={16} />
                              Editar
                            </button>
                            <button
                              type="button"
                              className="configuracion-boton-secundario eliminar"
                              onClick={() => eliminarAdministrador(admin)}
                              disabled={esMiCuenta}
                              title={
                                esMiCuenta
                                  ? "No puedes eliminar tu propia cuenta"
                                  : "Eliminar usuario"
                              }
                            >
                              <Icono tipo="eliminar" size={16} />
                              Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {!cargandoAdmins && administradores.length === 0 && (
                    <tr>
                      <td colSpan="5">
                        <p className="configuracion-vacio">
                          No hay usuarios para mostrar.
                        </p>
                      </td>
                    </tr>
                  )}

                  {cargandoAdmins && (
                    <tr>
                      <td colSpan="5">
                        <p className="configuracion-vacio">
                          Cargando usuarios...
                        </p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {modal && (
        <div
          className="configuracion-modal-fondo"
          onMouseDown={(evento) => {
            if (evento.target === evento.currentTarget) cerrarModal();
          }}
        >
          <section
            className="configuracion-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="configuracion-modal-titulo"
          >
            <button
              type="button"
              className="configuracion-modal-cerrar"
              onClick={cerrarModal}
              aria-label="Cerrar ventana"
            >
              <Icono tipo="cerrar" size={19} />
            </button>

            <span className="configuracion-icono configuracion-modal-icono">
              <Icono tipo="usuarios" size={22} />
            </span>

            <h2 id="configuracion-modal-titulo">
              {modal.tipo === "nuevo"
                ? "Agregar usuario"
                : "Editar usuario"}
            </h2>
            <p className="configuracion-modal-subtitulo">
              Completa los datos del usuario.
            </p>

            <form
              className="configuracion-modal-formulario"
              onSubmit={guardarAdministrador}
              aria-busy={guardandoAdmin}
            >
              <label htmlFor="admin-nombre">Nombre de usuario</label>
              <input
                id="admin-nombre"
                value={formularioAdmin.username}
                onChange={(evento) =>
                  setFormularioAdmin((actual) => ({
                    ...actual,
                    username: evento.target.value,
                  }))
                }
                placeholder="Nombre de usuario"
                autoComplete="off"
                required
              />

              <label htmlFor="admin-correo">Correo electrónico</label>
              <input
                id="admin-correo"
                type="email"
                value={formularioAdmin.email}
                onChange={(evento) =>
                  setFormularioAdmin((actual) => ({
                    ...actual,
                    email: evento.target.value,
                  }))
                }
                placeholder="usuario@correo.com"
                autoComplete="off"
                required
              />

              <label htmlFor="admin-rol">Rol</label>
              <select
                id="admin-rol"
                value={formularioAdmin.rol}
                onChange={(evento) =>
                  setFormularioAdmin((actual) => ({
                    ...actual,
                    rol: evento.target.value,
                  }))
                }
                disabled={modal.id === user?.id}
              >
                <option value="vendedor">Vendedor</option>
                <option value="admin">Administrador</option>
              </select>

              <label htmlFor="admin-password">
                {modal.tipo === "nuevo"
                  ? "Contraseña"
                  : "Nueva contraseña (opcional)"}
              </label>
              <input
                id="admin-password"
                type="password"
                value={formularioAdmin.password}
                onChange={(evento) =>
                  setFormularioAdmin((actual) => ({
                    ...actual,
                    password: evento.target.value,
                  }))
                }
                placeholder="Mínimo 8 caracteres"
                autoComplete="new-password"
                minLength={formularioAdmin.password ? 8 : undefined}
                required={modal.tipo === "nuevo"}
              />

              <label className="configuracion-checkbox">
                <input
                  type="checkbox"
                  checked={formularioAdmin.is_active}
                  onChange={(evento) =>
                    setFormularioAdmin((actual) => ({
                      ...actual,
                      is_active: evento.target.checked,
                    }))
                  }
                  disabled={modal.id === user?.id}
                />
                Usuario activo
              </label>

              {errorAdmin && (
                <p className="configuracion-mensaje error" role="alert">
                  {errorAdmin}
                </p>
              )}

              <button
                className="configuracion-boton-principal"
                type="submit"
                disabled={guardandoAdmin}
              >
                <Icono tipo="guardar" size={17} />
                {guardandoAdmin
                  ? "Guardando..."
                  : modal.tipo === "nuevo"
                    ? "Agregar usuario"
                    : "Guardar cambios"}
              </button>

              <button
                className="configuracion-boton-cancelar"
                type="button"
                onClick={cerrarModal}
                disabled={guardandoAdmin}
              >
                Cancelar
              </button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

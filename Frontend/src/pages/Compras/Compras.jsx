import { useEffect, useMemo, useRef, useState } from "react";
import BuscadorSugerencias from "../../components/BuscadorSugerencias.jsx";
import {
  construirOpcionesPresentaciones,
  resolverPresentacion,
} from "../../services/busquedaPresentaciones.js";
import { listarProductosAdmin } from "../../services/catalogoAdmin.js";
import {
  calcularTotalCompra,
  crearProveedor,
  incorporarProveedor,
  listarCompras,
  listarProveedores,
  registrarCompra,
  registrarRecepcionCompra,
} from "../../services/compras.js";
import { listarPedidos } from "../../services/pedidosAdmin.js";
import { listarPresentaciones } from "../../services/presentaciones.js";
import { detalleCompatibleConPresentacion } from "./asignacionesCompra.js";
import "./Compras.css";

const dinero = (valor) =>
  Number(valor || 0).toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });

const limpiarEntero = (valor) =>
  String(valor ?? "").replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");

function fechaHoy() {
  const fecha = new Date();
  const local = new Date(
    fecha.getTime() - fecha.getTimezoneOffset() * 60000
  );

  return local.toISOString().slice(0, 10);
}

function IconoCompra({ tipo, size = 20 }) {
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
    caja: (
      <>
        <path d="m3 7 9-4 9 4-9 5-9-5Z" />
        <path d="M3 7v10l9 4 9-4V7M12 12v9" />
      </>
    ),
    persona: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
      </>
    ),
    cantidad: (
      <>
        <path d="M9 3 7 21M17 3l-2 18M4 8h16M3 16h16" />
      </>
    ),
    moneda: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M16 8H10a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8M12 5v14" />
      </>
    ),
    calendario: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 10h18" />
      </>
    ),
    reloj: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    agregar: <path d="M12 5v14M5 12h14" />,
    quitar: <path d="M5 12h14" />,
  };

  return <svg {...props}>{dibujos[tipo] || dibujos.caja}</svg>;
}

function crearLinea(secuencia) {
  return {
    key: `linea-compra-${secuencia}`,
    presentacionId: "",
    presentacionTexto: "",
    cantidad: "1",
    cantidadRecibida: "0",
    costoUnitario: "",
    asignaciones: {},
  };
}

export default function Compras() {
  const [compras, setCompras] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [presentaciones, setPresentaciones] = useState([]);
  const [productos, setProductos] = useState([]);
  const [pedidos, setPedidos] = useState([]);

  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState("");
  const [intentoCarga, setIntentoCarga] = useState(0);

  const secuenciaLineaRef = useRef(0);
  const [lineasCompra, setLineasCompra] = useState(() => [
    crearLinea(0),
  ]);
  const [proveedorId, setProveedorId] = useState("");
  const [fecha, setFecha] = useState(fechaHoy);

  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [tipoMensaje, setTipoMensaje] = useState("exito");
  const [erroresCampo, setErroresCampo] = useState({});

  const [compraRecibiendo, setCompraRecibiendo] = useState(null);
  const [recepcion, setRecepcion] = useState({
    fecha: fechaHoy(),
    lineas: {},
  });
  const [guardandoRecepcion, setGuardandoRecepcion] = useState(false);
  const [errorRecepcion, setErrorRecepcion] = useState("");

  const [mostrarNuevoProveedor, setMostrarNuevoProveedor] =
    useState(false);
  const [nuevoProveedor, setNuevoProveedor] = useState({
    nombre: "",
    telefono: "",
  });
  const [guardandoProveedor, setGuardandoProveedor] =
    useState(false);
  const [errorProveedor, setErrorProveedor] = useState("");
  const seccionProveedorRef = useRef(null);
  const guardandoProveedorRef = useRef(false);

  useEffect(() => {
    if (!mostrarNuevoProveedor || !seccionProveedorRef.current) {
      return;
    }

    seccionProveedorRef.current.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
    seccionProveedorRef.current
      .querySelector("input")
      ?.focus({ preventScroll: true });
  }, [mostrarNuevoProveedor]);

  useEffect(() => {
    const controlador = new AbortController();
    let activo = true;

    async function cargarDatos() {
      setCargando(true);
      setErrorCarga("");

      try {
        const [
          comprasApi,
          proveedoresApi,
          presentacionesApi,
          productosApi,
          pedidosApi,
        ] = await Promise.all([
          listarCompras({ signal: controlador.signal }),
          listarProveedores({ signal: controlador.signal }),
          listarPresentaciones({ signal: controlador.signal }),
          listarProductosAdmin({ signal: controlador.signal }),
          listarPedidos({ signal: controlador.signal }),
        ]);

        if (!activo) return;

        const proveedoresActivos = proveedoresApi.filter(
          (proveedor) => proveedor.activo !== false
        );

        setCompras(comprasApi);
        setProveedores(proveedoresApi);
        setPresentaciones(presentacionesApi);
        setProductos(productosApi);
        setPedidos(pedidosApi);
        setProveedorId((actual) =>
          actual ||
          (proveedoresActivos[0]
            ? String(proveedoresActivos[0].id)
            : "")
        );
      } catch (errorDatos) {
        if (!activo || errorDatos?.isCanceled) return;

        setErrorCarga(
          errorDatos?.message ||
            "No se pudieron cargar los datos de compras."
        );
      } finally {
        if (activo) setCargando(false);
      }
    }

    cargarDatos();

    return () => {
      activo = false;
      controlador.abort();
    };
  }, [intentoCarga]);

  const productosPorId = useMemo(
    () =>
      new Map(
        productos.map((producto) => [
          String(producto.id),
          producto,
        ])
      ),
    [productos]
  );

  const proveedoresActivos = useMemo(
    () =>
      proveedores.filter(
        (proveedor) => proveedor.activo !== false
      ),
    [proveedores]
  );

  const presentacionesDisponibles = useMemo(
    () =>
      presentaciones.filter((presentacion) => {
        const producto = productosPorId.get(
          String(presentacion.producto)
        );

        return (
          presentacion.activo !== false &&
          producto?.activo !== false
        );
      }),
    [presentaciones, productosPorId]
  );

  const presentacionesPorId = useMemo(
    () =>
      new Map(
        presentacionesDisponibles.map((presentacion) => [
          String(presentacion.id),
          presentacion,
        ])
      ),
    [presentacionesDisponibles]
  );

  const opcionesPresentaciones = useMemo(
    () =>
      construirOpcionesPresentaciones(
        presentacionesDisponibles,
        productosPorId
      ),
    [presentacionesDisponibles, productosPorId]
  );

  const totalEstimado = calcularTotalCompra(lineasCompra);

  const puedeRegistrar =
    !cargando &&
    !errorCarga &&
    proveedoresActivos.length > 0 &&
    lineasCompra.length > 0 &&
    lineasCompra.every(
      (linea) =>
        Boolean(linea.presentacionId) &&
        Number(linea.cantidad) >= 1 &&
        Number(linea.costoUnitario) > 0
    );

  function asignacionesDisponibles(linea) {
    const presentacion = presentacionesPorId.get(
      String(linea.presentacionId)
    );

    if (!presentacion) return [];

    return pedidos.flatMap((pedido) => {
      if (
        pedido.venta ||
        !["confirmado", "por_comprar", "comprado"].includes(
          pedido.estado,
        )
      ) {
        return [];
      }

      return (pedido.detalles || [])
        .filter((detalle) => {
          const pendiente =
            Number(detalle.cantidad || 0) -
            Number(detalle.cantidad_recibida || 0);

          if (pendiente <= 0) return false;

          const presentacionPedido = detalle.presentacion
            ? presentacionesPorId.get(
                String(detalle.presentacion)
              )
            : resolverPresentacion(
                presentacionesDisponibles,
                detalle.producto,
                detalle.porcentaje_recarga
              );

          return detalleCompatibleConPresentacion(
            detalle,
            presentacion,
            presentacionPedido,
          );
        })
        .map((detalle) => ({
          pedidoId: pedido.id,
          cliente: pedido.cliente_nombre || "Cliente",
          detalleId: detalle.id,
          producto: detalle.producto_nombre || "Producto",
          porcentaje: detalle.porcentaje_recarga,
          solicitadas: Number(detalle.cantidad || 0),
          recibidas: Number(detalle.cantidad_recibida || 0),
          pendientes:
            Number(detalle.cantidad || 0) -
            Number(detalle.cantidad_recibida || 0),
        }));
    });
  }

  function actualizarLinea(key, cambios) {
    setLineasCompra((actuales) =>
      actuales.map((linea) => {
        if (linea.key !== key) return linea;

        const siguiente = { ...linea, ...cambios };

        if (
          "cantidad" in cambios &&
          Number(siguiente.cantidadRecibida) >
            Number(siguiente.cantidad)
        ) {
          siguiente.cantidadRecibida = siguiente.cantidad;
        }

        return siguiente;
      })
    );
    setMensaje("");
    setErroresCampo({});
  }

  function actualizarAsignacion(key, detalleId, valor) {
    setLineasCompra((actuales) =>
      actuales.map((linea) =>
        linea.key === key
          ? {
              ...linea,
              asignaciones: {
                ...linea.asignaciones,
                [detalleId]: limpiarEntero(valor),
              },
            }
          : linea
      )
    );
    setMensaje("");
    setErroresCampo({});
  }

  function seleccionarPresentacion(key, item) {
    actualizarLinea(key, {
      presentacionId: String(item.id),
      presentacionTexto: item.label,
      asignaciones: {},
    });
  }

  function cambiarTextoPresentacion(key, texto) {
    actualizarLinea(key, {
      presentacionTexto: texto,
      presentacionId: "",
      asignaciones: {},
    });
  }

  function agregarLinea() {
    secuenciaLineaRef.current += 1;
    setLineasCompra((actuales) => [
      ...actuales,
      crearLinea(secuenciaLineaRef.current),
    ]);
  }

  function eliminarLinea(key) {
    setLineasCompra((actuales) => {
      if (actuales.length <= 1) return actuales;
      return actuales.filter((linea) => linea.key !== key);
    });
  }

  function abrirNuevoProveedor() {
    setErrorProveedor("");
    setMostrarNuevoProveedor(true);
  }

  async function registrarNuevoProveedor(event) {
    event.preventDefault();

    if (guardandoProveedorRef.current) return;

    guardandoProveedorRef.current = true;
    setErrorProveedor("");
    setMensaje("");

    try {
      setGuardandoProveedor(true);
      const proveedor = await crearProveedor(nuevoProveedor);

      const { proveedores: actualizados, proveedorId: nuevoId } =
        incorporarProveedor(proveedores, proveedor);

      setProveedores(actualizados);
      setProveedorId(nuevoId);
      setNuevoProveedor({ nombre: "", telefono: "" });
      setMostrarNuevoProveedor(false);
      setMensaje("Proveedor creado correctamente.");
      setTipoMensaje("exito");
    } catch (errorProveedorApi) {
      setErrorProveedor(
        errorProveedorApi?.message ||
          "No se pudo crear el proveedor."
      );
    } finally {
      guardandoProveedorRef.current = false;
      setGuardandoProveedor(false);
    }
  }

  async function registrarCompraFormulario(event) {
    event.preventDefault();
    setMensaje("");
    setErroresCampo({});

    if (!puedeRegistrar) return;

    try {
      setGuardando(true);
      const compra = await registrarCompra({
        proveedorId,
        fecha,
        lineas: lineasCompra.map((linea) => ({
          presentacionId: linea.presentacionId,
          cantidad: linea.cantidad,
          cantidadRecibida: linea.cantidadRecibida,
          costoUnitario: linea.costoUnitario,
          asignaciones: Object.entries(linea.asignaciones)
            .filter(([, cantidad]) => Number(cantidad) > 0)
            .map(([detalleId, cantidad]) => ({
              detallePedidoId: Number(detalleId),
              cantidad: Number(cantidad),
            })),
        })),
      });

      setCompras((actuales) =>
        [compra, ...actuales].sort((a, b) => {
          const fechaComparada = String(b.fecha).localeCompare(
            String(a.fecha)
          );

          return fechaComparada || Number(b.id) - Number(a.id);
        })
      );
      secuenciaLineaRef.current = 0;
      setLineasCompra([crearLinea(0)]);
      setMensaje(
        "Compra registrada correctamente."
      );
      setTipoMensaje("exito");
      setIntentoCarga((valor) => valor + 1);
    } catch (errorCompra) {
      const campos = errorCompra?.fieldErrors || {};
      setErroresCampo(campos);
      setMensaje(
        Object.keys(campos).length
          ? "Revisa los campos de la compra."
          : errorCompra?.message ||
            "No se pudo registrar la compra."
      );
      setTipoMensaje("error");
    } finally {
      setGuardando(false);
    }
  }

  function cantidadPendienteCompra(compra) {
    return (compra.detalles || []).reduce(
      (total, detalle) =>
        total + Number(detalle.cantidad_pendiente || 0),
      0,
    );
  }

  function abrirRecepcion(compra) {
    const lineas = {};

    for (const detalle of compra.detalles || []) {
      const pendiente = Number(detalle.cantidad_pendiente || 0);

      if (pendiente > 0) {
        lineas[String(detalle.id)] = {
          cantidad: String(pendiente),
          asignaciones: {},
        };
      }
    }

    setCompraRecibiendo(compra);
    setRecepcion({ fecha: fechaHoy(), lineas });
    setErrorRecepcion("");
  }

  function cerrarRecepcion() {
    if (guardandoRecepcion) return;

    setCompraRecibiendo(null);
    setRecepcion({ fecha: fechaHoy(), lineas: {} });
    setErrorRecepcion("");
  }

  function actualizarRecepcionLinea(detalleId, cambios) {
    setRecepcion((actual) => ({
      ...actual,
      lineas: {
        ...actual.lineas,
        [detalleId]: {
          ...actual.lineas[detalleId],
          ...cambios,
        },
      },
    }));
    setErrorRecepcion("");
  }

  function actualizarRecepcionAsignacion(
    detalleId,
    detallePedidoId,
    valor,
  ) {
    const linea = recepcion.lineas[detalleId];

    if (!linea) return;

    actualizarRecepcionLinea(detalleId, {
      asignaciones: {
        ...linea.asignaciones,
        [detallePedidoId]: limpiarEntero(valor),
      },
    });
  }

  async function confirmarRecepcion(evento) {
    evento.preventDefault();

    if (!compraRecibiendo || guardandoRecepcion) return;

    setGuardandoRecepcion(true);
    setErrorRecepcion("");

    try {
      const lineas = Object.entries(recepcion.lineas)
        .map(([detalleId, linea]) => ({
          detalleCompraId: Number(detalleId),
          cantidad: Number(linea.cantidad || 0),
          asignaciones: Object.entries(linea.asignaciones || {})
            .filter(([, cantidad]) => Number(cantidad) > 0)
            .map(([detallePedidoId, cantidad]) => ({
              detallePedidoId: Number(detallePedidoId),
              cantidad: Number(cantidad),
            })),
        }))
        .filter((linea) => linea.cantidad > 0);

      const compra = await registrarRecepcionCompra(
        compraRecibiendo.id,
        {
          fecha: recepcion.fecha,
          lineas,
        },
      );

      setCompras((actuales) =>
        actuales.map((item) =>
          String(item.id) === String(compra.id) ? compra : item
        )
      );
      setMensaje(
        `Recepción registrada para la compra #${compra.id}.`,
      );
      setTipoMensaje("exito");
      setCompraRecibiendo(null);
      setRecepcion({ fecha: fechaHoy(), lineas: {} });
      setIntentoCarga((valor) => valor + 1);
    } catch (errorRecepcionApi) {
      setErrorRecepcion(
        errorRecepcionApi?.message ||
          "No se pudo registrar la recepción.",
      );
    } finally {
      setGuardandoRecepcion(false);
    }
  }

  return (
    <section className="compras-modulo">
      <div className="compras-contenido">
        <header className="compras-encabezado">
          <p className="compras-etiqueta">MYC PERFUMES</p>
          <h1>Registrar compra</h1>
          <p className="compras-subtitulo">
            Registra compras reales y asígnalas a las líneas de pedido.
          </p>
        </header>

        {errorCarga && (
          <div className="compras-error-carga" role="alert">
            <p>{errorCarga}</p>
            <button
              type="button"
              className="compras-boton-reintentar"
              onClick={() =>
                setIntentoCarga((valor) => valor + 1)
              }
            >
              Reintentar
            </button>
          </div>
        )}

        <div className="compras-panel">
          {(proveedoresActivos.length === 0 ||
            mostrarNuevoProveedor) && (
            <section
              className="compras-nuevo-proveedor"
              ref={seccionProveedorRef}
            >
              <div className="compras-nuevo-proveedor-cabecera">
                <div>
                  <h3>Nuevo proveedor</h3>
                  <p>
                    Agrega los datos del proveedor para usarlo en esta
                    compra.
                  </p>
                </div>

                {proveedoresActivos.length > 0 && (
                  <button
                    type="button"
                    className="compras-cerrar-proveedor"
                    onClick={() =>
                      setMostrarNuevoProveedor(false)
                    }
                    aria-label="Cerrar formulario de proveedor"
                  >
                    ×
                  </button>
                )}
              </div>

              <form
                className="compras-formulario-proveedor"
                onSubmit={registrarNuevoProveedor}
              >
                <label>
                  Nombre *
                  <input
                    type="text"
                    value={nuevoProveedor.nombre}
                    onChange={(event) => {
                      setNuevoProveedor((actual) => ({
                        ...actual,
                        nombre: event.target.value,
                      }));
                      setErrorProveedor("");
                    }}
                    maxLength={150}
                    autoComplete="organization"
                    required
                  />
                </label>

                <label>
                  Teléfono
                  <input
                    type="text"
                    value={nuevoProveedor.telefono}
                    onChange={(event) => {
                      setNuevoProveedor((actual) => ({
                        ...actual,
                        telefono: event.target.value,
                      }));
                      setErrorProveedor("");
                    }}
                    maxLength={20}
                    autoComplete="tel"
                  />
                </label>

                <button
                  type="submit"
                  className="compras-boton-guardar"
                  disabled={guardandoProveedor}
                >
                  <IconoCompra tipo="agregar" size={16} />
                  {guardandoProveedor
                    ? "Creando..."
                    : "Crear proveedor"}
                </button>
              </form>

              {errorProveedor && (
                <p className="compras-mensaje" role="alert">
                  {errorProveedor}
                </p>
              )}
            </section>
          )}

          <form
            className="compras-formulario compras-formulario-multiple"
            onSubmit={registrarCompraFormulario}
            aria-busy={guardando}
          >
            <div className="compras-campo compras-campo-proveedor">
              <label htmlFor="compra-proveedor">Proveedor</label>
              <div className="compras-input-con-icono">
                <IconoCompra tipo="persona" size={19} />
                <select
                  id="compra-proveedor"
                  value={proveedorId}
                  onChange={(evento) =>
                    setProveedorId(evento.target.value)
                  }
                  disabled={
                    guardando ||
                    cargando ||
                    Boolean(errorCarga) ||
                    proveedoresActivos.length === 0
                  }
                  required
                >
                  <option value="">
                    {proveedoresActivos.length
                      ? "Selecciona un proveedor"
                      : "No hay proveedores activos"}
                  </option>
                  {proveedoresActivos.map((proveedor) => (
                    <option
                      key={proveedor.id}
                      value={String(proveedor.id)}
                    >
                      {proveedor.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                className="compras-enlace-proveedor"
                onClick={abrirNuevoProveedor}
                disabled={guardando || cargando || Boolean(errorCarga)}
                aria-expanded={mostrarNuevoProveedor}
              >
                + Nuevo proveedor
              </button>
            </div>

            <div className="compras-campo">
              <label htmlFor="compra-fecha">
                Fecha de compra
              </label>
              <div className="compras-input-con-icono compras-input-fecha">
                <IconoCompra tipo="calendario" size={19} />
                <input
                  id="compra-fecha"
                  type="date"
                  value={fecha}
                  onChange={(evento) =>
                    setFecha(evento.target.value)
                  }
                  disabled={guardando}
                  required
                />
              </div>
            </div>

            <div className="compras-lineas">
              {lineasCompra.map((linea, indice) => {
                const opcion =
                  opcionesPresentaciones.find(
                    (item) =>
                      String(item.id) ===
                      String(linea.presentacionId)
                  );
                const asignables =
                  asignacionesDisponibles(linea);
                const subtotal =
                  Math.max(0, Number(linea.cantidad) || 0) *
                  Math.max(
                    0,
                    Number(linea.costoUnitario) || 0
                  );

                return (
                  <section
                    className="compras-linea"
                    key={linea.key}
                  >
                    <div className="compras-linea-cabecera">
                      <h3>Línea {indice + 1}</h3>

                      {lineasCompra.length > 1 && (
                        <button
                          type="button"
                          className="compras-quitar-linea"
                          onClick={() => eliminarLinea(linea.key)}
                          disabled={guardando}
                          aria-label={`Quitar línea ${indice + 1}`}
                        >
                          <IconoCompra tipo="quitar" size={16} />
                          Quitar
                        </button>
                      )}
                    </div>

                    <div className="compras-linea-grid">
                      <div className="compras-campo compras-campo-producto">
                        <label htmlFor={`compra-presentacion-${linea.key}`}>
                          Presentación interna
                        </label>
                        <div className="compras-input-con-icono">
                          <IconoCompra tipo="caja" size={19} />
                          <BuscadorSugerencias
                            id={`compra-presentacion-${linea.key}`}
                            value={linea.presentacionTexto}
                            onChange={(texto) =>
                              cambiarTextoPresentacion(
                                linea.key,
                                texto
                              )
                            }
                            onSelect={(item) =>
                              seleccionarPresentacion(
                                linea.key,
                                item
                              )
                            }
                            items={opcionesPresentaciones}
                            placeholder="Buscar producto..."
                            noResultsText="No hay presentaciones que coincidan."
                            selectedId={linea.presentacionId}
                            disabled={
                              guardando ||
                              cargando ||
                              Boolean(errorCarga) ||
                              opcionesPresentaciones.length === 0
                            }
                            ariaLabel="Buscar presentación para la compra"
                          />
                        </div>

                        {opcion && (
                          <small className="compras-ayuda">
                            {opcion.description}
                          </small>
                        )}
                      </div>

                      <div className="compras-campo compras-campo-cantidad">
                        <label htmlFor={`compra-cantidad-${linea.key}`}>
                          Cantidad comprada
                        </label>
                        <div className="compras-input-con-icono">
                          <IconoCompra tipo="cantidad" size={19} />
                          <input
                            id={`compra-cantidad-${linea.key}`}
                            type="number"
                            min="1"
                            step="1"
                            value={linea.cantidad}
                            onChange={(evento) =>
                              actualizarLinea(linea.key, {
                                cantidad: evento.target.value,
                              })
                            }
                            disabled={guardando}
                            required
                          />
                        </div>
                      </div>

                      <div className="compras-campo compras-campo-cantidad">
                        <label htmlFor={`compra-recibida-${linea.key}`}>
                          Cantidad recibida ahora
                        </label>
                        <div className="compras-input-con-icono">
                          <IconoCompra tipo="cantidad" size={19} />
                          <input
                            id={`compra-recibida-${linea.key}`}
                            type="number"
                            min="0"
                            max={linea.cantidad}
                            step="1"
                            value={linea.cantidadRecibida}
                            onChange={(evento) =>
                              actualizarLinea(linea.key, {
                                cantidadRecibida:
                                  evento.target.value,
                              })
                            }
                            disabled={guardando}
                          />
                        </div>
                        <small className="compras-ayuda">
                          Déjala en 0 si la compra todavía no se ha
                          recibido físicamente.
                        </small>
                      </div>

                      <div className="compras-campo compras-campo-costo">
                        <label htmlFor={`compra-costo-${linea.key}`}>
                          Costo unitario
                        </label>
                        <div className="compras-input-con-icono">
                          <IconoCompra tipo="moneda" size={19} />
                          <input
                            id={`compra-costo-${linea.key}`}
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={linea.costoUnitario}
                            onChange={(evento) =>
                              actualizarLinea(linea.key, {
                                costoUnitario:
                                  evento.target.value,
                              })
                            }
                            disabled={guardando}
                            placeholder="Costo unitario"
                            required
                          />
                        </div>
                      </div>

                      <div className="compras-subtotal-linea">
                        <span>Subtotal</span>
                        <strong>{dinero(subtotal)}</strong>
                      </div>
                    </div>

                    {linea.presentacionId &&
                      Number(linea.cantidadRecibida) > 0 && (
                      <div className="compras-asignaciones">
                        <div className="compras-asignaciones-cabecera">
                          <h4>Asignar a pedidos</h4>
                          <span>
                            {asignables.length
                              ? `${asignables.length} línea(s) pendiente(s)`
                              : "Sin líneas pendientes para esta presentación"}
                          </span>
                        </div>

                        {asignables.length > 0 && (
                          <div className="compras-asignaciones-lista">
                            {asignables.map((detalle) => (
                              <label
                                className="compras-asignacion"
                                key={detalle.detalleId}
                              >
                                <span>
                                  <strong>
                                    Pedido #{detalle.pedidoId} ·{" "}
                                    {detalle.cliente}
                                  </strong>
                                  <small>
                                    {detalle.producto} ·{" "}
                                    {detalle.porcentaje} % · Solicitadas{" "}
                                    {detalle.solicitadas} · Recibidas{" "}
                                    {detalle.recibidas} · Pendientes{" "}
                                    {detalle.pendientes}
                                  </small>
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  max={detalle.pendientes}
                                  step="1"
                                  value={
                                    linea.asignaciones[
                                      detalle.detalleId
                                    ] || ""
                                  }
                                  onChange={(evento) =>
                                    actualizarAsignacion(
                                      linea.key,
                                      detalle.detalleId,
                                      evento.target.value
                                    )
                                  }
                                  placeholder="0"
                                  disabled={guardando}
                                  aria-label={`Cantidad a asignar al pedido ${detalle.pedidoId}`}
                                />
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>

            <button
              type="button"
              className="compras-agregar-linea"
              onClick={agregarLinea}
              disabled={guardando}
            >
              <IconoCompra tipo="agregar" size={17} />
              Añadir otra línea
            </button>

            <div className="compras-resumen compras-resumen-total">
              <span>
                Total de la compra
                <small>Se calcula automáticamente con las líneas.</small>
              </span>
              <strong>{dinero(totalEstimado)}</strong>
            </div>

            {Object.keys(erroresCampo).length > 0 && (
              <div className="compras-errores-campo" role="alert">
                <strong>Revisa la compra:</strong>
                <ul>
                  {Object.entries(erroresCampo).map(
                    ([campo, errorCampo]) => (
                      <li key={campo}>
                        <b>{campo}:</b> {errorCampo}
                      </li>
                    )
                  )}
                </ul>
              </div>
            )}

            {mensaje && (
              <p
                className={`compras-mensaje ${
                  tipoMensaje === "exito"
                    ? "compras-mensaje-exito"
                    : ""
                }`}
                role="status"
              >
                {mensaje}
              </p>
            )}

            <button
              type="submit"
              className="compras-boton-guardar"
              disabled={guardando || !puedeRegistrar}
            >
              <IconoCompra tipo="check" size={17} />
              {guardando
                ? "Registrando..."
                : "Registrar compra"}
            </button>
          </form>

          {!cargando &&
            !errorCarga &&
            proveedoresActivos.length === 0 && (
              <p className="compras-aviso">
                Crea un proveedor para poder registrar compras.
              </p>
            )}

          {!cargando &&
            !errorCarga &&
            presentacionesDisponibles.length === 0 && (
              <p className="compras-aviso">
                No hay presentaciones activas disponibles. Verifica que
                los productos estén activos y correctamente configurados.
              </p>
            )}

          <section className="compras-historial">
            <div className="compras-seccion-titulo">
              <span className="compras-icono-principal compras-icono-reloj">
                <IconoCompra tipo="reloj" size={21} />
              </span>
              <div>
                <h2>Compras recientes</h2>
                <p>Historial de compras y asignaciones.</p>
              </div>
            </div>

            {cargando ? (
              <div className="compras-vacio">
                <IconoCompra tipo="reloj" size={28} />
                <p>Cargando compras...</p>
              </div>
            ) : compras.length === 0 ? (
              <div className="compras-vacio">
                <IconoCompra tipo="caja" size={28} />
                <p>Tus compras registradas aparecerán aquí.</p>
                <span>
                  Completa el formulario para registrar la primera compra.
                </span>
              </div>
            ) : (
              <div className="compras-tabla-contenedor">
                <table className="compras-tabla">
                  <thead>
                    <tr>
                      <th>Compra</th>
                      <th>Proveedor</th>
                      <th>Fecha</th>
                      <th>Detalles</th>
                      <th>Total</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compras.map((compra) => (
                      <tr key={compra.id}>
                        <td>
                          <strong>#{compra.id}</strong>
                        </td>
                        <td>{compra.proveedor_nombre}</td>
                        <td>{compra.fecha}</td>
                        <td>
                          <div className="compras-detalles">
                            {(compra.detalles || []).map(
                              (detalle) => (
                                <span key={detalle.id}>
                                  <b>
                                    {detalle.producto_nombre} ·{" "}
                                    {detalle.porcentaje} % ·{" "}
                                    {detalle.cantidad} ×{" "}
                                    {dinero(detalle.costo_unitario)} ={" "}
                                    {dinero(detalle.subtotal)}
                                  </b>
                                  <small>
                                    Recibidas:{" "}
                                    {detalle.cantidad_recibida} ·
                                    Pendientes:{" "}
                                    {detalle.cantidad_pendiente}
                                  </small>
                                  {(detalle.asignaciones || [])
                                    .length > 0 && (
                                    <small>
                                      Pedidos:{" "}
                                      {(detalle.asignaciones || [])
                                        .map(
                                          (asignacion) =>
                                            `#${asignacion.pedido} (${asignacion.cantidad})`
                                        )
                                        .join(" · ")}
                                    </small>
                                  )}
                                </span>
                              )
                            )}
                          </div>
                        </td>
                        <td>{dinero(compra.total)}</td>
                        <td>
                          {cantidadPendienteCompra(compra) > 0 ? (
                            <button
                              type="button"
                              className="compras-boton-recibir"
                              onClick={() => abrirRecepcion(compra)}
                            >
                              Recibir{" "}
                              {cantidadPendienteCompra(compra)}
                            </button>
                          ) : (
                            <span className="compras-recibida-total">
                              Recibida
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>

      {compraRecibiendo && (
        <div
          className="compras-modal-fondo"
          role="presentation"
          onMouseDown={(evento) => {
            if (
              !guardandoRecepcion &&
              evento.target === evento.currentTarget
            ) {
              cerrarRecepcion();
            }
          }}
        >
          <section
            className="compras-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="compras-recepcion-titulo"
          >
            <header className="compras-modal-encabezado">
              <div>
                <small>Compra #{compraRecibiendo.id}</small>
                <h2 id="compras-recepcion-titulo">
                  Registrar recepción
                </h2>
              </div>
              <button
                type="button"
                onClick={cerrarRecepcion}
                disabled={guardandoRecepcion}
                aria-label="Cerrar recepción"
              >
                ×
              </button>
            </header>

            <form
              className="compras-modal-formulario"
              onSubmit={confirmarRecepcion}
            >
              <label>
                Fecha de recepción
                <input
                  type="date"
                  value={recepcion.fecha}
                  onChange={(evento) =>
                    setRecepcion((actual) => ({
                      ...actual,
                      fecha: evento.target.value,
                    }))
                  }
                  required
                  disabled={guardandoRecepcion}
                />
              </label>

              {(compraRecibiendo.detalles || [])
                .filter(
                  (detalle) =>
                    Number(detalle.cantidad_pendiente || 0) > 0,
                )
                .map((detalle) => {
                  const linea = recepcion.lineas[String(detalle.id)];
                  const asignables = asignacionesDisponibles({
                    presentacionId: String(detalle.presentacion),
                  });

                  if (!linea) return null;

                  return (
                    <article
                      className="compras-modal-linea"
                      key={detalle.id}
                    >
                      <div className="compras-modal-linea-cabecera">
                        <div>
                          <strong>
                            {detalle.producto_nombre} ·{" "}
                            {detalle.porcentaje} %
                          </strong>
                          <small>
                            Pendiente: {detalle.cantidad_pendiente}
                          </small>
                        </div>
                        <label>
                          Recibir
                          <input
                            type="number"
                            min="1"
                            max={detalle.cantidad_pendiente}
                            step="1"
                            value={linea.cantidad}
                            onChange={(evento) =>
                              actualizarRecepcionLinea(
                                String(detalle.id),
                                {
                                  cantidad: limpiarEntero(
                                    evento.target.value,
                                  ),
                                },
                              )
                            }
                            disabled={guardandoRecepcion}
                            required
                          />
                        </label>
                      </div>

                      {asignables.length > 0 && (
                        <div className="compras-asignaciones-lista">
                          {asignables.map((pedidoDetalle) => (
                            <label
                              className="compras-asignacion"
                              key={pedidoDetalle.detalleId}
                            >
                              <span>
                                <strong>
                                  Pedido #{pedidoDetalle.pedidoId} ·{" "}
                                  {pedidoDetalle.cliente}
                                </strong>
                                <small>
                                  {pedidoDetalle.producto} ·{" "}
                                  Pendientes{" "}
                                  {pedidoDetalle.pendientes}
                                </small>
                              </span>
                              <input
                                type="number"
                                min="0"
                                max={pedidoDetalle.pendientes}
                                step="1"
                                value={
                                  linea.asignaciones[
                                    pedidoDetalle.detalleId
                                  ] || ""
                                }
                                onChange={(evento) =>
                                  actualizarRecepcionAsignacion(
                                    String(detalle.id),
                                    pedidoDetalle.detalleId,
                                    evento.target.value,
                                  )
                                }
                                placeholder="0"
                                disabled={guardandoRecepcion}
                              />
                            </label>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}

              {errorRecepcion && (
                <p className="compras-error" role="alert">
                  {errorRecepcion}
                </p>
              )}

              <footer className="compras-modal-acciones">
                <button
                  type="button"
                  onClick={cerrarRecepcion}
                  disabled={guardandoRecepcion}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="compras-boton-guardar"
                  disabled={guardandoRecepcion}
                >
                  {guardandoRecepcion
                    ? "Guardando..."
                    : "Confirmar recepción"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import "./Ventas.css";
import BuscadorSugerencias from "../../components/BuscadorSugerencias.jsx";
import { useAuth } from "../../context/auth-context";
import { listarProductosAdmin } from "../../services/catalogoAdmin.js";
import {
  MENSAJE_PORCENTAJE_INVALIDO,
  construirOpcionesProductos,
  porcentajeRecargaValido,
  resolverPresentacion,
} from "../../services/busquedaPresentaciones.js";
import { listarVentas } from "../../services/clientes.js";
import { resumenLineas } from "../../services/clientesResumen.js";
import {
  esFechaFutura,
  esFechaISO,
  fechaActualColombia,
} from "../../services/fechas.js";
import { crearClaveIdempotencia } from "../../services/idempotencia.js";
import { listarPresentaciones } from "../../services/presentaciones.js";
import { crearVenta } from "../../services/ventas.js";

const ETIQUETAS_PAGO = {
  pagado: "Pagado",
  abonado: "Abonado",
  pendiente: "Pendiente",
};

const ETIQUETAS_ABASTECIMIENTO = {
  completo: "Completo",
  parcial: "Por comprar",
  pendiente: "Por comprar",
};

const OPCIONES_PAGO = [
  { valor: "pagado", etiqueta: "Pagado", icono: "check" },
  { valor: "abonado", etiqueta: "Abonado", icono: "moneda" },
  { valor: "pendiente", etiqueta: "Pendiente", icono: "reloj" },
];

function dinero(valor) {
  return Number(valor || 0).toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });
}

function fechaCorta(valor) {
  if (!valor) return "Sin fecha";
  const fecha = new Date(String(valor).length === 10 ? `${valor}T12:00:00` : valor);
  if (Number.isNaN(fecha.getTime())) return valor;
  return fecha.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

function limpiarImporte(valor) {
  return String(valor ?? "").replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
}

function Icono({ nombre, size = 20 }) {
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
    ventas: <><path d="M3 3v18h18" /><path d="m7 14 4-4 4 3 6-7" /><path d="M16 6h5v5" /></>,
    documento: <><path d="M6 3h9l5 5v13H6z" /><path d="M14 3v6h6M9 13h8M9 17h8" /></>,
    bolsa: <><rect x="4" y="7" width="16" height="14" rx="2" /><path d="M9 7V5a3 3 0 0 1 6 0v2" /></>,
    persona: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    reloj: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    cerrar: <path d="m6 6 12 12M18 6 6 18" />,
    moneda: <><circle cx="12" cy="12" r="9" /><path d="M16 8H10a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8M12 5v14" /></>,
    caja: <><path d="m3 7 9-4 9 4-9 5-9-5Z" /><path d="M3 7v10l9 4 9-4V7M12 12v9" /></>,
    lupa: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
  };
  return <svg {...props}>{dibujos[nombre] || dibujos.documento}</svg>;
}

export default function Ventas() {
  const { isAdmin } = useAuth();
  const [ventas, setVentas] = useState([]);
  const [cargandoVentas, setCargandoVentas] = useState(true);
  const [errorVentas, setErrorVentas] = useState("");
  const [recargaVentas, setRecargaVentas] = useState(0);
  const [presentaciones, setPresentaciones] = useState([]);
  const [productos, setProductos] = useState([]);
  const [cargandoFormulario, setCargandoFormulario] = useState(isAdmin);
  const [errorFormulario, setErrorFormulario] = useState("");
  const [recargaFormulario, setRecargaFormulario] = useState(0);
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteTelefono, setClienteTelefono] = useState("");
  const [productoId, setProductoId] = useState("");
  const [productoTexto, setProductoTexto] = useState("");
  const [porcentaje, setPorcentaje] = useState("");
  const [errorPorcentaje, setErrorPorcentaje] = useState("");
  const [errorPresentacion, setErrorPresentacion] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [precioVenta, setPrecioVenta] = useState("");
  const [estadoPagoVenta, setEstadoPagoVenta] = useState("pagado");
  const [montoAbonado, setMontoAbonado] = useState("");
  const [fechaPagoVenta, setFechaPagoVenta] = useState(
    fechaActualColombia,
  );
  const [procesando, setProcesando] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [tipoMensaje, setTipoMensaje] = useState("exito");
  const claveVentaRef = useRef("");

  useEffect(() => {
    const controlador = new AbortController();
    let activo = true;

    setCargandoVentas(true);
    setErrorVentas("");

    listarVentas({ signal: controlador.signal })
      .then((datos) => {
        if (activo) setVentas(datos);
      })
      .catch((error) => {
        if (!activo || error.isCanceled) return;
        setErrorVentas(
          error.message || "No se pudieron cargar las ventas.",
        );
      })
      .finally(() => {
        if (activo) setCargandoVentas(false);
      });

    return () => {
      activo = false;
      controlador.abort();
    };
  }, [recargaVentas]);

  useEffect(() => {
    if (!isAdmin) {
      setPresentaciones([]);
      setProductos([]);
      setCargandoFormulario(false);
      setErrorFormulario("");
      return undefined;
    }

    const controlador = new AbortController();
    let activo = true;

    setCargandoFormulario(true);
    setErrorFormulario("");

    Promise.all([
      listarPresentaciones({ signal: controlador.signal }),
      listarProductosAdmin({ signal: controlador.signal }),
    ])
      .then(([presentacionesData, productosData]) => {
        if (!activo) return;
        setPresentaciones(presentacionesData);
        setProductos(productosData);
      })
      .catch((error) => {
        if (!activo || error.isCanceled) return;
        setErrorFormulario(
          error.message ||
            "No se pudieron cargar las presentaciones.",
        );
      })
      .finally(() => {
        if (activo) setCargandoFormulario(false);
      });

    return () => {
      activo = false;
      controlador.abort();
    };
  }, [isAdmin, recargaFormulario]);

  const productosPorId = useMemo(
    () =>
      new Map(
        productos.map((producto) => [String(producto.id), producto]),
      ),
    [productos],
  );

  const presentacionesDisponibles = useMemo(
    () =>
      presentaciones
        .filter((presentacion) => {
          if (!presentacion.activo) return false;
          const producto = productosPorId.get(
            String(presentacion.producto),
          );
          return !producto || producto.activo !== false;
        })
        .map((presentacion) => {
          const producto = productosPorId.get(
            String(presentacion.producto),
          );

          return {
            ...presentacion,
            contenido_ml: producto?.contenido_ml ?? null,
            producto_activo: producto?.activo !== false,
          };
        })
        .sort((a, b) =>
          String(a.producto_nombre || "").localeCompare(
            String(b.producto_nombre || ""),
            "es",
          ) || a.porcentaje - b.porcentaje,
        ),
    [presentaciones, productosPorId],
  );

  const opcionesProductos = useMemo(
    () =>
      construirOpcionesProductos(
        productos,
        presentacionesDisponibles,
      ),
    [productos, presentacionesDisponibles],
  );

  const productoSeleccionado = productosPorId.get(
    String(productoId),
  );

  const presentacionResuelta = useMemo(
    () =>
      resolverPresentacion(
        presentacionesDisponibles,
        productoId,
        porcentaje,
      ),
    [presentacionesDisponibles, productoId, porcentaje],
  );

  useEffect(() => {
    claveVentaRef.current = "";
  }, [
    clienteNombre,
    clienteTelefono,
    productoId,
    porcentaje,
    cantidad,
    precioVenta,
    estadoPagoVenta,
    montoAbonado,
    fechaPagoVenta,
  ]);

  const totalVenta =
    Math.max(0, Number(precioVenta) || 0) *
    Math.max(0, Number(cantidad) || 0);

  function limpiarFormulario() {
    setClienteNombre("");
    setClienteTelefono("");
    setProductoId("");
    setProductoTexto("");
    setPorcentaje("");
    setErrorPorcentaje("");
    setErrorPresentacion("");
    setCantidad("1");
    setPrecioVenta("");
    setEstadoPagoVenta("pagado");
    setMontoAbonado("");
    setFechaPagoVenta(fechaActualColombia());
  }

  function seleccionarProducto(item) {
    const producto = productosPorId.get(String(item.id));

    setProductoId(String(item.id));
    setProductoTexto(
      item.description
        ? `${item.label} · ${item.description}`
        : item.label,
    );
    setPorcentaje("");
    setErrorPorcentaje("");
    setErrorPresentacion("");
    setMontoAbonado("");
    setPrecioVenta(
      producto?.precio
        ? String(Number(producto.precio))
        : "",
    );
  }

  function cambiarTextoProducto(texto) {
    setProductoTexto(texto);
    setProductoId("");
    setPorcentaje("");
    setErrorPorcentaje("");
    setErrorPresentacion("");
    setPrecioVenta("");
    setMontoAbonado("");
  }

  function cambiarPorcentaje(valor) {
    setPorcentaje(valor);
    setErrorPorcentaje("");
    setErrorPresentacion("");
  }

  function validarPorcentajeCampo(mostrarVacio = false) {
    const valor = porcentaje.trim();

    if (!valor && !mostrarVacio) {
      setErrorPorcentaje("");
      setErrorPresentacion("");
      return false;
    }

    if (!porcentajeRecargaValido(valor)) {
      setErrorPorcentaje(MENSAJE_PORCENTAJE_INVALIDO);
      setErrorPresentacion("");
      return false;
    }

    if (!presentacionResuelta) {
      setErrorPorcentaje("");
      setErrorPresentacion(
        `No existe una presentación de ${valor} % para este producto. Verifica su configuración.`,
      );
      return false;
    }

    setErrorPorcentaje("");
    setErrorPresentacion("");
    return true;
  }

  async function registrarVentaManual(evento) {
    evento.preventDefault();

    if (procesando) return;

    const nombreCliente = clienteNombre.trim();
    const telefonoCliente = clienteTelefono.trim();
    const presentacion = presentacionResuelta;
    const cantidadNumero = Number(cantidad);
    const precioNumero = Number(precioVenta);

    if (!nombreCliente) {
      setTipoMensaje("error");
      setMensaje("Escribe el nombre del cliente.");
      return;
    }

    if (!productoSeleccionado) {
      setTipoMensaje("error");
      setMensaje("Selecciona un producto.");
      return;
    }

    if (!validarPorcentajeCampo(true)) {
      return;
    }

    if (!presentacion) {
      return;
    }

    if (
      !Number.isInteger(cantidadNumero) ||
      cantidadNumero <= 0
    ) {
      setTipoMensaje("error");
      setMensaje("La cantidad debe ser un entero mayor que cero.");
      return;
    }

    if (!Number.isFinite(precioNumero) || precioNumero <= 0) {
      setTipoMensaje("error");
      setMensaje("El precio de venta debe ser mayor que cero.");
      return;
    }

    if (
      estadoPagoVenta === "abonado" &&
      !(Number(montoAbonado) > 0)
    ) {
      setTipoMensaje("error");
      setMensaje("Indica el valor del abono inicial.");
      return;
    }

    if (
      estadoPagoVenta === "abonado" &&
      Number(montoAbonado) >= totalVenta
    ) {
      setTipoMensaje("error");
      setMensaje(
        "El abono debe ser menor que el total. Para un pago completo usa Pagado.",
      );
      return;
    }

    if (
      estadoPagoVenta !== "pendiente" &&
      !esFechaISO(fechaPagoVenta)
    ) {
      setTipoMensaje("error");
      setMensaje("La fecha del pago inicial no es válida.");
      return;
    }

    if (
      estadoPagoVenta !== "pendiente" &&
      esFechaFutura(fechaPagoVenta)
    ) {
      setTipoMensaje("error");
      setMensaje("La fecha del pago inicial no puede ser futura.");
      return;
    }

    setProcesando(true);
    setMensaje("");

    const fecha = fechaActualColombia();
    const claveIdempotencia =
      claveVentaRef.current ||
      crearClaveIdempotencia("venta");
    claveVentaRef.current = claveIdempotencia;

    try {
      const ventaFinal = await crearVenta({
        clienteNombre: nombreCliente,
        clienteTelefono: telefonoCliente,
        fecha,
        estadoPago: estadoPagoVenta,
        claveIdempotencia,
        montoInicial:
          estadoPagoVenta === "abonado"
            ? String(Number(montoAbonado))
            : undefined,
        fechaPago:
          estadoPagoVenta !== "pendiente"
            ? fechaPagoVenta
            : undefined,
        lineas: [
          {
            presentacionId: presentacion.id,
            cantidad: cantidadNumero,
            precioVenta: String(precioNumero),
          },
        ],
      });

      claveVentaRef.current = "";
      setVentas((actuales) => [ventaFinal, ...actuales]);
      const pendientes = Number(
        ventaFinal.unidades_pendientes_abastecimiento || 0,
      );
      setTipoMensaje("exito");
      setMensaje(
        `Venta #${ventaFinal.id} registrada para ${
          ventaFinal.cliente_nombre || nombreCliente
        }.` +
          (pendientes > 0
            ? ` Quedan ${pendientes} unidad(es) por comprar.`
            : ""),
      );
      limpiarFormulario();
    } catch (error) {
      setTipoMensaje("error");
      setMensaje(
        error.message ||
          "No se pudo registrar la venta. Los datos se conservaron.",
      );
    } finally {
      setProcesando(false);
    }
  }

  return (
    <section className="ventas-page">
      <header className="ventas-page-heading">
        <div className="ventas-heading-icon">
          <Icono nombre="ventas" size={24} />
        </div>
        <div>
          <p className="ventas-eyebrow">MYC PERFUMES</p>
          <h1>Gestión de ventas</h1>
          <p>
            Consulta las ventas registradas y registra ventas manuales.
          </p>
        </div>
      </header>

      {mensaje && (
        <div
          className={`ventas-message ${tipoMensaje}`}
          role="status"
        >
          {mensaje}
          <button
            type="button"
            onClick={() => setMensaje("")}
            aria-label="Cerrar mensaje"
          >
            ×
          </button>
        </div>
      )}

      <div className="ventas-panel">
        {isAdmin && (
          <div className="ventas-form-section">
            <div className="ventas-section-title">
              <span className="ventas-small-icon">
                <Icono nombre="documento" size={20} />
              </span>
              <div>
                <h2>Registrar venta manual</h2>
                <p>
                  Escribe los datos del cliente, busca el producto e
                  indica el porcentaje de recarga.
                </p>
              </div>
            </div>

            {cargandoFormulario ? (
              <div className="ventas-form-state">
                <Icono nombre="reloj" size={21} />
                <p>Cargando presentaciones...</p>
              </div>
            ) : errorFormulario ? (
              <div className="ventas-form-state ventas-form-state-error">
                <p>{errorFormulario}</p>
                <button
                  type="button"
                  className="ventas-reintentar"
                  onClick={() =>
                    setRecargaFormulario((actual) => actual + 1)
                  }
                >
                  Reintentar
                </button>
              </div>
            ) : !opcionesProductos.length ? (
              <div className="ventas-form-notice">
                No hay productos con presentaciones activas disponibles
                para vender.
              </div>
            ) : (
              <form
                className="ventas-form"
                onSubmit={registrarVentaManual}
              >
                <div className="ventas-fields-grid">
                  <label
                    className="ventas-field"
                    htmlFor="venta-cliente-nombre"
                  >
                    <span>Nombre del cliente</span>
                    <input
                      id="venta-cliente-nombre"
                      type="text"
                      value={clienteNombre}
                      onChange={(evento) => {
                        setClienteNombre(evento.target.value);
                        setMensaje("");
                      }}
                      placeholder="Ej. Laura Méndez"
                      maxLength="150"
                      autoComplete="name"
                      disabled={procesando}
                      required
                    />
                  </label>

                  <label
                    className="ventas-field"
                    htmlFor="venta-cliente-telefono"
                  >
                    <span>Celular del cliente</span>
                    <input
                      id="venta-cliente-telefono"
                      type="tel"
                      value={clienteTelefono}
                      onChange={(evento) => {
                        setClienteTelefono(evento.target.value);
                        setMensaje("");
                      }}
                      placeholder="Ej. 3001234567"
                      maxLength="20"
                      autoComplete="tel"
                      disabled={procesando}
                    />
                    <small>
                      Si coincide con un cliente existente, se reutiliza.
                    </small>
                  </label>

                  <div className="ventas-field ventas-field-wide">
                    <label htmlFor="venta-producto">Producto</label>
                    <BuscadorSugerencias
                      id="venta-producto"
                      value={productoTexto}
                      onChange={cambiarTextoProducto}
                      onSelect={seleccionarProducto}
                      items={opcionesProductos}
                      placeholder="Buscar perfume..."
                      noResultsText="No hay productos que coincidan."
                      selectedId={productoId}
                      disabled={procesando}
                      ariaLabel="Buscar producto para la venta"
                    />
                  </div>

                  {productoSeleccionado && (
                    <div className="ventas-field ventas-field-porcentaje">
                      <label htmlFor="venta-porcentaje">
                        Porcentaje de recarga
                      </label>
                      <input
                        id="venta-porcentaje"
                        type="text"
                        inputMode="numeric"
                        value={porcentaje}
                        onChange={(evento) =>
                          cambiarPorcentaje(evento.target.value)
                        }
                        onBlur={() => validarPorcentajeCampo(false)}
                        placeholder="Escribe el porcentaje"
                        maxLength="3"
                        autoComplete="off"
                        disabled={procesando}
                        aria-describedby="venta-porcentaje-ayuda"
                      />
                      <span
                        id="venta-porcentaje-ayuda"
                        className="ventas-porcentaje-ayuda"
                      >
                        Porcentajes permitidos
                      </span>
                      <div
                        className="ventas-porcentaje-tags"
                        aria-hidden="true"
                        translate="no"
                      >
                        <span>40 %</span>
                        <span>60 %</span>
                        <span>70 %</span>
                        <span>80 %</span>
                      </div>
                      {errorPorcentaje && (
                        <p
                          className="ventas-porcentaje-error"
                          role="alert"
                        >
                          {errorPorcentaje}
                        </p>
                      )}
                      {errorPresentacion && (
                        <p
                          className="ventas-porcentaje-error"
                          role="alert"
                        >
                          {errorPresentacion}
                        </p>
                      )}
                    </div>
                  )}

                  <label
                    className="ventas-field"
                    htmlFor="venta-cantidad"
                  >
                    <span>Cantidad</span>
                    <input
                      id="venta-cantidad"
                      type="number"
                      min="1"
                      step="1"
                      value={cantidad}
                      onChange={(evento) =>
                        setCantidad(evento.target.value)
                      }
                      disabled={procesando}
                      required
                    />
                  </label>

                  <label
                    className="ventas-field"
                    htmlFor="venta-precio"
                  >
                    <span>Precio unitario acordado (COP)</span>
                    <input
                      id="venta-precio"
                      type="text"
                      inputMode="numeric"
                      value={precioVenta}
                      onChange={(evento) =>
                        setPrecioVenta(
                          limpiarImporte(evento.target.value),
                        )
                      }
                      placeholder="Ej. 120000"
                      autoComplete="off"
                      disabled={procesando}
                      required
                    />
                  </label>
                </div>

                <fieldset className="ventas-payment">
                  <legend>Estado de pago inicial</legend>
                  <div className="ventas-payment-options">
                    {OPCIONES_PAGO.map((opcion) => (
                      <button
                        key={opcion.valor}
                        type="button"
                        className={
                          estadoPagoVenta === opcion.valor
                            ? "activo"
                            : ""
                        }
                        onClick={() => {
                          setEstadoPagoVenta(opcion.valor);
                          if (opcion.valor !== "abonado") {
                            setMontoAbonado("");
                          }
                          setMensaje("");
                        }}
                        disabled={procesando}
                      >
                        <Icono nombre={opcion.icono} size={15} />
                        {opcion.etiqueta}
                      </button>
                    ))}
                  </div>
                </fieldset>

                {estadoPagoVenta === "abonado" && (
                  <label
                    className="ventas-field ventas-abono-field"
                    htmlFor="venta-monto-abonado"
                  >
                    <span>Valor del abono inicial (COP)</span>
                    <input
                      id="venta-monto-abonado"
                      type="text"
                      inputMode="numeric"
                      value={montoAbonado}
                      onChange={(evento) =>
                        setMontoAbonado(
                          limpiarImporte(evento.target.value),
                        )
                      }
                      placeholder="Ej. 50000"
                      autoComplete="off"
                      disabled={procesando}
                      required
                    />
                    <small>
                      Debe ser mayor que cero y menor que el total.
                    </small>
                  </label>
                )}

                {estadoPagoVenta !== "pendiente" && (
                  <label
                    className="ventas-field"
                    htmlFor="venta-fecha-pago"
                  >
                    <span>Fecha del pago inicial</span>
                    <input
                      id="venta-fecha-pago"
                      type="date"
                      max={fechaActualColombia()}
                      value={fechaPagoVenta}
                      onChange={(evento) =>
                        setFechaPagoVenta(evento.target.value)
                      }
                      disabled={procesando}
                      required
                    />
                    <small>
                      Puede ser distinta de la fecha de la venta.
                    </small>
                  </label>
                )}

                <div className="ventas-total">
                  <span>Total estimado de la venta</span>
                  <strong>{dinero(totalVenta)}</strong>
                </div>

                <button

                  className="ventas-save"
                  type="submit"
                  disabled={procesando}
                >
                  <Icono nombre="documento" size={17} />
                  {procesando
                    ? "Registrando..."
                    : "Registrar venta"}
                </button>
              </form>
            )}
          </div>
        )}

        <div className="ventas-recent">
          <div className="ventas-section-title">
            <span className="ventas-small-icon">
              <Icono nombre="reloj" size={20} />
            </span>
            <div>
              <h2>Ventas registradas</h2>
              <p>
                {isAdmin
                  ? "Consulta las ventas registradas."
                  : "Solo se muestran las ventas que registraste."}
              </p>
            </div>
          </div>

          {errorVentas ? (
            <div className="ventas-empty ventas-empty-error">
              <Icono nombre="caja" size={27} />
              <p>{errorVentas}</p>
              <button
                type="button"
                className="ventas-reintentar"
                onClick={() =>
                  setRecargaVentas((actual) => actual + 1)
                }
              >
                Reintentar
              </button>
            </div>
          ) : cargandoVentas ? (
            <div className="ventas-empty">
              <Icono nombre="reloj" size={27} />
              <p>Cargando ventas...</p>
            </div>
          ) : ventas.length === 0 ? (
            <div className="ventas-empty">
              <Icono nombre="caja" size={27} />
              <p>
                {isAdmin
                  ? "Aún no hay ventas registradas."
                  : "No tienes ventas registradas."}
              </p>
            </div>
          ) : (
            <div className="ventas-table-wrap">
              <table className="ventas-table">
                <thead>
                  <tr>
                    <th>Referencia</th>
                    <th>Cliente</th>
                    <th>Producto(s)</th>
                    <th>Estado de pago</th>
                    <th>Abastecimiento</th>
                    <th>Total</th>
                    <th>Saldo pendiente</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {ventas.map((venta) => (
                    <tr key={venta.id}>
                      <td>
                        <strong>Venta #{venta.id}</strong>
                      </td>
                      <td>{venta.cliente_nombre || "Cliente"}</td>
                      <td>{resumenLineas(venta)}</td>
                      <td>
                        <span
                          className={`ventas-status status-${
                            venta.estado_pago || "pendiente"
                          }`}
                        >
                          {ETIQUETAS_PAGO[venta.estado_pago] ||
                            venta.estado_pago ||
                            "Pendiente"}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`ventas-status status-${
                            venta.estado_abastecimiento || "completo"
                          }`}
                        >
                          {ETIQUETAS_ABASTECIMIENTO[
                            venta.estado_abastecimiento
                          ] || "Completo"}
                          {Number(
                            venta.unidades_pendientes_abastecimiento,
                          ) > 0
                            ? ` · ${venta.unidades_pendientes_abastecimiento}`
                            : ""}
                        </span>
                      </td>
                      <td>{dinero(venta.total)}</td>
                      <td>{dinero(venta.saldo)}</td>
                      <td>
                        {fechaCorta(venta.fecha || venta.creado_en)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import "./Pedidos.css";
import {
  esFechaFutura,
  esFechaISO,
  fechaActualColombia,
} from "../../services/fechas.js";
import { crearClaveIdempotencia } from "../../services/idempotencia.js";
import { listarVentas } from "../../services/clientes.js";
import {
  cambiarEstadoPedido,
  cancelarPedido as cancelarPedidoApi,
  completarVentaPedido,
  confirmarPedido as confirmarPedidoApi,
  listarPedidos,
  rechazarPedido as rechazarPedidoApi,
  registrarAnticipo,
} from "../../services/pedidosAdmin.js";
import {
  FILTROS_PEDIDO,
  calcularTotalEstimado,
  construirLineasPrecioConfirmacion,
  construirPedidosDesdeVentasPendientes,
  contarPedidosPorEstado,
  etiquetaEstadoPedido,
  etiquetaPagoPedido,
  filtrarPedidos,
  pedidoPendienteDeCompra,
  pedidoPuedeCancelar,
  pedidoPuedeRegistrarAnticipo,
  puedeConfirmarConPrecios,
  puedeGenerarVentaPedido,
  resumenPagoPedido,
  siguienteEstadoPedido,
} from "./pedidosVista.js";

const dinero = (valor) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(valor) || 0);

const limpiarImporte = (valor) =>
  String(valor ?? "").replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");

function fechaCorta(fecha) {
  if (!fecha) return "—";
  const date = new Date(fecha);
  if (Number.isNaN(date.getTime())) return fecha;
  return date.toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fechaPagoCorta(fecha) {
  if (!fecha) return "—";
  const date = new Date(`${fecha}T12:00:00`);
  if (Number.isNaN(date.getTime())) return fecha;
  return date.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

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
    bolsa: <><path d="M5 8h14l1 12H4L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>,
    reloj: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>,
    rechazo: <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" /></>,
    lupa: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
    flecha: <><path d="M4 12h15" /><path d="m13 6 6 6-6 6" /></>,
    cerrar: <><path d="m6 6 12 12M18 6 6 18" /></>,
    cliente: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20v-1.5a6.5 6.5 0 0 1 13 0V20" /><path d="M17 8h4m-2-2v4" /></>,
    caja: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="M3 8v9l9 4 9-4V8M12 13v8" /></>,
    moneda: <><circle cx="12" cy="12" r="9" /><path d="M16 8H10a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8M12 5v14" /></>,
    documento: <><path d="M6 3h9l5 5v13H6z" /><path d="M14 3v6h6M9 13h8M9 17h8" /></>,
    cancelar: <><path d="M12 3a9 9 0 1 0 9 9" /><path d="M12 7v5l3 2" /><path d="m16 3 5 5m0-5-5 5" /></>,
  };
  return <svg {...props}>{dibujos[tipo] || dibujos.bolsa}</svg>;
}

function Estado({ estado }) {
  const valor = String(estado || "").toLowerCase();
  return (
    <span className={`pedidos-estado pedidos-estado-${valor}`}>
      <i />
      {etiquetaEstadoPedido(valor)}
    </span>
  );
}

function ResumenPedido({ pedido }) {
  const detalles = pedido.detalles || [];

  return (
    <div className="pedidos-resumen-items">
      {detalles.length ? (
        detalles.map((detalle) => (
          <div
            className={`pedidos-resumen-item ${
              detalle.precio_pendiente ? "pedidos-item-pendiente" : ""
            }`}
            key={detalle.id}
          >
            <div className="pedidos-item-miniatura">
              <Icono tipo="caja" size={19} />
            </div>
            <div className="pedidos-item-info">
              <strong>{detalle.producto_nombre || "Producto"}</strong>
              <span>
                {detalle.porcentaje_recarga} % · Cant. {detalle.cantidad}
                {detalle.recarga_solicitada ? " · Recarga" : ""}
                {Number(detalle.cantidad_recibida || 0) > 0
                  ? ` �� Cubiertas ${detalle.cantidad_recibida}`
                  : ""}
                {Number(detalle.cantidad_pendiente || 0) > 0
                  ? ` �� Faltan ${detalle.cantidad_pendiente}`
                  : ""}
                {Number(detalle.cantidad_disponible || 0) > 0
                  ? ` �� Disponibles ${detalle.cantidad_disponible}`
                  : ""}
              </span>
              {detalle.precio_pendiente && (
                <span className="pedidos-precio-pendiente">
                  Precio pendiente de definir
                </span>
              )}
            </div>
            <strong className="pedidos-item-total">
              {detalle.precio_pendiente
                ? "Pendiente"
                : dinero(detalle.subtotal)}
            </strong>
          </div>
        ))
      ) : (
        <p className="pedidos-sin-lineas">El pedido no tiene líneas.</p>
      )}
    </div>
  );
}

function LineaConfirmacion({
  detalle,
  valor,
  onChange,
  deshabilitado,
}) {
  return (
    <div
      className={`pedidos-item-editar ${
        detalle.precio_pendiente ? "pedidos-item-pendiente" : ""
      }`}
    >
      <div className="pedidos-item-info">
        <strong>{detalle.producto_nombre || "Producto"}</strong>
        <span>
          {detalle.porcentaje_recarga} % · Cant. {detalle.cantidad}
          {detalle.recarga_solicitada ? " · Recarga" : ""}
        </span>
        {detalle.precio_pendiente && (
          <span className="pedidos-precio-pendiente">
            Precio pendiente de definir
          </span>
        )}
      </div>

      {detalle.precio_pendiente ? (
        <label>
          <span>Precio final unitario</span>
          <div className="pedidos-precio-campo">
            <span>$</span>
            <input
              type="text"
              inputMode="numeric"
              value={valor}
              onChange={(evento) => onChange(evento.target.value)}
              placeholder="Escribe el precio"
              aria-label={`Precio final para ${
                detalle.producto_nombre || "el producto"
              }`}
              autoComplete="off"
              disabled={deshabilitado}
            />
          </div>
        </label>
      ) : (
        <div className="pedidos-precio-definitivo">
          <span>Precio final unitario</span>
          <strong>{dinero(detalle.precio_unitario)}</strong>
        </div>
      )}
    </div>
  );
}

function AnticiposLista({ anticipos = [] }) {
  if (!anticipos.length) {
    return (
      <p className="pedidos-sin-lineas">
        No hay anticipos registrados.
      </p>
    );
  }

  return (
    <div className="pedidos-anticipos-lista">
      {anticipos.map((anticipo) => (
        <div className="pedidos-anticipo-item" key={anticipo.id}>
          <div>
            <strong>{dinero(anticipo.monto)}</strong>
            <span>
              {fechaPagoCorta(anticipo.fecha)}
              {anticipo.metodo_pago
                ? ` · ${anticipo.metodo_pago}`
                : ""}
              {anticipo.referencia
                ? ` · ${anticipo.referencia}`
                : ""}
            </span>
          </div>
          <small>Pago</small>
        </div>
      ))}
    </div>
  );
}

function ResumenPago({ pedido }) {
  const resumen = resumenPagoPedido(pedido);
  const precioPendiente = pedido?.precios_completos === false;

  return (
    <div className="pedidos-pago-resumen">
      <div>
        <span>Monto pagado</span>
        <strong>{dinero(resumen.montoPagado)}</strong>
      </div>
      <div>
        <span>Saldo pendiente</span>
        <strong>
          {precioPendiente ? "Por definir" : dinero(resumen.saldo)}
        </strong>
      </div>
      <div>
        <span>Estado de pago</span>
        <strong>{etiquetaPagoPedido(resumen.estadoPago)}</strong>
      </div>
    </div>
  );
}

function Pedidos() {
  const [pedidos, setPedidos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState("");
  const [recarga, setRecarga] = useState(0);
  const [filtro, setFiltro] = useState("pendiente");
  const [busqueda, setBusqueda] = useState("");
  const [seleccionadoId, setSeleccionadoId] = useState(null);
  const [modoModal, setModoModal] = useState("");
  const [lineasPrecio, setLineasPrecio] = useState({});
  const [motivoRechazo, setMotivoRechazo] = useState("");
  const [anticipoDatos, setAnticipoDatos] = useState({
    monto: "",
    fecha: fechaActualColombia(),
    metodoPago: "",
    referencia: "",
  });
  const [cancelacionDatos, setCancelacionDatos] = useState({
    motivo: "",
    montoDevolucion: "",
    fechaDevolucion: fechaActualColombia(),
    metodoPago: "",
    referencia: "",
  });
  const [procesando, setProcesando] = useState(false);
  const [errorModal, setErrorModal] = useState("");
  const [aviso, setAviso] = useState("");
  const [tipoAviso, setTipoAviso] = useState("exito");
  const anticipoClaveRef = useRef("");
  const cancelacionClaveRef = useRef("");

  useEffect(() => {
    const controlador = new AbortController();
    let activo = true;

    setCargando(true);
    setErrorCarga("");

    Promise.all([
      listarPedidos({ signal: controlador.signal }),
      listarVentas({
        signal: controlador.signal,
        conPendientes: true,
      }),
    ])
      .then(([datos, ventasPendientes]) => {
        if (!activo) return;

        const ventasVirtuales =
          construirPedidosDesdeVentasPendientes(
            ventasPendientes
          );

        setPedidos(
          [...datos, ...ventasVirtuales].sort((a, b) =>
            String(b.creado_en || "").localeCompare(
              String(a.creado_en || "")
            )
          )
        );
      })
      .catch((error) => {
        if (!activo || error.isCanceled) return;
        setErrorCarga(
          error.message || "No se pudieron cargar los pedidos."
        );
      })
      .finally(() => {
        if (activo) setCargando(false);
      });

    return () => {
      activo = false;
      controlador.abort();
    };
  }, [recarga]);

  const conteos = useMemo(
    () => contarPedidosPorEstado(pedidos),
    [pedidos]
  );

  const pedidosFiltrados = useMemo(
    () => filtrarPedidos(pedidos, filtro, busqueda),
    [pedidos, filtro, busqueda]
  );

  const pedidoSeleccionado = pedidos.find(
    (pedido) => String(pedido.id) === String(seleccionadoId)
  );

  const detallesSeleccionados = pedidoSeleccionado?.detalles || [];
  const lineasPendientes = detallesSeleccionados.filter(
    (detalle) => detalle.precio_pendiente
  );
  const faltanPrecios = lineasPendientes.some(
    (detalle) => !(Number(lineasPrecio[String(detalle.id)]) > 0)
  );

  const totalEstimado = calcularTotalEstimado(
    detallesSeleccionados,
    lineasPrecio
  );

  const totalModal =
    modoModal === "confirmar"
      ? totalEstimado
      : Number(pedidoSeleccionado?.total || 0);

  const puedeConfirmar =
    !procesando &&
    puedeConfirmarConPrecios(
      pedidoSeleccionado,
      detallesSeleccionados,
      lineasPrecio,
    );

  const resumenSeleccionado = pedidoSeleccionado
    ? resumenPagoPedido(pedidoSeleccionado)
    : null;

  const pedidosPorComprar = pedidos.filter(
    pedidoPendienteDeCompra
  ).length;
  const pedidosEnProceso =
    conteos.comprado + conteos.preparando + conteos.listo;
  const pedidosFinalizados =
    conteos.entregado + conteos.cancelado + conteos.rechazado;

  function cerrarAviso() {
    setAviso("");
  }

  function mostrarAviso(mensaje, tipo = "exito") {
    setAviso(mensaje);
    setTipoAviso(tipo);
  }

  function abrirModal(pedido, modo) {
    if (procesando) return;

    setSeleccionadoId(pedido.id);
    setModoModal(modo);
    setErrorModal("");
    setAviso("");

    if (modo === "confirmar") {
      const precios = {};

      (pedido.detalles || [])
        .filter((detalle) => detalle.precio_pendiente)
        .forEach((detalle) => {
          precios[String(detalle.id)] = "";
        });

      setLineasPrecio(precios);
    }

    if (modo === "rechazar") {
      setMotivoRechazo("");
    }

    if (modo === "anticipo") {
      setAnticipoDatos({
        monto: "",
        fecha: fechaActualColombia(),
        metodoPago: "",
        referencia: "",
      });
      anticipoClaveRef.current =
        crearClaveIdempotencia("anticipo");
    }

    if (modo === "cancelar") {
      setCancelacionDatos({
        motivo: "",
        montoDevolucion: "",
        fechaDevolucion: fechaActualColombia(),
        metodoPago: "",
        referencia: "",
      });
      cancelacionClaveRef.current =
        crearClaveIdempotencia("cancelacion");
    }
  }

  function cerrarModal() {
    setSeleccionadoId(null);
    setModoModal("");
    setErrorModal("");
    setLineasPrecio({});
    setMotivoRechazo("");
    setAnticipoDatos({
      monto: "",
      fecha: fechaActualColombia(),
      metodoPago: "",
      referencia: "",
    });
    setCancelacionDatos({
      motivo: "",
      montoDevolucion: "",
      fechaDevolucion: fechaActualColombia(),
      metodoPago: "",
      referencia: "",
    });
  }

  function actualizarPrecio(detalleId, valor) {
    setLineasPrecio((actuales) => ({
      ...actuales,
      [String(detalleId)]: limpiarImporte(valor),
    }));
    setErrorModal("");
  }

  function actualizarPedido(actualizado) {
    setPedidos((actuales) =>
      actuales.map((pedido) =>
        pedido.id === actualizado.id ? actualizado : pedido
      )
    );
  }

  async function manejarConfirmacion(evento) {
    evento.preventDefault();

    if (!pedidoSeleccionado || procesando) return;

    if (pedidoSeleccionado.estado !== "pendiente") {
      setErrorModal("Este pedido ya fue gestionado.");
      return;
    }

    if (faltanPrecios) {
      setErrorModal(
        "Completa el precio final de todas las recargas pendientes."
      );
      return;
    }

    if (totalEstimado <= 0) {
      setErrorModal("El total del pedido debe ser mayor que cero.");
      return;
    }

    const lineas = construirLineasPrecioConfirmacion(
      detallesSeleccionados,
      lineasPrecio
    );

    setProcesando(true);
    setErrorModal("");

    try {
      const actualizado = await confirmarPedidoApi(
        pedidoSeleccionado.id,
        {
          estadoPago: "pendiente",
          lineasPrecio: lineas,
        }
      );

      actualizarPedido(actualizado);
      setFiltro("confirmado");
      mostrarAviso(
        `Pedido #${actualizado.id} confirmado. Queda pendiente de compra.`
      );
      cerrarModal();
    } catch (error) {
      setErrorModal(
        error.message || "No se pudo confirmar el pedido."
      );

      if (error.status === 400) {
        setRecarga((actual) => actual + 1);
      }
    } finally {
      setProcesando(false);
    }
  }

  async function manejarRechazo(evento) {
    evento.preventDefault();

    if (!pedidoSeleccionado || procesando) return;

    if (pedidoSeleccionado.estado !== "pendiente") {
      setErrorModal("Este pedido ya fue gestionado.");
      return;
    }

    const motivo = motivoRechazo.trim();

    if (!motivo) {
      setErrorModal("Escribe el motivo del rechazo para continuar.");
      return;
    }

    setProcesando(true);
    setErrorModal("");

    try {
      const actualizado = await rechazarPedidoApi(
        pedidoSeleccionado.id,
        motivo
      );

      actualizarPedido(actualizado);
      setFiltro("rechazado");
      mostrarAviso(`Pedido #${actualizado.id} rechazado.`);
      cerrarModal();
    } catch (error) {
      setErrorModal(
        error.message || "No se pudo rechazar el pedido."
      );
    } finally {
      setProcesando(false);
    }
  }

  async function manejarAnticipo(evento) {
    evento.preventDefault();

    if (!pedidoSeleccionado || procesando) return;

    const monto = Number(anticipoDatos.monto);
    const saldo = Number(resumenSeleccionado?.saldo || 0);

    if (!Number.isFinite(monto) || monto <= 0) {
      setErrorModal("El monto recibido debe ser mayor que cero.");
      return;
    }

    if (monto > saldo) {
      setErrorModal(
        `El anticipo supera el saldo pendiente (${dinero(saldo)}).`
      );
      return;
    }

    if (!esFechaISO(anticipoDatos.fecha)) {
      setErrorModal("La fecha del pago no es válida.");
      return;
    }

    if (esFechaFutura(anticipoDatos.fecha)) {
      setErrorModal("La fecha del pago no puede ser futura.");
      return;
    }

    setProcesando(true);
    setErrorModal("");

    try {
      const respuesta = await registrarAnticipo(
        pedidoSeleccionado.id,
        {
          monto: anticipoDatos.monto,
          fecha: anticipoDatos.fecha,
          metodoPago: anticipoDatos.metodoPago,
          referencia: anticipoDatos.referencia,
          claveIdempotencia: anticipoClaveRef.current,
        }
      );

      actualizarPedido(respuesta.pedido);
      mostrarAviso(
        `Pago de ${dinero(respuesta.anticipo?.monto)} registrado.`
      );
      cerrarModal();
    } catch (error) {
      if (error.status === 400 || error.status === 409) {
        anticipoClaveRef.current =
          crearClaveIdempotencia("anticipo");
      }

      setErrorModal(
        error.message || "No se pudo registrar el anticipo."
      );
    } finally {
      setProcesando(false);
    }
  }

  async function manejarCancelacion(evento) {
    evento.preventDefault();

    if (!pedidoSeleccionado || procesando) return;

    if (!cancelacionDatos.motivo.trim()) {
      setErrorModal("Escribe el motivo de la cancelación.");
      return;
    }

    if (
      !esFechaISO(cancelacionDatos.fechaDevolucion)
    ) {
      setErrorModal("La fecha de devolución no es válida.");
      return;
    }

    if (esFechaFutura(cancelacionDatos.fechaDevolucion)) {
      setErrorModal("La fecha de devolución no puede ser futura.");
      return;
    }

    setProcesando(true);
    setErrorModal("");

    try {
      const actualizado = await cancelarPedidoApi(
        pedidoSeleccionado.id,
        {
          motivo: cancelacionDatos.motivo,
          montoDevolucion: cancelacionDatos.montoDevolucion,
          fechaDevolucion: cancelacionDatos.fechaDevolucion,
          metodoPago: cancelacionDatos.metodoPago,
          referencia: cancelacionDatos.referencia,
          claveIdempotencia: cancelacionClaveRef.current,
        }
      );

      actualizarPedido(actualizado);
      setFiltro("cancelado");
      mostrarAviso(`Pedido #${actualizado.id} cancelado.`);
      cerrarModal();
    } catch (error) {
      if (error.status === 400 || error.status === 409) {
        cancelacionClaveRef.current =
          crearClaveIdempotencia("cancelacion");
      }

      setErrorModal(
        error.message || "No se pudo cancelar el pedido."
      );
    } finally {
      setProcesando(false);
    }
  }

  async function manejarCompletarVenta(pedido) {
    if (!pedido || procesando) return;

    setProcesando(true);
    setAviso("");

    try {
      const actualizado = await completarVentaPedido(pedido.id);
      actualizarPedido(actualizado);
      mostrarAviso(
        actualizado.venta
          ? `Venta #${actualizado.venta} generada para el pedido #${actualizado.id}.`
          : "La venta de este pedido ya estaba registrada."
      );
    } catch (error) {
      mostrarAviso(
        error.message || "No se pudo completar la venta.",
        "error"
      );
    } finally {
      setProcesando(false);
    }
  }

  async function manejarCambioEstado(pedido, transicion) {
    if (!pedido || !transicion || procesando) return;

    if (
      transicion.estado === "entregado" &&
      !window.confirm(
        `¿Confirmas que el pedido #${pedido.id} fue entregado al cliente?`
      )
    ) {
      return;
    }

    setProcesando(true);
    setAviso("");

    try {
      const actualizado = await cambiarEstadoPedido(
        pedido.id,
        transicion.estado
      );
      actualizarPedido(actualizado);
      mostrarAviso(
        `Pedido #${actualizado.id}: ${etiquetaEstadoPedido(
          actualizado.estado
        ).toLowerCase()}.`
      );
    } catch (error) {
      mostrarAviso(
        error.message || "No se pudo actualizar el estado.",
        "error"
      );
    } finally {
      setProcesando(false);
    }
  }

  return (
    <section className="pedidos-modulo">
      <header className="pedidos-encabezado">
        <div>
          <p className="pedidos-etiqueta">MYC PERFUMES · ADMINISTRACIÓN</p>
          <h1>Gestión de <em>pedidos</em></h1>
          <p className="pedidos-subtitulo">
            Revisa, confirma y acompaña cada pedido bajo demanda.
          </p>
        </div>
        <span className="pedidos-real-badge">
          <span /> Pedidos de la tienda
        </span>
      </header>

      <div className="pedidos-estadisticas">
        <article className="pedidos-stat pedidos-stat-pendientes">
          <span className="pedidos-stat-icono">
            <Icono tipo="reloj" size={21} />
          </span>
          <div>
            <span>Pendientes por revisar</span>
            <strong>{conteos.pendiente}</strong>
            <small>Requieren tu decisión</small>
          </div>
        </article>
        <article className="pedidos-stat pedidos-stat-porcomprar">
          <span className="pedidos-stat-icono">
            <Icono tipo="caja" size={21} />
          </span>
          <div>
            <span>Pendientes de compra</span>
            <strong>{pedidosPorComprar}</strong>
            <small>Confirmados sin compra</small>
          </div>
        </article>
        <article className="pedidos-stat pedidos-stat-proceso">
          <span className="pedidos-stat-icono">
            <Icono tipo="check" size={21} />
          </span>
          <div>
            <span>En proceso</span>
            <strong>{pedidosEnProceso}</strong>
            <small>Comprados, preparando o listos</small>
          </div>
        </article>
        <article className="pedidos-stat pedidos-stat-finalizados">
          <span className="pedidos-stat-icono">
            <Icono tipo="rechazo" size={21} />
          </span>
          <div>
            <span>Finalizados</span>
            <strong>{pedidosFinalizados}</strong>
            <small>Entregados, cancelados o rechazados</small>
          </div>
        </article>
      </div>

      {aviso && !modoModal && (
        <div
          className={`pedidos-aviso-accion ${
            tipoAviso === "error" ? "pedidos-aviso-error" : ""
          }`}
          role={tipoAviso === "error" ? "alert" : "status"}
        >
          {aviso}
          <button
            type="button"
            onClick={cerrarAviso}
            aria-label="Cerrar aviso"
          >
            ×
          </button>
        </div>
      )}

      <section className="pedidos-panel">
        <div className="pedidos-panel-cabecera">
          <div>
            <h2>Solicitudes recibidas</h2>
            <p>Consulta el detalle y decide qué hacer con cada pedido.</p>
          </div>
          <label className="pedidos-buscador">
            <Icono tipo="lupa" size={18} />
            <input
              type="search"
              placeholder="Buscar pedido, cliente o producto..."
              value={busqueda}
              onChange={(evento) => setBusqueda(evento.target.value)}
              aria-label="Buscar pedido, cliente o producto"
            />
          </label>
        </div>

        <div
          className="pedidos-filtros"
          role="tablist"
          aria-label="Filtrar pedidos"
        >
          {FILTROS_PEDIDO.map(({ valor, etiqueta }) => (
            <button
              key={valor}
              type="button"
              role="tab"
              aria-selected={filtro === valor}
              className={filtro === valor ? "activo" : ""}
              onClick={() => setFiltro(valor)}
            >
              {etiqueta}
              <span>{conteos[valor]}</span>
            </button>
          ))}
        </div>

        <div className="pedidos-lista">
          {cargando ? (
            <div className="pedidos-vacio">
              <span><Icono tipo="reloj" size={27} /></span>
              <h3>Cargando pedidos...</h3>
              <p>Consultando pedidos.</p>
            </div>
          ) : errorCarga ? (
            <div className="pedidos-vacio pedidos-error">
              <span><Icono tipo="rechazo" size={27} /></span>
              <h3>No se pudieron cargar los pedidos</h3>
              <p>{errorCarga}</p>
              <button
                type="button"
                className="pedidos-boton-reintentar"
                onClick={() => setRecarga((actual) => actual + 1)}
              >
                Reintentar
              </button>
            </div>
          ) : pedidosFiltrados.length ? (
            pedidosFiltrados.map((pedido) => {
              const unidades = (pedido.detalles || []).reduce(
                (total, detalle) =>
                  total + Number(detalle.cantidad || 0),
                0
              );
              const resumen = resumenPagoPedido(pedido);
              const porComprar = pedidoPendienteDeCompra(pedido);
              const siguiente = siguienteEstadoPedido(pedido);
              const precioPendiente =
                pedido.precios_completos === false;

              return (
                <article className="pedidos-card" key={pedido.id}>
                  <div className="pedidos-card-top">
                    <div className="pedidos-numero-cliente">
                      <span className="pedidos-avatar">
                        <Icono tipo="cliente" size={22} />
                      </span>
                      <div>
                        <strong>
                          {pedido.esVentaManual
                            ? `Venta manual #${pedido.ventaId}`
                            : `Pedido #${pedido.id}`}
                        </strong>
                        <span>{pedido.cliente_nombre || "Cliente"}</span>
                        {pedido.esVentaManual && (
                          <small className="pedidos-origen-venta">
                            Origen: venta manual
                          </small>
                        )}
                      </div>
                    </div>
                    <Estado estado={pedido.estado} />
                  </div>

                  <div className="pedidos-card-detalles">
                    <div>
                      <span>Fecha de creación</span>
                      <strong>{fechaCorta(pedido.creado_en)}</strong>
                    </div>
                    <div>
                      <span>Productos</span>
                      <strong>{unidades} unidad(es)</strong>
                    </div>
                    <div>
                      <span>
                        {pedido.precios_completos
                          ? "Total del pedido"
                          : "Precio"}
                      </span>
                      <strong className="pedidos-total">
                        {pedido.precios_completos
                          ? dinero(pedido.total)
                          : Number(pedido.total) > 0
                            ? `Provisional: ${dinero(pedido.total)}`
                            : "Pendiente de definir"}
                      </strong>
                    </div>
                  </div>

                  <div className="pedidos-card-pago">
                    <span>Pagado {dinero(resumen.montoPagado)}</span>
                    <span>
                      {precioPendiente
                        ? "Saldo por definir"
                        : `Saldo ${dinero(resumen.saldo)}`}
                    </span>
                    <span>
                      {precioPendiente && resumen.montoPagado <= 0
                        ? "Precio pendiente"
                        : resumen.etiquetaPago}
                    </span>
                  </div>

                  <div className="pedidos-card-productos">
                    {(pedido.detalles || [])
                      .slice(0, 2)
                      .map((detalle) => (
                        <span key={detalle.id}>
                          {detalle.producto_nombre || "Producto"} ��{" "}
                          {detalle.porcentaje_recarga} %{" "}
                          <b>�- {detalle.cantidad}</b>
                          {pedido.esVentaManual &&
                          Number(detalle.cantidad_pendiente || 0) > 0
                            ? ` �� ${detalle.cantidad_pendiente} pend.`
                            : ""}
                        </span>
                      ))}
                    {(pedido.detalles || []).length > 2 && (
                      <span>
                        + {(pedido.detalles || []).length - 2}{" "}
                        producto(s) más
                      </span>
                    )}
                  </div>

                  {!pedido.precios_completos &&
                    pedido.estado === "pendiente" && (
                      <p className="pedidos-alerta-precios">
                        <Icono tipo="reloj" size={14} />
                        Hay recargas pendientes de precio.
                      </p>
                    )}

                  {porComprar && (
                    <p className="pedidos-por-comprar">
                      <Icono tipo="caja" size={14} />
                      {pedido.esVentaManual
                        ? `Venta manual pendiente de compra${
                            Number(
                              pedido.unidades_pendientes_compra || 0,
                            ) > 0
                              ? ` �� ${pedido.unidades_pendientes_compra} unidad(es) por recibir`
                              : ""
                          }.`
                        : puedeGenerarVentaPedido(pedido)
                          ? "Compra completa. Puedes completar la venta."
                          : `Pendiente de compra al proveedor${
                              Number(
                                pedido.unidades_pendientes_compra || 0,
                              ) > 0
                                ? ` �� ${pedido.unidades_pendientes_compra} unidad(es) por recibir`
                                : ""
                            }.`}
                    </p>
                  )}

                  {pedido.venta && (
                    <p className="pedidos-venta-resumen">
                      Venta #{pedido.venta}
                      {" · "}
                      {etiquetaPagoPedido(pedido.estado_pago)}
                      {Number(pedido.saldo) > 0
                        ? ` · Saldo ${dinero(pedido.saldo)}`
                        : ""}
                    </p>
                  )}

                  {pedido.entregado_en && (
                    <p className="pedidos-venta-resumen">
                      Entregado el{" "}
                      {new Date(pedido.entregado_en).toLocaleString(
                        "es-CO",
                      )}
                    </p>
                  )}

                  {pedido.estado === "rechazado" &&
                    pedido.motivo_rechazo && (
                      <p className="pedidos-motivo-resumen">
                        <strong>Motivo:</strong>{" "}
                        {pedido.motivo_rechazo}
                      </p>
                    )}

                  {pedido.estado === "cancelado" &&
                    pedido.motivo_cancelacion && (
                      <p className="pedidos-motivo-resumen">
                        <strong>Cancelación:</strong>{" "}
                        {pedido.motivo_cancelacion}
                      </p>
                    )}

                  <div className="pedidos-card-acciones">
                    <button
                      className="pedidos-boton-detalle"
                      type="button"
                      onClick={() => abrirModal(pedido, "detalle")}
                    >
                      Ver detalle <Icono tipo="flecha" size={16} />
                    </button>

                    {pedido.esVentaManual ? (
                      <span className="pedidos-origen-venta">
                        La recepción se gestiona desde Compras.
                      </span>
                    ) : pedido.estado === "pendiente" ? (
                      <>
                        <button
                          className="pedidos-boton-rechazar"
                          type="button"
                          onClick={() => abrirModal(pedido, "rechazar")}
                          disabled={procesando}
                        >
                          Rechazar
                        </button>
                        <button
                          className="pedidos-boton-confirmar"
                          type="button"
                          onClick={() => abrirModal(pedido, "confirmar")}
                          disabled={procesando}
                        >
                          Revisar y confirmar{" "}
                          <Icono tipo="check" size={16} />
                        </button>
                      </>
                    ) : (
                      <>
                        {puedeGenerarVentaPedido(pedido) && (
                          <button
                            className="pedidos-boton-venta"
                            type="button"
                            onClick={() => manejarCompletarVenta(pedido)}
                            disabled={procesando}
                          >
                            Completar venta
                          </button>
                        )}

                        {pedidoPuedeRegistrarAnticipo(pedido) && (
                          <button
                            className="pedidos-boton-anticipo"
                            type="button"
                            onClick={() => abrirModal(pedido, "anticipo")}
                            disabled={procesando}
                          >
                            <Icono tipo="moneda" size={16} />
                            Registrar pago
                          </button>
                        )}

                        {siguiente && (
                          <button
                            className="pedidos-boton-estado"
                            type="button"
                            onClick={() =>
                              manejarCambioEstado(pedido, siguiente)
                            }
                            disabled={procesando}
                          >
                            {siguiente.etiqueta}
                          </button>
                        )}

                        {pedidoPuedeCancelar(pedido) && (
                          <button
                            className="pedidos-boton-cancelar"
                            type="button"
                            onClick={() => abrirModal(pedido, "cancelar")}
                            disabled={procesando}
                          >
                            Cancelar
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </article>
              );
            })
          ) : (
            <div className="pedidos-vacio">
              <span><Icono tipo="bolsa" size={27} /></span>
              <h3>
                {pedidos.length
                  ? "No hay pedidos en esta vista"
                  : "Aún no hay pedidos registrados"}
              </h3>
              <p>
                {pedidos.length
                  ? "Prueba con otro filtro o cambia la búsqueda."
                  : "Los pedidos de la tienda aparecerán aquí."}
              </p>
            </div>
          )}
        </div>

        <div className="pedidos-pie-lista">
          Mostrando {pedidosFiltrados.length} de {pedidos.length}{" "}
          pedido(s)
        </div>
      </section>

      {modoModal && pedidoSeleccionado && (
        <div
          className="pedidos-modal-fondo"
          role="presentation"
          onMouseDown={(evento) => {
            if (
              !procesando &&
              evento.target === evento.currentTarget
            ) {
              cerrarModal();
            }
          }}
        >
          <section
            className="pedidos-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pedidos-modal-titulo"
          >
            <header className="pedidos-modal-encabezado">
              <div>
                <p className="pedidos-etiqueta">
                  {pedidoSeleccionado.esVentaManual
                    ? `VENTA MANUAL #${pedidoSeleccionado.ventaId}`
                    : `SOLICITUD #${pedidoSeleccionado.id}`}
                </p>
                <h2 id="pedidos-modal-titulo">
                  {pedidoSeleccionado.esVentaManual
                    ? "Detalle de venta manual"
                    : modoModal === "confirmar"
                      ? "Revisar y confirmar"
                      : modoModal === "rechazar"
                        ? "Rechazar pedido"
                        : modoModal === "anticipo"
                          ? "Registrar pago"
                          : modoModal === "cancelar"
                            ? "Cancelar pedido"
                            : "Detalle del pedido"}
                </h2>
              </div>
              <button
                className="pedidos-modal-cerrar"
                type="button"
                onClick={cerrarModal}
                aria-label="Cerrar ventana"
                disabled={procesando}
              >
                <Icono tipo="cerrar" size={19} />
              </button>
            </header>

            <div className="pedidos-cliente-ficha">
              <span className="pedidos-avatar">
                <Icono tipo="cliente" size={22} />
              </span>
              <div>
                <strong>
                  {pedidoSeleccionado.cliente_nombre || "Cliente"}
                </strong>
                <span>
                  {pedidoSeleccionado.telefono_origen ||
                    "Sin teléfono registrado"}
                </span>
              </div>
              <Estado estado={pedidoSeleccionado.estado} />
            </div>

            <div className="pedidos-datos-envio">
              <div>
                <span>Fecha de creación</span>
                <strong>{fechaCorta(pedidoSeleccionado.creado_en)}</strong>
              </div>
              <div>
                <span>
                  {pedidoSeleccionado.venta
                    ? "Venta y pago"
                    : "Estado comercial"}
                </span>
                <strong>
                  {pedidoSeleccionado.venta
                    ? `Venta #${pedidoSeleccionado.venta} · ${etiquetaPagoPedido(
                        pedidoSeleccionado.estado_pago
                      )}`
                    : etiquetaEstadoPedido(pedidoSeleccionado.estado)}
                </strong>
              </div>
            </div>

            <form
              onSubmit={
                modoModal === "confirmar"
                  ? manejarConfirmacion
                  : modoModal === "rechazar"
                    ? manejarRechazo
                    : modoModal === "anticipo"
                      ? manejarAnticipo
                      : modoModal === "cancelar"
                        ? manejarCancelacion
                        : (evento) => evento.preventDefault()
              }
            >
              <div className="pedidos-modal-seccion-titulo">
                <h3>
                  {pedidoSeleccionado.esVentaManual
                    ? "Productos de la venta"
                    : "Productos solicitados"}
                </h3>
                <span>{detallesSeleccionados.length} l��nea(s)</span>
              </div>

              {modoModal === "confirmar" ? (
                <div className="pedidos-items-edicion">
                  {detallesSeleccionados.map((detalle) => (
                    <LineaConfirmacion
                      key={detalle.id}
                      detalle={detalle}
                      valor={lineasPrecio[String(detalle.id)] || ""}
                      onChange={(valor) =>
                        actualizarPrecio(detalle.id, valor)
                      }
                      deshabilitado={procesando}
                    />
                  ))}
                </div>
              ) : (
                <ResumenPedido pedido={pedidoSeleccionado} />
              )}

              <div className="pedidos-total-modal">
                <span>
                  {modoModal === "confirmar"
                    ? "Total estimado"
                    : pedidoSeleccionado.precios_completos
                      ? "Total del pedido"
                      : Number(totalModal) > 0
                        ? "Total provisional"
                        : "Precio"}
                </span>
                <strong>
                  {modoModal !== "confirmar" &&
                  !pedidoSeleccionado.precios_completos &&
                  Number(totalModal) <= 0
                    ? "Pendiente de definir"
                    : dinero(totalModal)}
                </strong>
              </div>

              <ResumenPago pedido={pedidoSeleccionado} />

              <div className="pedidos-modal-seccion-titulo pedidos-anticipos-titulo">
                <h3>Pagos y anticipos</h3>
                <span>
                  {(pedidoSeleccionado.anticipos || []).length}
                </span>
              </div>
              <AnticiposLista
                anticipos={pedidoSeleccionado.anticipos || []}
              />

              {modoModal === "confirmar" && faltanPrecios && (
                <p className="pedidos-aviso-precios">
                  Completa el precio final de todas las recargas
                  pendientes para habilitar la confirmación.
                </p>
              )}

              {modoModal === "anticipo" && (
                <>
                  <label className="pedidos-campo-label">
                    Monto recibido (COP)
                    <input
                      type="text"
                      inputMode="numeric"
                      value={anticipoDatos.monto}
                      onChange={(evento) => {
                        setAnticipoDatos((actual) => ({
                          ...actual,
                          monto: limpiarImporte(evento.target.value),
                        }));
                        setErrorModal("");
                      }}
                      placeholder="Total o abono"
                      autoComplete="off"
                      disabled={procesando}
                      required
                    />
                    <small>
                      Saldo pendiente: {dinero(resumenSeleccionado?.saldo)}
                    </small>
                  </label>

                  <label className="pedidos-campo-label">
                    Fecha del anticipo
                    <input
                      type="date"
                      value={anticipoDatos.fecha}
                      max={fechaActualColombia()}
                      onChange={(evento) => {
                        setAnticipoDatos((actual) => ({
                          ...actual,
                          fecha: evento.target.value,
                        }));
                        setErrorModal("");
                      }}
                      disabled={procesando}
                    />
                  </label>

                  <label className="pedidos-campo-label">
                    Método de pago
                    <input
                      type="text"
                      maxLength={30}
                      value={anticipoDatos.metodoPago}
                      onChange={(evento) => {
                        setAnticipoDatos((actual) => ({
                          ...actual,
                          metodoPago: evento.target.value,
                        }));
                        setErrorModal("");
                      }}
                      placeholder="Efectivo, transferencia..."
                      disabled={procesando}
                    />
                  </label>

                  <label className="pedidos-campo-label">
                    Referencia
                    <input
                      type="text"
                      maxLength={120}
                      value={anticipoDatos.referencia}
                      onChange={(evento) => {
                        setAnticipoDatos((actual) => ({
                          ...actual,
                          referencia: evento.target.value,
                        }));
                        setErrorModal("");
                      }}
                      placeholder="Número de comprobante"
                      disabled={procesando}
                    />
                  </label>
                </>
              )}

              {modoModal === "cancelar" && (
                <>
                  <label className="pedidos-campo-label">
                    Motivo de la cancelación *
                    <textarea
                      rows="3"
                      maxLength="255"
                      value={cancelacionDatos.motivo}
                      onChange={(evento) => {
                        setCancelacionDatos((actual) => ({
                          ...actual,
                          motivo: evento.target.value,
                        }));
                        setErrorModal("");
                      }}
                      placeholder="Escribe brevemente el motivo..."
                      required
                      disabled={procesando}
                    />
                  </label>

                  <label className="pedidos-campo-label">
                    Monto a devolver (opcional)
                    <input
                      type="text"
                      inputMode="numeric"
                      value={cancelacionDatos.montoDevolucion}
                      onChange={(evento) => {
                        setCancelacionDatos((actual) => ({
                          ...actual,
                          montoDevolucion: limpiarImporte(
                            evento.target.value
                          ),
                        }));
                        setErrorModal("");
                      }}
                      placeholder="Vacío = devolver todo lo recibido"
                      autoComplete="off"
                      disabled={procesando}
                    />
                    <small>
                      Si lo dejas vacío, se devolverá el saldo
                      disponible. El historial se conserva.
                    </small>
                  </label>

                  <label className="pedidos-campo-label">
                    Fecha de devolución
                    <input
                      type="date"
                      value={cancelacionDatos.fechaDevolucion}
                      max={fechaActualColombia()}
                      onChange={(evento) => {
                        setCancelacionDatos((actual) => ({
                          ...actual,
                          fechaDevolucion: evento.target.value,
                        }));
                        setErrorModal("");
                      }}
                      disabled={procesando}
                    />
                  </label>

                  <label className="pedidos-campo-label">
                    Método de devolución
                    <input
                      type="text"
                      maxLength={30}
                      value={cancelacionDatos.metodoPago}
                      onChange={(evento) => {
                        setCancelacionDatos((actual) => ({
                          ...actual,
                          metodoPago: evento.target.value,
                        }));
                        setErrorModal("");
                      }}
                      placeholder="Efectivo, transferencia..."
                      disabled={procesando}
                    />
                  </label>

                  <label className="pedidos-campo-label">
                    Referencia
                    <input
                      type="text"
                      maxLength={120}
                      value={cancelacionDatos.referencia}
                      onChange={(evento) => {
                        setCancelacionDatos((actual) => ({
                          ...actual,
                          referencia: evento.target.value,
                        }));
                        setErrorModal("");
                      }}
                      placeholder="Número de comprobante"
                      disabled={procesando}
                    />
                  </label>
                </>
              )}

              {modoModal === "rechazar" && (
                <label className="pedidos-campo-label">
                  Motivo del rechazo
                  <textarea
                    rows="3"
                    maxLength="255"
                    value={motivoRechazo}
                    onChange={(evento) => {
                      setMotivoRechazo(evento.target.value);
                      setErrorModal("");
                    }}
                    placeholder="Escribe brevemente el motivo..."
                    required
                    disabled={procesando}
                  />
                  <small>
                    Quedará asociado al pedido. No se elimina el historial.
                  </small>
                </label>
              )}

              {modoModal === "detalle" &&
                pedidoSeleccionado.estado === "rechazado" &&
                pedidoSeleccionado.motivo_rechazo && (
                  <div className="pedidos-rechazo-detalle">
                    <strong>Motivo registrado</strong>
                    <p>{pedidoSeleccionado.motivo_rechazo}</p>
                  </div>
                )}

              {modoModal === "detalle" &&
                pedidoSeleccionado.estado === "cancelado" &&
                pedidoSeleccionado.motivo_cancelacion && (
                  <div className="pedidos-rechazo-detalle">
                    <strong>Cancelación registrada</strong>
                    <p>{pedidoSeleccionado.motivo_cancelacion}</p>
                  </div>
                )}

              {errorModal && (
                <p className="pedidos-modal-error" role="alert">
                  {errorModal}
                </p>
              )}

              <footer className="pedidos-modal-acciones">
                <button
                  className="pedidos-boton-secundario"
                  type="button"
                  onClick={cerrarModal}
                  disabled={procesando}
                >
                  Cerrar
                </button>

                {modoModal === "detalle" &&
                  !pedidoSeleccionado.esVentaManual &&
                  pedidoSeleccionado.estado === "pendiente" && (
                    <>
                      <button
                        className="pedidos-boton-rechazar"
                        type="button"
                        onClick={() =>
                          abrirModal(pedidoSeleccionado, "rechazar")
                        }
                        disabled={procesando}
                      >
                        Rechazar
                      </button>
                      <button
                        className="pedidos-boton-confirmar"
                        type="button"
                        onClick={() =>
                          abrirModal(pedidoSeleccionado, "confirmar")
                        }
                        disabled={procesando}
                      >
                        Revisar y confirmar{" "}
                        <Icono tipo="check" size={17} />
                      </button>
                    </>
                  )}

                {modoModal === "detalle" &&
                  !pedidoSeleccionado.esVentaManual &&
                  pedidoSeleccionado.estado !== "pendiente" && (
                    <>
                      {puedeGenerarVentaPedido(pedidoSeleccionado) && (
                        <button
                          className="pedidos-boton-venta"
                          type="button"
                          onClick={() =>
                            manejarCompletarVenta(pedidoSeleccionado)
                          }
                          disabled={procesando}
                        >
                          Completar venta
                        </button>
                      )}

                      {pedidoPuedeRegistrarAnticipo(
                        pedidoSeleccionado
                      ) && (
                        <button
                          className="pedidos-boton-anticipo"
                          type="button"
                          onClick={() =>
                            abrirModal(pedidoSeleccionado, "anticipo")
                          }
                          disabled={procesando}
                        >
                          <Icono tipo="moneda" size={16} />
                          Registrar pago
                        </button>
                      )}

                      {siguienteEstadoPedido(pedidoSeleccionado) && (
                        <button
                          className="pedidos-boton-estado"
                          type="button"
                          onClick={() =>
                            manejarCambioEstado(
                              pedidoSeleccionado,
                              siguienteEstadoPedido(pedidoSeleccionado)
                            )
                          }
                          disabled={procesando}
                        >
                          {
                            siguienteEstadoPedido(pedidoSeleccionado)
                              .etiqueta
                          }
                        </button>
                      )}

                      {pedidoPuedeCancelar(pedidoSeleccionado) && (
                        <button
                          className="pedidos-boton-cancelar"
                          type="button"
                          onClick={() =>
                            abrirModal(pedidoSeleccionado, "cancelar")
                          }
                          disabled={procesando}
                        >
                          Cancelar
                        </button>
                      )}
                    </>
                  )}

                {modoModal === "confirmar" &&
                  pedidoSeleccionado.estado === "pendiente" && (
                    <button
                      className="pedidos-boton-confirmar"
                      type="submit"
                      disabled={!puedeConfirmar}
                    >
                      <Icono tipo="check" size={17} />
                      {procesando
                        ? "Confirmando..."
                        : "Confirmar pedido"}
                    </button>
                  )}

                {modoModal === "rechazar" &&
                  pedidoSeleccionado.estado === "pendiente" && (
                    <button
                      className="pedidos-boton-rechazar"
                      type="submit"
                      disabled={
                        procesando || !motivoRechazo.trim()
                      }
                    >
                      <Icono tipo="rechazo" size={17} />
                      {procesando
                        ? "Rechazando..."
                        : "Confirmar rechazo"}
                    </button>
                  )}

                {modoModal === "anticipo" && (
                  <button
                    className="pedidos-boton-confirmar"
                    type="submit"
                    disabled={procesando}
                  >
                    <Icono tipo="moneda" size={17} />
                    {procesando
                      ? "Registrando..."
                      : "Registrar pago"}
                  </button>
                )}

                {modoModal === "cancelar" && (
                  <button
                    className="pedidos-boton-cancelar"
                    type="submit"
                    disabled={
                      procesando || !cancelacionDatos.motivo.trim()
                    }
                  >
                    {procesando
                      ? "Cancelando..."
                      : "Confirmar cancelación"}
                  </button>
                )}
              </footer>
            </form>

            {modoModal === "cancelar" && (
              <p className="pedidos-modal-nota">
                La cancelación no elimina el historial del pedido.
              </p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

export default Pedidos;

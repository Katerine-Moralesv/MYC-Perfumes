import { useEffect, useMemo, useRef, useState } from "react";
import "./Clientes.css";
import { useAuth } from "../../context/auth-context";
import { listarPedidos } from "../../services/pedidosAdmin.js";
import {
  crearClaveIdempotencia,
  listarResumenClientes,
  registrarAbono,
} from "../../services/clientes.js";
import {
  esFechaFutura,
  esFechaISO,
  fechaActualColombia,
} from "../../services/fechas.js";
import {
  construirClientesDesdeResumen,
  filtrarClientes,
  resumenLineas,
} from "../../services/clientesResumen.js";

const ETIQUETAS_PEDIDO = {
  pendiente: "Pendiente",
  confirmado: "Confirmado",
  por_comprar: "Por comprar",
  comprado: "Comprado",
  preparando: "Preparando",
  listo: "Listo",
  entregado: "Entregado",
  rechazado: "Rechazado",
  cancelado: "Cancelado",
};

const dinero = (valor) =>
  Number(valor || 0).toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });

function fechaCorta(valor) {
  if (!valor) return "Sin fecha";
  const fecha = new Date(String(valor).length === 10 ? `${valor}T12:00:00` : valor);
  if (Number.isNaN(fecha.getTime())) return "Sin fecha";
  return fecha.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

function limpiarImporte(valor) {
  return String(valor ?? "").replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
}

function icono(nombre) {
  const paths = {
    clientes: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20v-2a6.5 6.5 0 0 1 13 0v2" /><path d="M16 5.5a3.3 3.3 0 0 1 0 6.2" /><path d="M18 15a4.5 4.5 0 0 1 3.5 4.5" /></>,
    dinero: <><circle cx="12" cy="12" r="9" /><path d="M16 8H10a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8M12 5v14" /></>,
    reloj: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    buscar: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
    abono: <><path d="M12 3v18M17 7.5C17 6 15 5 12 5S7 6.2 7 8s1.5 2.5 5 3 5 1.2 5 3-2 5-5 5-5-1-5-3" /></>,
    detalle: <><path d="M5 3h10l4 4v14H5z" /><path d="M14 3v5h5M8 12h8M8 16h8" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    cerrar: <path d="m6 6 12 12M18 6 6 18" />,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[nombre] || paths.clientes}</svg>;
}


export default function Clientes() {
  const { isAdmin } = useAuth();
  const [clientesApi, setClientesApi] = useState([]);
  const [pedidosApi, setPedidosApi] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState("");
  const [recarga, setRecarga] = useState(0);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState("Todos");
  const [mensaje, setMensaje] = useState("");
  const [clienteDetalle, setClienteDetalle] = useState(null);
  const [clienteAbono, setClienteAbono] = useState(null);
  const [ventaAbonoId, setVentaAbonoId] = useState("");
  const [importeAbono, setImporteAbono] = useState("");
  const [fechaAbono, setFechaAbono] = useState(
    fechaActualColombia,
  );
  const [errorAbono, setErrorAbono] = useState("");
  const [procesandoAbono, setProcesandoAbono] = useState(false);
  const claveAbonoRef = useRef("");

  useEffect(() => {
    const controlador = new AbortController();
    let activo = true;

    setCargando(true);
    setErrorCarga("");

    const pedidosPromise = isAdmin
      ? listarPedidos({ signal: controlador.signal })
      : Promise.resolve([]);

    Promise.all([
      listarResumenClientes({ signal: controlador.signal }),
      pedidosPromise,
    ])
      .then(([clientes, pedidos]) => {
        if (!activo) return;
        setClientesApi(clientes);
        setPedidosApi(pedidos);
      })
      .catch((error) => {
        if (!activo || error.isCanceled) return;
        setErrorCarga(
          error.message || "No se pudieron cargar los clientes.",
        );
      })
      .finally(() => {
        if (activo) setCargando(false);
      });

    return () => {
      activo = false;
      controlador.abort();
    };
  }, [isAdmin, recarga]);

  const clientes = useMemo(() => {
    const resumen = construirClientesDesdeResumen(clientesApi);
    const pendientes = pedidosApi.filter(
      (pedido) => pedido.estado === "pendiente",
    );

    if (!pendientes.length) return resumen;

    return resumen.map((cliente) => {
      const pedidosCliente = pendientes
        .filter(
          (pedido) =>
            String(pedido.cliente) === String(cliente.id),
        )
        .map((pedido) => ({
          ...pedido,
          total: Number(pedido.total || 0),
          saldo: Number(pedido.saldo || 0),
          montoPagado: Number(pedido.monto_pagado || 0),
          etiquetaPago:
            pedido.estado_pago === "pendiente"
              ? "Pendiente"
              : pedido.estado_pago,
          unidadesPendientesCompra: Number(
            pedido.unidades_pendientes_compra || 0,
          ),
        }));

      if (!pedidosCliente.length) return cliente;

      return {
        ...cliente,
        pedidos: [...pedidosCliente, ...cliente.pedidos],
      };
    });
  }, [clientesApi, pedidosApi]);

  const clientesFiltrados = useMemo(
    () => filtrarClientes(clientes, busqueda, filtro),
    [clientes, busqueda, filtro],
  );

  const totalCartera = clientes.reduce(
    (suma, cliente) => suma + cliente.saldoPendiente,
    0,
  );
  const clientesConSaldo = clientes.filter(
    (cliente) => cliente.saldoPendiente > 0,
  ).length;
  const pedidosSinConfirmar = pedidosApi.filter(
    (pedido) => pedido.estado === "pendiente",
  ).length;
  const ventasAbono =
    clienteAbono?.ventas.filter((venta) => venta.saldo > 0) || [];
  const opcionesFiltro = [
    "Todos",
    "Con saldo",
    "Al día",
    ...(isAdmin ? ["Pedidos sin confirmar"] : []),
  ];

  function abrirDetalle(cliente) {
    setClienteAbono(null);
    setClienteDetalle(cliente);
  }

  function abrirAbono(cliente) {
    const ventasConSaldo = cliente.ventas.filter(
      (venta) => venta.saldo > 0,
    );

    if (!ventasConSaldo.length) return;

    setClienteDetalle(null);
    setClienteAbono(cliente);
    setVentaAbonoId(String(ventasConSaldo[0].id));
    setImporteAbono("");
    setFechaAbono(fechaActualColombia());
    setErrorAbono("");
    claveAbonoRef.current = crearClaveIdempotencia();
  }

  async function enviarAbono(evento) {
    evento.preventDefault();
    if (!clienteAbono || procesandoAbono) return;

    const venta = clienteAbono.ventas.find(
      (item) => String(item.id) === String(ventaAbonoId),
    );
    const importe = Number(importeAbono || 0);

    if (
      !venta ||
      !Number.isFinite(importe) ||
      importe <= 0 ||
      importe > venta.saldo
    ) {
      setErrorAbono(
        "El abono debe ser mayor que $0 y no superar el saldo de la venta seleccionada.",
      );
      return;
    }

    if (
      !esFechaISO(fechaAbono) ||
      esFechaFutura(fechaAbono)
    ) {
      setErrorAbono(
        "La fecha del pago no es válida o es futura.",
      );
      return;
    }

    setProcesandoAbono(true);
    setErrorAbono("");

    try {
      await registrarAbono(venta.id, {
        monto: String(importe),
        fecha: fechaAbono,
        claveIdempotencia: claveAbonoRef.current,
      });

      setMensaje(
        `Abono de ${dinero(importe)} registrado para ${
          clienteAbono.nombre
        }.`,
      );
      setClienteAbono(null);
      setVentaAbonoId("");
      setImporteAbono("");
      claveAbonoRef.current = "";
      setRecarga((actual) => actual + 1);
    } catch (error) {
      setErrorAbono(
        error.message || "No se pudo registrar el abono.",
      );
    } finally {
      setProcesandoAbono(false);
    }
  }

  return (
    <section className="clientes-modulo">
      <header className="clientes-encabezado">
        <p className="clientes-eyebrow">MYC PERFUMES</p>
        <h1>Gestión de clientes</h1>
        <p>
          Consulta a tus clientes y su actividad comercial.
        </p>
      </header>

      <div className="clientes-aviso-real">
        {isAdmin
          ? "Consulta a tus clientes, sus compras y sus saldos pendientes."
          : "Como vendedor solo verás las ventas que registraste; los pedidos no están disponibles."}
      </div>

      {mensaje && (
        <div className="clientes-mensaje" role="status">
          {mensaje}
          <button
            type="button"
            onClick={() => setMensaje("")}
            aria-label="Cerrar aviso"
          >
            ×
          </button>
        </div>
      )}

      <div className="clientes-resumen">
        <article className="clientes-resumen-tarjeta">
          <span className="clientes-resumen-icono">
            {icono("clientes")}
          </span>
          <div className="clientes-resumen-texto">
            <small>Clientes registrados</small>
            <strong>{clientes.length}</strong>
            <span>Registrados</span>
          </div>
        </article>
        <article className="clientes-resumen-tarjeta">
          <span className="clientes-resumen-icono clientes-resumen-icono-rosa">
            {icono("dinero")}
          </span>
          <div className="clientes-resumen-texto">
            <small>Saldo por cobrar</small>
            <strong>{dinero(totalCartera)}</strong>
            <span>
              {clientesConSaldo} cliente(s) con saldo
              {isAdmin ? "" : " en tus ventas"}
            </span>
          </div>
        </article>
        <article className="clientes-resumen-tarjeta">
          <span className="clientes-resumen-icono clientes-resumen-icono-beige">
            {icono("reloj")}
          </span>
          <div className="clientes-resumen-texto">
            <small>Pedidos por confirmar</small>
            <strong>{isAdmin ? pedidosSinConfirmar : "—"}</strong>
            <span>
              {isAdmin
                ? "No son ventas ni deudas todavía"
                : "Solo disponible para administración"}
            </span>
          </div>
        </article>
      </div>

      <section className="clientes-panel">
        <div className="clientes-panel-encabezado">
          <span className="clientes-icono-principal">
            {icono("clientes")}
          </span>
          <div>
            <h2>Clientes y saldos</h2>
            <p>
              Consulta las ventas de tus clientes y registra sus pagos.
            </p>
          </div>
        </div>

        <div className="clientes-controles">
          <label className="clientes-busqueda">
            <span>{icono("buscar")}</span>
            <input
              type="search"
              value={busqueda}
              onChange={(evento) => setBusqueda(evento.target.value)}
              placeholder="Buscar por nombre, celular o notas..."
              aria-label="Buscar clientes"
            />
          </label>
          <div className="clientes-filtros" aria-label="Filtrar clientes">
            {opcionesFiltro.map((opcion) => (
              <button
                key={opcion}
                type="button"
                className={`clientes-filtro ${
                  filtro === opcion ? "activo" : ""
                }`}
                onClick={() => setFiltro(opcion)}
                aria-pressed={filtro === opcion}
              >
                {opcion}
              </button>
            ))}
          </div>
        </div>

        {errorCarga ? (
          <div className="clientes-vacio clientes-error">
            <span>{icono("clientes")}</span>
            <strong>No se pudieron cargar los clientes</strong>
            <p>{errorCarga}</p>
            <button
              type="button"
              className="clientes-reintentar"
              onClick={() => setRecarga((actual) => actual + 1)}
            >
              Reintentar
            </button>
          </div>
        ) : cargando ? (
          <div className="clientes-vacio">
            <span>{icono("reloj")}</span>
            <strong>Cargando clientes...</strong>
            <p>
              {isAdmin
                ? "Consultando clientes, ventas y pedidos."
                : "Consultando clientes y ventas visibles."}
            </p>
          </div>
        ) : clientesFiltrados.length ? (
          <div className="clientes-tabla-contenedor">
            <table className="clientes-tabla">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Movimientos</th>
                  <th>Total acordado</th>
                  <th>Pagado</th>
                  <th>Saldo pendiente</th>
                  <th>Estado / pedidos</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {clientesFiltrados.map((cliente) => {
                  const claseEstado = cliente.estado
                    .toLocaleLowerCase("es")
                    .replace(/[^a-z]+/g, "-");

                  return (
                    <tr key={cliente.id}>
                      <td>
                        <div className="clientes-identidad">
                          <span className="clientes-avatar">
                            {String(cliente.nombre || "C")
                              .charAt(0)
                              .toLocaleUpperCase("es")}
                          </span>
                          <span>
                            <strong className="clientes-nombre">
                              {cliente.nombre}
                            </strong>
                            <small>
                              {cliente.telefono ||
                                "Celular sin registrar"}
                            </small>
                          </span>
                        </div>
                      </td>
                      <td>
                        {cliente.ventas.length} venta(s)
                        <small className="clientes-solicitud">
                          {cliente.pedidos.length} pedido(s) por convertir
                        </small>
                      </td>
                      <td>{dinero(cliente.totalAcordado)}</td>
                      <td>{dinero(cliente.totalPagado)}</td>
                      <td>
                        <strong
                          className={`clientes-valor ${
                            cliente.saldoPendiente > 0
                              ? "con-deuda"
                              : ""
                          }`}
                        >
                          {dinero(cliente.saldoPendiente)}
                        </strong>
                      </td>
                      <td>
                        <span
                          className={`clientes-estado estado-${claseEstado}`}
                        >
                          {cliente.estado}
                        </span>
                        {cliente.pedidos.some(
                          (pedido) => pedido.estado === "pendiente",
                        ) && (
                          <small className="clientes-solicitud">
                            Solicitud por revisar
                          </small>
                        )}
                      </td>
                      <td>
                        <div className="clientes-acciones">
                          <button
                            type="button"
                            className="clientes-boton-debe"
                            onClick={() => abrirDetalle(cliente)}
                          >
                            Ver detalle
                          </button>
                          {cliente.saldoPendiente > 0 && (
                            <button
                              type="button"
                              className="clientes-boton-abonar"
                              onClick={() => abrirAbono(cliente)}
                            >
                              {icono("abono")} Abonar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="clientes-vacio">
            <span>{icono("clientes")}</span>
            <strong>
              {clientes.length
                ? "No hay clientes para este filtro"
                : "Aún no hay clientes registrados"}
            </strong>
            <p>
              {clientes.length
                ? "Prueba con otra búsqueda o filtro."
                : "Los clientes de pedidos y ventas aparecerán aquí."}
            </p>
          </div>
        )}

        <p className="clientes-nota-final">
          {isAdmin
            ? "Los pedidos confirmados sin venta se muestran como compromisos financieros. Los pagos anticipados se registran desde el detalle del pedido."
            : "Los pedidos no están disponibles para vendedores. Las ventas mostradas son las que registraste."}
        </p>
      </section>

      {clienteDetalle && (
        <div
          className="clientes-modal-fondo"
          role="presentation"
          onMouseDown={(evento) => {
            if (evento.target === evento.currentTarget) {
              setClienteDetalle(null);
            }
          }}
        >
          <section
            className="clientes-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clientes-detalle-titulo"
          >
            <button
              className="clientes-modal-cerrar"
              type="button"
              onClick={() => setClienteDetalle(null)}
              aria-label="Cerrar"
            >
              ×
            </button>
            <div className="clientes-modal-icono">
              {icono("detalle")}
            </div>
            <h2 id="clientes-detalle-titulo">
              Detalle de {clienteDetalle.nombre}
            </h2>
            <p className="clientes-modal-descripcion">
              {clienteDetalle.telefono || "Sin celular"} ·{" "}
              {clienteDetalle.ventas.length} venta(s) visible(s)
            </p>

            {clienteDetalle.notas && (
              <div className="clientes-notas">
                <strong>Notas</strong>
                <p>{clienteDetalle.notas}</p>
              </div>
            )}

            <div className="clientes-modal-saldo">
              <span>Saldo pendiente total</span>
              <strong>{dinero(clienteDetalle.saldoPendiente)}</strong>
            </div>

            <div className="clientes-detalle-bloque">
              <h3>Ventas</h3>
              {clienteDetalle.ventas.length ? (
                <div className="clientes-historial-lista">
                  {clienteDetalle.ventas.map((venta) => (
                    <article key={venta.id}>
                      <div>
                        <strong>Venta #{venta.id}</strong>
                        <small>
                          {fechaCorta(venta.fecha)} ·{" "}
                          {venta.etiquetaPago}
                          {venta.abonos?.length
                            ? ` · ${venta.abonos.length} abono(s)`
                            : ""}
                        </small>
                        <small>{resumenLineas(venta)}</small>
                      </div>
                      <div>
                        <strong>{dinero(venta.total)}</strong>
                        <small>
                          Saldo: {dinero(venta.saldo)}
                        </small>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="clientes-detalle-vacio">
                  No hay ventas visibles para este cliente.
                </p>
              )}
            </div>

            <div className="clientes-detalle-bloque">
              <h3>Pedidos pendientes de venta</h3>
              {clienteDetalle.pedidos.length ? (
                clienteDetalle.pedidos.map((pedido) => (
                  <article key={pedido.id}>
                    <div>
                      <strong>Pedido #{pedido.id}</strong>
                      <small>
                        {ETIQUETAS_PEDIDO[pedido.estado] ||
                          pedido.estado}{" "}
                        · {fechaCorta(pedido.creado_en)}
                        {pedido.unidadesPendientesCompra
                          ? ` · ${pedido.unidadesPendientesCompra} unidad(es) por recibir`
                          : ""}
                      </small>
                    </div>
                    <div>
                      <strong>{dinero(pedido.total)}</strong>
                      <small>
                        Pagado: {dinero(pedido.montoPagado)} ·
                        Saldo: {dinero(pedido.saldo)}
                      </small>
                    </div>
                  </article>
                ))
              ) : (
                <p className="clientes-detalle-vacio">
                  No hay pedidos pendientes de venta.
                </p>
              )}
            </div>

            <div className="clientes-modal-acciones">
              <button
                className="clientes-cancelar"
                type="button"
                onClick={() => setClienteDetalle(null)}
              >
                Cerrar
              </button>
            </div>
          </section>
        </div>
      )}

      {clienteAbono && (
        <div
          className="clientes-modal-fondo"
          role="presentation"
          onMouseDown={(evento) => {
            if (
              !procesandoAbono &&
              evento.target === evento.currentTarget
            ) {
              setClienteAbono(null);
            }
          }}
        >
          <section
            className="clientes-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clientes-abono-titulo"
          >
            <button
              className="clientes-modal-cerrar"
              type="button"
              onClick={() => {
                if (!procesandoAbono) setClienteAbono(null);
              }}
              aria-label="Cerrar"
              disabled={procesandoAbono}
            >
              ×
            </button>
            <div className="clientes-modal-icono">
              {icono("abono")}
            </div>
            <h2 id="clientes-abono-titulo">Registrar abono</h2>
            <p className="clientes-modal-descripcion">
              {clienteAbono.nombre} ·{" "}
              {clienteAbono.telefono || "Sin celular"}
            </p>
            <div className="clientes-modal-saldo">
              <span>Saldo total del cliente</span>
              <strong>{dinero(clienteAbono.saldoPendiente)}</strong>
            </div>
            <form
              className="clientes-formulario-abono"
              onSubmit={enviarAbono}
            >
              <label>
                Venta que recibe el abono
                <select
                  value={ventaAbonoId}
                  onChange={(evento) => {
                    setVentaAbonoId(evento.target.value);
                    setImporteAbono("");
                    setErrorAbono("");
                    claveAbonoRef.current =
                      crearClaveIdempotencia();
                  }}
                  required
                  disabled={procesandoAbono}
                >
                  {ventasAbono.map((venta) => (
                    <option key={venta.id} value={String(venta.id)}>
                      Venta #{venta.id} · pendiente{" "}
                      {dinero(venta.saldo)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="clientes-campo-abono">
                Valor recibido (COP)
                <input
                  type="text"
                  inputMode="numeric"
                  value={importeAbono}
                  onChange={(evento) => {
                    setImporteAbono(
                      limpiarImporte(evento.target.value),
                    );
                    setErrorAbono("");
                    claveAbonoRef.current =
                      crearClaveIdempotencia();
                  }}
                  placeholder="Ej. 50000"
                  autoComplete="off"
                  required
                  disabled={procesandoAbono}
                />
              </label>
              <label className="clientes-campo-abono">
                Fecha del pago
                <input
                  type="date"
                  value={fechaAbono}
                  max={fechaActualColombia()}
                  onChange={(evento) => {
                    setFechaAbono(evento.target.value);
                    setErrorAbono("");
                    claveAbonoRef.current =
                      crearClaveIdempotencia();
                  }}
                  required
                  disabled={procesandoAbono}
                />
              </label>
              {errorAbono && (
                <p className="clientes-error" role="alert">
                  {errorAbono}
                </p>
              )}
              <footer className="clientes-modal-acciones">
                <button
                  className="clientes-cancelar"
                  type="button"
                  onClick={() => {
                    if (!procesandoAbono) setClienteAbono(null);
                  }}
                  disabled={procesandoAbono}
                >
                  Cancelar
                </button>
                <button
                  className="clientes-confirmar-abono"
                  type="submit"
                  disabled={procesandoAbono || !importeAbono}
                >
                  {procesandoAbono
                    ? "Guardando..."
                    : "Guardar abono"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

    </section>
  );
}

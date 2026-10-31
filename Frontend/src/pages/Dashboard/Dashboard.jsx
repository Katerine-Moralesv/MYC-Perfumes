import { useEffect, useMemo, useState } from "react";
import logoMYC from "../../assets/logo-myc.png";
import "./Dashboard.css";
import Catalogo from "../Catalogo/Catalogo";
import Ventas from "../Ventas/Ventas";
import Pedidos from "../Pedidos/Pedidos";
import Compras from "../Compras/Compras";
import Clientes from "../Clientes/Clientes";
import Configuracion from "../Configuracion/Configuracion";
import { obtenerResumenDashboard } from "../../services/dashboardMetricas.js";
import { useAuth } from "../../context/auth-context";
import {
  construirResumenActual,
  construirTarjetas,
  crearEscala,
  etiquetaEstadoPedido,
  etiquetaMes,
  formatearCompactoCOP,
  formatearFechaPedido,
  formatearMonedaCOP,
  formatearNumero,
  posicionBarraVertical,
  prepararSeries,
  puedeMostrarResumenInferior,
  resolverSeccion,
} from "./dashboardVista.js";

function obtenerMesActual() {
  const fecha = new Date();

  return `${fecha.getFullYear()}-${String(
    fecha.getMonth() + 1,
  ).padStart(2, "0")}`;
}

function capitalizar(texto) {
  const valor = String(texto ?? "");

  return valor
    ? valor.charAt(0).toLocaleUpperCase("es-CO") + valor.slice(1)
    : valor;
}

function obtenerIniciales(nombre = "Usuario") {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);

  if (partes.length === 0) return "A";

  return partes
    .slice(0, 2)
    .map((parte) => parte[0].toLocaleUpperCase("es-CO"))
    .join("");
}

function Icono({ nombre, size = 20 }) {
  const comunes = {
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
    inicio: (
      <>
        <path d="m3 10 9-7 9 7" />
        <path d="M5 9v12h14V9" />
        <path d="M9 21v-7h6v7" />
      </>
    ),

    catalogo: (
      <>
        <path d="m12 3 9 5-9 5-9-5 9-5Z" />
        <path d="M3 8v9l9 5 9-5V8" />
        <path d="M12 13v9" />
      </>
    ),

    ventas: (
      <>
        <path d="M3 3v18h18" />
        <path d="m7 14 4-4 4 3 6-7" />
        <path d="M16 6h5v5" />
      </>
    ),

    compras: (
      <>
        <circle cx="9" cy="20" r="1" />
        <circle cx="19" cy="20" r="1" />
        <path d="M2 3h3l3 12h11l3-9H6" />
      </>
    ),

    clientes: (
      <>
        <circle cx="9" cy="8" r="4" />
        <path d="M2 21v-2a7 7 0 0 1 14 0v2" />
        <path d="M17 4a4 4 0 0 1 0 8" />
        <path d="M19 14a5 5 0 0 1 3 5v2" />
      </>
    ),

    bolsa: (
      <>
        <rect x="4" y="7" width="16" height="14" rx="2" />
        <path d="M9 7V5a3 3 0 0 1 6 0v2" />
      </>
    ),

    documento: (
      <>
        <path d="M6 3h9l5 5v13H6z" />
        <path d="M14 3v6h6M9 13h8M9 17h8" />
      </>
    ),

    usuarios: (
      <>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 15a5 5 0 0 1 5 5" />
      </>
    ),

    calendario: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 10h18" />
      </>
    ),

    menu: <path d="M4 6h16M4 12h16M4 18h16" />,

    configuracion: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="m19.4 15 .1.1 1.1 1.8-2 2-1.8-1.1a8 8 0 0 1-1.7.7l-.5 2.1h-2.8l-.5-2.1a8 8 0 0 1-1.7-.7l-1.8 1.1-2-2 1.1-1.8a8 8 0 0 1-.7-1.7L4 12.8V10l2.1-.5a8 8 0 0 1 .7-1.7L5.7 6l2-2 1.8 1.1a8 8 0 0 1 1.7-.7L11.7 2h2.8l.5 2.1a8 8 0 0 1 1.7.7L18.5 3l2 2-1.1 1.8a8 8 0 0 1 .7 1.7l2.1.5v2.8l-2.1.5a8 8 0 0 1-.7 1.7Z" />
      </>
    ),

    salir: (
      <>
        <path d="M10 17l5-5-5-5" />
        <path d="M15 12H3" />
        <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" />
      </>
    ),

    reloj: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),

    ganancia: (
      <>
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <path d="m7 15 4-4 3 2 5-6" />
        <path d="M15 7h4v4" />
      </>
    ),

    recaudacion: (
      <>
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 10h18" />
        <path d="M7 16h3" />
        <circle cx="17" cy="15" r="1.4" />
      </>
    ),

    vendido: (
      <>
        <path d="M4 8h16l-1 12H5L4 8Z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </>
    ),

    deudas: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20v-2a6 6 0 0 1 12 0v2" />
        <path d="M16 7h5M18.5 4.5v5" />
      </>
    ),

    devolucion: (
      <>
        <path d="M4 8h11a5 5 0 0 1 0 10H8" />
        <path d="m8 4-4 4 4 4" />
        <path d="M20 16h-3" />
      </>
    ),

    pedidos: (
      <>
        <path d="M7 3h10l2 4v14H5V7l2-4Z" />
        <path d="M5 7h14M9 11h6M9 15h6" />
      </>
    ),
  };

  return <svg {...comunes}>{dibujos[nombre] || dibujos.inicio}</svg>;
}

function BarrasVerticales({
  datos,
  escala,
  etiquetaVacia,
  ariaLabel,
}) {
  if (!datos.length) {
    return <div className="dash-chart-empty">{etiquetaVacia}</div>;
  }

  return (
    <div className="bar-chart" role="img" aria-label={ariaLabel}>
      <div className="bar-y-labels" aria-hidden="true">
        {[...escala.etiquetas].reverse().map((etiqueta, indice) => (
          <span key={`${etiqueta}-${indice}`}>{etiqueta}</span>
        ))}
      </div>

      <div className="bar-chart-main">
        <div className="bar-grid" aria-hidden="true">
          {escala.ticks.map((tick, indice) => (
            <span key={`${tick}-${indice}`} />
          ))}
        </div>

        <div className="bar-columns">
          {datos.map((item) => {
            const posicion = posicionBarraVertical(
              item.valor,
              escala.minimo,
              escala.maximo,
            );

            return (
              <div className="bar-item" key={item.clave}>
                <span
                  className={`bar${
                    posicion.negativa ? " bar-negativa" : ""
                  }`}
                  style={{
                    bottom: `${posicion.inferior}%`,
                    height: `${posicion.altura}%`,
                  }}
                  title={`${item.etiqueta}: ${item.textoValor}`}
                />

                <span className="bar-name" title={item.etiqueta}>
                  {item.etiqueta}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GraficaLineas({ datos, escala, puntos, ariaLabel }) {
  const ancho = 600;
  const alto = 190;
  const altoTrazado = 148;
  const inicioTrazado = 18;
  const rango = escala.maximo - escala.minimo || 1;
  const ceroY =
    inicioTrazado +
    ((escala.maximo - 0) / rango) * altoTrazado;

  const linea = puntos
    .map(
      (punto, indice) =>
        `${indice === 0 ? "M" : "L"} ${punto.x} ${punto.y}`,
    )
    .join(" ");

  const area =
    puntos.length > 1
      ? `${linea} L ${
          puntos[puntos.length - 1].x
        } ${ceroY} L ${puntos[0].x} ${ceroY} Z`
      : "";

  return (
    <div className="line-chart" role="img" aria-label={ariaLabel}>
      <div className="line-y-labels" aria-hidden="true">
        {[...escala.etiquetas].reverse().map((etiqueta, indice) => (
          <span key={`${etiqueta}-${indice}`}>{etiqueta}</span>
        ))}
      </div>

      <div className="line-chart-main">
        <div className="line-grid" aria-hidden="true">
          {escala.ticks.map((tick, indice) => (
            <span key={`${tick}-${indice}`} />
          ))}
        </div>

        <svg
          viewBox={`0 0 ${ancho} ${alto}`}
          preserveAspectRatio="none"
          className="line-svg"
          aria-hidden="true"
        >
          <defs>
            <linearGradient
              id="dashGananciaFill"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor="#E9A0A3"
                stopOpacity="0.3"
              />
              <stop
                offset="100%"
                stopColor="#E9A0A3"
                stopOpacity="0.02"
              />
            </linearGradient>
          </defs>

          {area && <path d={area} fill="url(#dashGananciaFill)" />}

          {linea && (
            <path
              d={linea}
              fill="none"
              stroke="#E99A9E"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {puntos.map((punto) => (
            <circle
              key={`punto-${punto.clave}`}
              cx={punto.x}
              cy={punto.y}
              r="4.5"
              fill="#E99A9E"
            >
              <title>
                {`${punto.etiquetaLarga}: ${punto.textoCompleto}`}
              </title>
            </circle>
          ))}
        </svg>

        <div className="line-months" aria-hidden="true">
          {datos.map((item) => (
            <span key={item.clave}>{item.etiqueta}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Dashboard({ onCerrarSesion }) {
  const { user, isAdmin } = useAuth();
  const [seccion, setSeccion] = useState(() =>
    isAdmin ? "Dashboard" : "Ventas",
  );
  const [mes, setMes] = useState(obtenerMesActual);
  const mesActual = obtenerMesActual();

  const [menuUsuario, setMenuUsuario] = useState(false);
  const [menuMovil, setMenuMovil] = useState(false);
  const [resumenPeriodo, setResumenPeriodo] = useState(null);
  const [metricasActuales, setMetricasActuales] = useState(null);
  const [pedidosRecientes, setPedidosRecientes] = useState([]);
  const [cargandoDashboard, setCargandoDashboard] = useState(true);
  const [errorDashboard, setErrorDashboard] = useState("");
  const [recargaDashboard, setRecargaDashboard] = useState(0);

  const nombreMes = capitalizar(etiquetaMes(mes));

  const nombreAdmin =
    [user?.first_name, user?.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    user?.username ||
    "Usuario";
  const correoAdmin = user?.email || "";
  const rolAdmin = isAdmin ? "Administrador" : "Vendedor";

  const seccionActual = resolverSeccion(seccion, isAdmin);

  const navegacion = [
    { nombre: "Dashboard", icono: "inicio", soloAdmin: true },
    { nombre: "Catálogo", icono: "catalogo", soloAdmin: true },
    { nombre: "Ventas", icono: "ventas" },
    { nombre: "Pedidos", icono: "documento", soloAdmin: true },
    { nombre: "Compras", icono: "compras", soloAdmin: true },
    { nombre: "Clientes", icono: "clientes" },
  ].filter((item) => !item.soloAdmin || isAdmin);

  useEffect(() => {
    if (!isAdmin || seccionActual !== "Dashboard") {
      return undefined;
    }

    const controlador = new AbortController();
    let activo = true;

    obtenerResumenDashboard(mes, {
      signal: controlador.signal,
    })
      .then((data) => {
        if (!activo) return;

        setResumenPeriodo(data?.metricas_periodo || {});
        setMetricasActuales(data?.metricas_actuales || {});
        setPedidosRecientes(
          Array.isArray(data?.pedidos_recientes)
            ? data.pedidos_recientes
            : [],
        );
      })
      .catch((error) => {
        if (!activo || error.isCanceled) return;

        setErrorDashboard(
          error.message ||
            "No se pudieron cargar las métricas del Dashboard.",
        );
      })
      .finally(() => {
        if (activo) setCargandoDashboard(false);
      });

    return () => {
      activo = false;
      controlador.abort();
    };
  }, [isAdmin, seccionActual, mes, recargaDashboard]);

  const tarjetas = useMemo(
    () =>
      construirTarjetas({
        metricas_periodo: resumenPeriodo || {},
        metricas_actuales: metricasActuales || {},
      }),
    [resumenPeriodo, metricasActuales],
  );

  const resumenActual = useMemo(
    () => construirResumenActual(metricasActuales || {}),
    [metricasActuales],
  );

  const series = useMemo(
    () => prepararSeries(resumenPeriodo || {}),
    [resumenPeriodo],
  );

  const escalaUnidades = useMemo(
    () =>
      crearEscala(
        series.unidades.map((item) => item.valor),
        { formatear: formatearNumero, enteros: true },
      ),
    [series.unidades],
  );

  const escalaGananciaProducto = useMemo(
    () =>
      crearEscala(
        series.gananciasProducto.map((item) => item.valor),
        { formatear: formatearCompactoCOP },
      ),
    [series.gananciasProducto],
  );

  const escalaMensual = useMemo(
    () =>
      crearEscala(
        series.gananciasMensuales.map((item) => item.valor),
        { formatear: formatearCompactoCOP },
      ),
    [series.gananciasMensuales],
  );

  const puntosLinea = useMemo(() => {
    const datos = series.gananciasMensuales;
    const rango = escalaMensual.maximo - escalaMensual.minimo || 1;
    const inicioX = 24;
    const finX = 576;
    const inicioY = 18;
    const altoTrazado = 148;

    return datos.map((item, indice) => ({
      ...item,
      x:
        datos.length === 1
          ? 300
          : inicioX +
            (indice * (finX - inicioX)) / (datos.length - 1),
      y:
        inicioY +
        ((escalaMensual.maximo - item.valor) / rango) *
          altoTrazado,
    }));
  }, [series.gananciasMensuales, escalaMensual]);

  const hayGananciasMensuales = series.gananciasMensuales.some(
    (item) => item.valor !== 0,
  );

  const mostrarResumenInferior = puedeMostrarResumenInferior({
    cargando: cargandoDashboard,
    error: errorDashboard,
    resumenPeriodo,
    metricasActuales,
  });

  function cerrarSesion() {
    setMenuUsuario(false);
    onCerrarSesion?.();
  }

  function prepararCargaDashboard() {
    setCargandoDashboard(true);
    setErrorDashboard("");
    setResumenPeriodo(null);
  }

  function cambiarMes(valor) {
    if (!valor || valor === mes) return;

    prepararCargaDashboard();
    setMes(valor);
  }

  function reintentarDashboard() {
    prepararCargaDashboard();
    setRecargaDashboard((actual) => actual + 1);
  }

  function abrirSeccion(nombre) {
    if (!isAdmin && resolverSeccion(nombre, isAdmin) !== nombre) {
      return;
    }

    if (nombre === "Dashboard" && seccionActual !== "Dashboard") {
      prepararCargaDashboard();
    }

    setSeccion(nombre);
    setMenuUsuario(false);
    setMenuMovil(false);
  }

  return (
    <main className="dashboard">
      <header className="dash-header">
        <div className="dash-header-inner">
          <button
            className="dash-mobile-toggle"
            type="button"
            onClick={() => setMenuMovil(!menuMovil)}
            aria-label="Abrir menú"
            aria-expanded={menuMovil}
          >
            <Icono nombre="menu" size={23} />
          </button>

          <div className="dash-brand">
            <img src={logoMYC} alt="MYC Perfumes" />
            <span />
          </div>

          <nav
            className={`dash-nav ${
              menuMovil ? "dash-nav-abierto" : ""
            }`}
          >
            {navegacion.map((item) => (
              <button
                type="button"
                key={item.nombre}
                className={`dash-nav-item ${
                  seccionActual === item.nombre ? "activo" : ""
                }`}
                onClick={() => abrirSeccion(item.nombre)}
              >
                <Icono nombre={item.icono} size={18} />
                <span>{item.nombre}</span>
              </button>
            ))}
          </nav>

          <div className="dash-user-wrap">
            <button
              type="button"
              className="dash-user"
              onClick={() => setMenuUsuario(!menuUsuario)}
              aria-label={`Abrir menú de ${nombreAdmin}`}
              aria-expanded={menuUsuario}
              title={nombreAdmin}
            >
              <span>{obtenerIniciales(nombreAdmin)}</span>
            </button>

            {menuUsuario && (
              <div className="dash-user-menu">
                <strong>{nombreAdmin}</strong>
                <span>{rolAdmin} · MYC Perfumes</span>

                {correoAdmin && (
                  <span className="dash-user-correo">
                    {correoAdmin}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => abrirSeccion("Configuración")}
                >
                  <Icono nombre="configuracion" size={17} />
                  Configuración
                </button>

                <button type="button" onClick={cerrarSesion}>
                  <Icono nombre="salir" size={17} />
                  Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="dash-decoration dash-decoration-top" aria-hidden="true">
        ✧
      </div>
      <div className="dash-decoration dash-decoration-side" aria-hidden="true">
        ✦
      </div>
      <div className="dash-decoration dash-decoration-bottom" aria-hidden="true">
        ✧
      </div>

      <div
        className={`dash-content${
          seccionActual === "Dashboard"
            ? " dash-content-dashboard"
            : ""
        }`}
      >
        {seccionActual === "Dashboard" && (
          <div className="dash-heading">
            <div className="dash-heading-texto">
              <h1>Dashboard de análisis</h1>
              <p>
                Aquí puedes ver un resumen del desempeño de tu negocio
              </p>
            </div>

            <div className="dash-periodo">
              <label
                className="dash-periodo-etiqueta"
                htmlFor="dash-mes"
              >
                Periodo
              </label>

              <div className="dash-periodo-control">
                <Icono nombre="calendario" size={18} />

                <input
                  id="dash-mes"
                  className="dash-periodo-input"
                  type="month"
                  min="2020-01"
                  max={mesActual}
                  value={mes}
                  onChange={(evento) =>
                    cambiarMes(evento.target.value)
                  }
                  aria-label="Mes y año del dashboard"
                />
              </div>
            </div>
          </div>
        )}

        {seccionActual === "Catálogo" ? (
          <Catalogo />
        ) : seccionActual === "Ventas" ? (
          <Ventas />
        ) : seccionActual === "Pedidos" ? (
          <Pedidos />
        ) : seccionActual === "Compras" ? (
          <Compras />
        ) : seccionActual === "Clientes" ? (
          <Clientes />
        ) : seccionActual === "Configuración" ? (
          <Configuracion />
        ) : (
          <>
            {cargandoDashboard ? (
              <section
                className="dash-estado"
                role="status"
                aria-live="polite"
              >
                <span className="dash-spinner" aria-hidden="true" />

                <div>
                  <strong>Preparando el resumen ejecutivo</strong>
                  <p>
                    Consultando las métricas de {nombreMes}.
                  </p>
                </div>
              </section>
            ) : errorDashboard ? (
              <section
                className="dash-estado dash-estado-error"
                role="alert"
              >
                <span className="dash-estado-icono">
                  <Icono nombre="documento" size={22} />
                </span>

                <div>
                  <strong>No se pudo cargar el Dashboard</strong>
                  <p>{errorDashboard}</p>
                </div>

                <button
                  type="button"
                  className="dash-retry"
                  onClick={reintentarDashboard}
                >
                  Reintentar
                </button>
              </section>
            ) : (
              <>
                <section className="dash-stats">
                  {tarjetas.map((tarjeta) => (
                    <article
                      key={tarjeta.clave}
                      className={`dash-stat dash-stat-${tarjeta.clave}${
                        tarjeta.alerta ? " dash-stat-alerta" : ""
                      }`}
                    >
                      <div className="dash-stat-cabecera">
                        <span className="dash-stat-icon">
                          <Icono nombre={tarjeta.icono} size={22} />
                        </span>

                        <p>{tarjeta.titulo}</p>
                      </div>

                      <div
                        className={`dash-stat-valor${
                          tarjeta.tipo === "cantidad"
                            ? " dash-stat-cantidad"
                            : ""
                        }${
                          tarjeta.tipo === "no-disponible"
                            ? " dash-stat-no-disponible"
                            : ""
                        }`}
                      >
                        {tarjeta.valor}

                        {tarjeta.sufijo && (
                          <span className="dash-stat-sufijo">
                            {tarjeta.sufijo}
                          </span>
                        )}
                      </div>

                      <small>{tarjeta.nota}</small>
                    </article>
                  ))}
                </section>

                <section className="dash-charts">
                  <article className="dash-panel">
                    <div className="dash-panel-heading">
                      <div>
                        <h2>Unidades vendidas por producto</h2>
                        <p className="dash-panel-subtitle">
                          {nombreMes}
                        </p>
                      </div>
                    </div>

                    <BarrasVerticales
                      datos={series.unidades}
                      escala={escalaUnidades}
                      etiquetaVacia={`Sin unidades vendidas en ${nombreMes}.`}
                      ariaLabel={`Unidades vendidas por producto en ${nombreMes}`}
                    />
                  </article>

                  <article className="dash-panel">
                    <div className="dash-panel-heading">
                      <div>
                        <h2>Ganancia bruta por producto</h2>
                        <p className="dash-panel-subtitle">
                          {nombreMes}
                        </p>
                      </div>
                    </div>

                    <BarrasVerticales
                      datos={series.gananciasProducto}
                      escala={escalaGananciaProducto}
                      etiquetaVacia={`Sin ganancias por producto en ${nombreMes}.`}
                      ariaLabel={`Ganancia bruta por producto en ${nombreMes}`}
                    />
                  </article>

                  <article className="dash-panel dash-panel-ancho">
                    <div className="dash-panel-heading">
                      <div>
                        <h2>Ganancias brutas mensuales</h2>
                        <p className="dash-panel-subtitle">
                          últimos seis meses hasta {nombreMes}
                        </p>
                      </div>
                    </div>

                    {hayGananciasMensuales ? (
                      <GraficaLineas
                        datos={series.gananciasMensuales}
                        escala={escalaMensual}
                        puntos={puntosLinea}
                        ariaLabel={`Ganancias brutas mensuales de los últimos seis meses hasta ${nombreMes}`}
                      />
                    ) : (
                      <div className="dash-chart-empty">
                        Sin ganancias registradas en los últimos seis
                        meses.
                      </div>
                    )}
                  </article>
                </section>
              </>
            )}

            {mostrarResumenInferior && (
              <section className="dash-bottom">
                <article className="dash-panel dash-panel-actual">
                  <div className="dash-panel-heading">
                    <div>
                      <h2>Resumen actual</h2>
                      <p className="dash-panel-subtitle">
                        Independiente del periodo seleccionado
                      </p>
                    </div>
                  </div>

                  <div className="dash-actual-grid">
                    {resumenActual.map((item) => (
                      <div
                        className="dash-actual-item"
                        key={item.clave}
                      >
                        <span className="dash-actual-icon">
                          <Icono nombre={item.icono} size={19} />
                        </span>

                        <span className="dash-actual-etiqueta">
                          {item.etiqueta}
                        </span>

                        <strong
                          className={
                            item.tipo === "cantidad"
                              ? "dash-actual-cantidad"
                              : ""
                          }
                        >
                          {item.valor}

                          {item.sufijo && (
                            <span>{item.sufijo}</span>
                          )}
                        </strong>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="dash-panel dash-panel-recientes">
                  <div className="dash-panel-heading">
                    <div>
                      <h2>Pedidos recientes</h2>
                      <p className="dash-panel-subtitle">
                        últimos cinco pedidos registrados
                      </p>
                    </div>

                    <button
                      type="button"
                      className="dash-panel-link"
                      onClick={() => setSeccion("Pedidos")}
                    >
                      Ver pedidos
                      <span aria-hidden="true">→</span>
                    </button>
                  </div>

                  {pedidosRecientes.length ? (
                    <div className="dash-orders-table">
                      <div
                        className="dash-orders-header"
                        aria-hidden="true"
                      >
                        <span>Cliente</span>
                        <span>Fecha</span>
                        <span>Total</span>
                        <span>Estado</span>
                      </div>

                      <ul className="dash-pedidos">
                        {pedidosRecientes.map((pedido) => (
                          <li className="dash-pedido" key={pedido.id}>
                            <strong className="dash-pedido-cliente">
                              {pedido.cliente_nombre || "Cliente"}
                            </strong>

                            <span className="dash-pedido-fecha">
                              {formatearFechaPedido(
                                pedido.creado_en,
                              )}
                            </span>

                            <strong className="dash-pedido-total">
                              {formatearMonedaCOP(pedido.total)}
                            </strong>

                            <span
                              className={`estado estado-${
                                pedido.estado
                              }`}
                            >
                              {etiquetaEstadoPedido(pedido.estado)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="dash-chart-empty">
                      Aún no hay pedidos registrados.
                    </div>
                  )}
                </article>
              </section>
            )}
          </>
        )}

        <footer className="dash-footer">
          <span>MYC Perfumes</span>
          <span>Panel administrativo · MYC Perfumes</span>
        </footer>
      </div>
    </main>
  );
}

export default Dashboard;

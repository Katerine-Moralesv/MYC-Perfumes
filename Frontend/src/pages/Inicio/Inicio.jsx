import { useEffect, useMemo, useRef, useState } from "react";
import logoMYC from "../../assets/logo-myc.png";
import fondoFloral from "../../assets/fondo-floral.png";
import "./Inicio.css";

import {
  listarCategorias,
  listarFamiliasOlfativas,
  listarProductos,
  resolverUrlMedia,
} from "../../services/catalogo.js";
import {
  aplicarRecargas,
  claveLineaChat,
  eliminarSeleccionEnviada,
  mensajeErrorPedido,
  registrarPedido,
} from "../../services/pedidos.js";

const CLAVE_SELECCION = "myc_mi_coleccion_v1";
const PORCENTAJE_BASE = "40";
const VISTAS_PUBLICAS = ["inicio", "catalogo", "nosotros", "seleccion"];

function obtenerVistaDesdeUrl() {
  if (typeof window === "undefined") return "inicio";

  const hash = window.location.hash.replace(/^#\/?/, "").toLowerCase();
  if (VISTAS_PUBLICAS.includes(hash)) return hash;

  const segmento = window.location.pathname
    .replace(/\/+$/, "")
    .split("/")
    .pop()
    .toLowerCase();

  return VISTAS_PUBLICAS.includes(segmento) ? segmento : "inicio";
}

const dinero = (valor) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(valor) || 0);

function extraerMililitros(producto) {
  const directo = producto?.contenido_ml ?? producto?.mililitros;

  if (directo != null && String(directo).trim()) {
    const match = String(directo).replace(",", ".").match(/\d+(?:\.\d+)?/);
    if (match) return `${Number(match[0])} ml`;
  }

  const texto = [producto?.descripcion, producto?.nombre]
    .filter(Boolean)
    .join(" ");

  const match = texto.match(/(\d+(?:[.,]\d+)?)\s*ml\b/i);
  return match
    ? `${Number(match[1].replace(",", "."))} ml`
    : "Presentación por confirmar";
}

function formatearDiasEntrega(valor) {
  const dias = Number(valor);

  if (!Number.isFinite(dias) || dias < 1) {
    return "Por confirmar";
  }

  return dias === 1 ? "1 día" : `${dias} días`;
}

function normalizarFamilias(producto) {
  const nombres = Array.isArray(producto?.familias_olfativas_nombres)
    ? producto.familias_olfativas_nombres
    : [];

  return [
    ...new Set(
      nombres
        .map((nombre) => String(nombre || "").trim())
        .filter(Boolean)
    ),
  ];
}

function normalizarProducto(producto) {
  const categoriaNombre = String(
    producto?.categoria_nombre || ""
  ).trim();
  const familiasOlfativas = normalizarFamilias(producto);

  return {
    id: producto?.id ?? null,
    nombre: producto?.nombre || "Producto MYC",
    categoria: categoriaNombre || "Sin categoría",
    categoriaId: producto?.categoria ?? null,
    categoriaNombre,
    publico: categoriaNombre || "Sin especificar",
    familiasOlfativas,
    familiaAromatica: familiasOlfativas[0] || "Sin especificar",
    tipo: "",
    presentacion: "",
    mililitros: extraerMililitros(producto),
    contenidoMl: Number(producto?.contenido_ml) || null,
    precio: Number(producto?.precio ?? 0) || 0,
    descripcion: producto?.descripcion || "",
    imagen: resolverUrlMedia(producto?.foto),
    tiempoEntrega: formatearDiasEntrega(producto?.dias_entrega),
    activo: producto?.activo !== false,
  };
}

function derivarCategorias(productos) {
  return [
    ...new Set(
      productos
        .map((producto) => producto.publico)
        .filter((nombre) => nombre && nombre !== "Sin especificar")
    ),
  ].sort((a, b) => a.localeCompare(b, "es"));
}

function derivarFamilias(productos) {
  return [
    ...new Set(
      productos.flatMap((producto) => producto.familiasOlfativas)
    ),
  ].sort((a, b) => a.localeCompare(b, "es"));
}

function precioParaRecarga(producto, porcentaje) {
  if (!porcentaje || String(porcentaje) === PORCENTAJE_BASE) {
    return Number(producto?.precio ?? 0) || 0;
  }

  return 0;
}

function leerSeleccion() {
  try {
    const guardado = sessionStorage.getItem(CLAVE_SELECCION);
    const datos = guardado ? JSON.parse(guardado) : [];

    if (!Array.isArray(datos)) return [];

    return datos
      .filter((item) => item?.productId != null && item?.lineKey)
      .map((item) => ({
        ...item,
        concentracion: item.concentracion || PORCENTAJE_BASE,
        precioBase:
          Number(
            item.precioBase ??
              (Number(item.concentracion || 40) === 40
                ? item.precioUnitario
                : 0)
          ) || 0,
        familiasOlfativas: Array.isArray(item.familiasOlfativas)
          ? item.familiasOlfativas
          : item.familiaAromatica
            ? [item.familiaAromatica]
            : [],
      }));
  } catch {
    return [];
  }
}

function Flecha() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 12h14M12 5.5l6.5 6.5-6.5 6.5" />
    </svg>
  );
}

function Bolsa() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 8h14l1 12H4L5 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

function Corazon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
    </svg>
  );
}

function IconoHoja() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 4C12 4 5 8.5 5 16v4" />
      <path d="M5 20c0-5.5 3.5-9.5 9-11.5" />
      <path d="M9 14c2.5.3 4.5 1.5 5.5 3.5" />
    </svg>
  );
}

function IconoDiamante() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 7 7-7 11L5 10l7-7Z" />
      <path d="M5 10h14M12 3v18" />
    </svg>
  );
}

function RamaBotanica({ className = "" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 170 250"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M22 226C58 174 70 120 58 22"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M58 58C37 54 24 42 20 23c21 2 34 14 38 35Z"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path
        d="M60 91c16-11 33-11 48 1-15 12-33 11-48-1Z"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path
        d="M55 125c-17-4-28-15-30-32 19 2 30 13 33 30Z"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path
        d="M53 158c15-9 30-8 43 4-14 9-30 8-43-4Z"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path
        d="M47 190c-14-3-23-12-26-26 16 1 26 11 29 26Z"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <circle cx="58" cy="77" r="2.2" fill="currentColor" />
      <circle cx="83" cy="112" r="1.8" fill="currentColor" />
      <circle cx="43" cy="176" r="1.8" fill="currentColor" />
    </svg>
  );
}

function IconoChat() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.2 11.5a8.1 8.1 0 0 1-8.3 8.1 8.7 8.7 0 0 1-3.5-.8L3 20l1.3-4.9a7.8 7.8 0 0 1-.9-3.6 8.2 8.2 0 0 1 8.4-8 8.3 8.3 0 0 1 8.4 8Z" />
    </svg>
  );
}

function ImagenProducto({ src, alt }) {
  const [error, setError] = useState(false);

  useEffect(() => setError(false), [src]);

  const valida =
    typeof src === "string" && src.trim().length > 0;

  if (!valida || error) {
    return (
      <div className="inicio-imagen-fallback" role="img" aria-label={`Foto pendiente: ${alt}`}>
        <span className="inicio-imagen-fallback-simbolo">✦</span>
        <strong>MYC</strong>
        <small>Foto por actualizar</small>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setError(true)}
    />
  );
}

/* Una tarjeta reutilizable para Inicio y Catálogo público. */
function ProductCard({
  producto,
  agregado,
  onDetalles,
  onAnadir,
  onComprar,
  variante = "catalogo",
}) {
  const destacado = variante === "destacado";
  const etiquetaAgregado = agregado
    ? `${producto.nombre} ya está en Mi colección; añadir otra línea`
    : `Añadir ${producto.nombre} a Mi colección`;

  return (
    <article
      className={`inicio-producto-card${
        destacado ? " inicio-producto-card-destacado" : ""
      }`}
    >
      <button
        className="inicio-producto-foto"
        type="button"
        onClick={() => onDetalles(producto)}
        aria-label={`Ver detalles de ${producto.nombre}`}
      >
        <ImagenProducto
          src={producto.imagen}
          alt={`Fotografía de ${producto.nombre}`}
        />
        <span className="inicio-producto-etiqueta">Por encargo</span>
      </button>

      {destacado && (
        <button
          type="button"
          className={`inicio-producto-favorito${
            agregado ? " activo" : ""
          }`}
          onClick={() => onAnadir(producto)}
          aria-pressed={agregado}
          aria-label={etiquetaAgregado}
          title={etiquetaAgregado}
        >
          <Corazon />
        </button>
      )}

      <div className="inicio-producto-info">
        <span className="inicio-producto-categoria">
          {producto.publico !== "Sin especificar"
            ? producto.publico
            : producto.categoria}
          {producto.familiasOlfativas?.length
            ? ` · ${producto.familiasOlfativas.join(" · ")}`
            : ""}
        </span>

        <h3>{producto.nombre}</h3>

        <strong className="inicio-producto-precio">
          {producto.precio > 0
            ? dinero(producto.precio)
            : "Precio por confirmar"}
        </strong>

        <p className="inicio-producto-presentacion">
          {[producto.tipo, producto.mililitros || producto.presentacion]
            .filter(Boolean)
            .join(" · ")}
        </p>

        <p className="inicio-producto-entrega">
          Entrega estimada: {producto.tiempoEntrega}
        </p>

        <p className="inicio-producto-descripcion">
          {producto.descripcion || "Descripción por confirmar."}
        </p>
      </div>

      <div className="inicio-producto-acciones">
        {!destacado && (
          <button
            type="button"
            className={`inicio-producto-accion inicio-producto-anadir${agregado ? " inicio-producto-anadido" : ""}`}
            onClick={() => onAnadir(producto)}
            aria-pressed={agregado}
            aria-label={etiquetaAgregado}
          >
            {agregado ? <><span aria-hidden="true">✓</span> Añadido</> : <><span aria-hidden="true">＋</span> Añadir</>}
          </button>
        )}

        <button
          type="button"
          className={`inicio-producto-accion inicio-producto-comprar${
            destacado ? " inicio-producto-comprar-destacado" : ""
          }`}
          onClick={() => onComprar(producto)}
          aria-label={destacado ? `Comprar ${producto.nombre}` : undefined}
          title={destacado ? `Comprar ${producto.nombre}` : undefined}
        >
          {destacado ? <Bolsa /> : <>Comprar <Flecha /></>}
        </button>
      </div>
    </article>
  );
}

/* Una línea dentro de Mi colección. */
function ItemSeleccion({ item, onCambiarCantidad, onEliminar }) {
  return (
    <article className="mi-seleccion-item">
      <div className="mi-seleccion-foto">
        <ImagenProducto
          src={item.imagen}
          alt={`Fotografía de ${item.nombre}`}
        />
      </div>

      <div className="mi-seleccion-datos">
        <span className="mi-seleccion-categoria">
          {[
            item.publico,
            (item.familiasOlfativas || []).join(" · "),
          ]
            .filter((valor) => valor && valor !== "Sin especificar")
            .join(" · ") || item.categoria}
        </span>

        <h3>{item.nombre}</h3>

        <p>
          {[
            item.tipo,
            item.mililitros || item.presentacion,
            item.concentracion
              ? Number(item.concentracion) === 40
                ? "sin recarga"
                : `${item.concentracion} % de recarga`
              : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>

        <p className="mi-seleccion-precio">
          Precio unitario:{" "}
          {item.precioUnitario > 0
            ? dinero(item.precioUnitario)
            : "Por confirmar"}
        </p>

        <div className="mi-seleccion-cantidad">
          <button
            type="button"
            onClick={() => onCambiarCantidad(item.lineKey, item.cantidad - 1)}
            disabled={item.cantidad <= 1}
            aria-label={`Disminuir cantidad de ${item.nombre}`}
          >
            −
          </button>

          <span>{item.cantidad}</span>

          <button
            type="button"
            onClick={() => onCambiarCantidad(item.lineKey, item.cantidad + 1)}
            aria-label={`Aumentar cantidad de ${item.nombre}`}
          >
            ＋
          </button>
        </div>
      </div>

      <div className="mi-seleccion-subtotal">
        <strong>
          {item.precioUnitario > 0
            ? dinero(item.precioUnitario * item.cantidad)
            : "Por confirmar"}
        </strong>
        <small>Subtotal estimado</small>

        <button
          type="button"
          className="mi-seleccion-eliminar"
          onClick={() => onEliminar(item.lineKey)}
        >
          Eliminar
        </button>
      </div>
    </article>
  );
}

/* Página Mi colección. */
function MiSeleccion({
  items,
  onCambiarCantidad,
  onEliminar,
  onVaciar,
  onComprar,
  onVolverCatalogo,
}) {
  const total = items.reduce(
    (suma, item) =>
      suma + (Number(item.precioUnitario) || 0) * item.cantidad,
    0
  );

  const hayPreciosPendientes = items.some(
    (item) => !(Number(item.precioUnitario) > 0)
  );

  return (
    <div className="inicio-contenido mi-seleccion-vista">
      <section className="mi-seleccion-encabezado">
        <p className="inicio-mini-titulo">
          <span /> TU LISTA TEMPORAL
        </p>

        <h1>Mi <em>colección</em></h1>

        <p>
          Guarda las fragancias que te interesan y prepara una solicitud
          sin crear una cuenta.
        </p>
      </section>

      {items.length === 0 ? (
        <section className="mi-seleccion-vacia">
          <div className="mi-seleccion-vacia-icono">
            <Bolsa />
          </div>

          <h2>Tu colección está vacía</h2>

          <p>
            Añade productos desde el catálogo y aparecerán aquí cuando vuelvas, incluso después de recargar la página.
          </p>

          <button
            type="button"
            className="inicio-boton-principal"
            onClick={onVolverCatalogo}
          >
            Ver catálogo <Flecha />
          </button>
        </section>
      ) : (
        <>
          <div className="mi-seleccion-lista">
            {items.map((item) => (
              <ItemSeleccion
                key={item.lineKey}
                item={item}
                onCambiarCantidad={onCambiarCantidad}
                onEliminar={onEliminar}
              />
            ))}
          </div>

          <section className="mi-seleccion-resumen">
            <div>
              <span>Total estimado</span>
              <strong>{dinero(total)}</strong>

              {hayPreciosPendientes && (
                <small>
                  Hay productos sin precio confirmado. El total es provisional.
                </small>
              )}

              <small>
                Los precios y las condiciones se revisarán antes de registrar
                el pedido.
              </small>
            </div>

            <div className="mi-seleccion-resumen-acciones">
              <button
                type="button"
                className="mi-seleccion-vaciar"
                onClick={onVaciar}
              >
                Vaciar colección
              </button>

              <button
                type="button"
                className="inicio-boton-principal"
                onClick={onComprar}
              >
                Comprar colección <Flecha />
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/*
 Chatbot de compra integrado con el endpoint público de pedidos.
 Mantiene el flujo visual de selección, datos y revisión. El pedido
 se considera registrado cuando la operación finaliza correctamente.
*/
function ChatbotCompra({
  abierto,
  contexto,
  onCerrar,
  onVolver,
  onPedidoRegistrado,
}) {
  const [paso, setPaso] = useState(0);
  const [error, setError] = useState("");
  const [datos, setDatos] = useState({
    nombre: "",
    telefono: "",
    aceptaDatos: false,
  });
  const [enviando, setEnviando] = useState(false);
  const [pedidoRegistrado, setPedidoRegistrado] = useState(null);
  const [reutilizado, setReutilizado] = useState(false);
  const [recargas, setRecargas] = useState({});
  const envioEnCursoRef = useRef(false);

  useEffect(() => {
    if (!abierto) return;

    setPaso(0);
    setError("");
    setDatos({
      nombre: "",
      telefono: "",
      aceptaDatos: false,
    });
    setEnviando(false);
    setPedidoRegistrado(null);
    setReutilizado(false);
    setRecargas({});
    envioEnCursoRef.current = false;
  }, [abierto, contexto]);

  if (!abierto) return null;

  const items = contexto?.items || [];
  const itemsConRecarga = aplicarRecargas(items, recargas);

  const total = itemsConRecarga.reduce(
    (suma, item) =>
      suma +
      (Number(item.precioUnitario) || 0) *
      (Number(item.cantidad) || 1),
    0
  );

  const hayPreciosPendientes = itemsConRecarga.some(
    (item) => !(Number(item.precioUnitario) > 0)
  );

  const unidades = items.reduce(
    (suma, item) => suma + Number(item.cantidad || 1),
    0
  );

  const faltanRecargas =
    items.length === 0 ||
    items.some(
      (item, indice) => !recargas[claveLineaChat(item, indice)]
    );

  const combinacionesRecarga = itemsConRecarga.map(
    (item) => `${item.productId}:${item.concentracion}`
  );
  const hayRecargasDuplicadas =
    !faltanRecargas &&
    new Set(combinacionesRecarga).size !==
      combinacionesRecarga.length;

  function textoRecarga(item) {
    const porcentaje = Number(item.concentracion || 40);

    return porcentaje === 40
      ? "Sin recarga"
      : `Recarga ${porcentaje} %`;
  }

  function actualizarDato(campo, valor) {
    setDatos((actual) => ({ ...actual, [campo]: valor }));

    if (error) setError("");
  }

  function actualizarRecarga(clave, valor) {
    setRecargas((actual) => ({
      ...actual,
      [clave]: valor,
    }));

    if (error) setError("");
  }

  function continuarDesdeRecargas() {
    setError("");

    if (faltanRecargas) {
      setError(
        "Elige una opción de recarga para cada producto antes de continuar."
      );
      return;
    }

    if (hayRecargasDuplicadas) {
      setError(
        "No puedes elegir el mismo porcentaje para dos líneas del mismo producto."
      );
      return;
    }

    setPaso(2);
  }

  function validarDatos(event) {
    event.preventDefault();
    setError("");

    if (!datos.nombre.trim()) {
      setError("Escribe tu nombre para continuar.");
      return;
    }

    const telefonoLimpio = datos.telefono.replace(/\D/g, "");

    if (telefonoLimpio.length < 7 || telefonoLimpio.length > 15) {
      setError(
        "Escribe un número de celular válido, entre 7 y 15 dígitos."
      );
      return;
    }

    if (!datos.aceptaDatos) {
      setError(
        "Debes aceptar el uso de tus datos para gestionar esta solicitud."
      );
      return;
    }

    setPaso(3);
  }

  async function enviarPedido() {
    if (envioEnCursoRef.current) return;

    envioEnCursoRef.current = true;
    setError("");
    setEnviando(true);

    try {
      const resultado = await registrarPedido({
        items: itemsConRecarga,
        telefono: datos.telefono,
        nombreCliente: datos.nombre,
      });

      setPedidoRegistrado(resultado.pedido);
      setReutilizado(resultado.reutilizado);
      setPaso(4);

      onPedidoRegistrado?.({
        pedido: resultado.pedido,
        reutilizado: resultado.reutilizado,
        itemsEnviados: items,
        origen: contexto?.origen,
      });
    } catch (errorPedido) {
      setError(mensajeErrorPedido(errorPedido));
      setPaso(3);
    } finally {
      envioEnCursoRef.current = false;
      setEnviando(false);
    }
  }

  function retroceder() {
    if (enviando) return;

    if (paso === 0) {
      onVolver();
      return;
    }

    setError("");
    setPaso(paso - 1);
  }

  function cerrar() {
    if (!enviando) onCerrar();
  }

  return (
    <div
      className="myc-chat-fondo"
      onMouseDown={(event) => {
        if (
          !enviando &&
          event.target === event.currentTarget
        ) {
          onCerrar();
        }
      }}
    >
      <section
        className="myc-chat-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="myc-chat-titulo"
        aria-busy={enviando}
      >
        <header className="myc-chat-encabezado">
          <div className="myc-chat-avatar">
            <IconoChat />
          </div>

          <div>
            <h2 id="myc-chat-titulo">Asistente MYC</h2>
            <p>
              <span />{" "}
              {paso === 4
                ? "Pedido registrado"
                : enviando
                  ? "Registrando pedido..."
                  : "Preparando tu solicitud"}
            </p>
          </div>

          <button
            type="button"
            className="myc-chat-cerrar"
            onClick={cerrar}
            disabled={enviando}
            aria-label="Cerrar chatbot"
          >
            ×
          </button>
        </header>

        <div className="myc-chat-mensajes">
          {paso === 0 && (
            <>
              <div className="myc-chat-burbuja myc-chat-burbuja-bot">
                ¡Hola! Bienvenido a MYC Perfumes. Ya tengo los productos
                que elegiste. Revisa que todo esté correcto y luego te pediré
                tus datos de contacto.
              </div>

              <div className="myc-chat-contexto">
                <div className="myc-chat-contexto-titulo">
                  <strong>
                    {contexto?.origen === "seleccion"
                      ? "Tu colección"
                      : "Producto elegido"}
                  </strong>
                  <span>{unidades} unidad(es)</span>
                </div>

                {itemsConRecarga.map((item) => (
                  <article
                    className="myc-chat-producto"
                    key={item.lineKey || `${item.productId}-${item.mililitros}`}
                  >
                    <div className="myc-chat-producto-foto">
                      <ImagenProducto
                        src={item.imagen}
                        alt={`Fotografía de ${item.nombre}`}
                      />
                    </div>

                    <div className="myc-chat-producto-datos">
                      <strong>{item.nombre}</strong>
                      <small>
                        {[
                          item.tipo,
                          item.mililitros || item.presentacion,
                          textoRecarga(item),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                      <small>Cantidad: {item.cantidad}</small>
                    </div>

                    <strong className="myc-chat-producto-precio">
                      {item.precioUnitario > 0
                        ? dinero(item.precioUnitario * item.cantidad)
                        : "Por confirmar"}
                    </strong>
                  </article>
                ))}

                <div className="myc-chat-total">
                  <span>Total estimado</span>
                  <strong>{dinero(total)}</strong>
                </div>

                {hayPreciosPendientes && (
                  <p className="myc-chat-aviso">
                    Algunos precios aún deben confirmarse con el administrador.
                  </p>
                )}
              </div>

              <div className="myc-chat-burbuja myc-chat-burbuja-bot">
                ¿Continuamos con la recarga de tus productos?
              </div>

              <button
                type="button"
                className="myc-chat-boton-paso"
                onClick={() => setPaso(1)}
              >
                Elegir recarga <Flecha />
              </button>
            </>
          )}

          {paso === 1 && (
            <>
              <div className="myc-chat-burbuja myc-chat-burbuja-bot">
                Elige si deseas una recarga para cada producto. El 40 %
                significa sin recarga. Los precios de las recargas 60 %, 70 %
                y 80 % se confirman con el administrador.
              </div>

              <div className="myc-chat-recargas">
                {items.map((item, indice) => {
                  const clave = claveLineaChat(item, indice);
                  const seleccion = recargas[clave] || "";
                  const precioBase = Number(
                    item.precioBase ??
                      (Number(item.concentracion || 40) === 40
                        ? item.precioUnitario
                        : 0)
                  ) || 0;

                  return (
                    <section
                      className="myc-chat-recarga-linea"
                      key={clave}
                    >
                      <header>
                        <strong>{item.nombre}</strong>
                        <small>
                          {item.mililitros || item.presentacion}
                          {" · "}
                          cantidad {item.cantidad}
                        </small>
                        {contexto?.origen === "seleccion" && (
                          <small>
                            En tu selección: {textoRecarga(item)}
                          </small>
                        )}
                      </header>

                      <div
                        className="myc-chat-recarga-opciones"
                        role="radiogroup"
                        aria-label={`Recarga para ${item.nombre}`}
                      >
                        {["40", "60", "70", "80"].map((porcentaje) => {
                          const esBase = porcentaje === "40";

                          return (
                            <label
                              className={`myc-chat-recarga-opcion${
                                seleccion === porcentaje
                                  ? " seleccionada"
                                  : ""
                              }`}
                              key={porcentaje}
                            >
                              <input
                                type="radio"
                                name={`recarga-${clave}`}
                                value={porcentaje}
                                checked={seleccion === porcentaje}
                                onChange={() =>
                                  actualizarRecarga(clave, porcentaje)
                                }
                              />
                              <span>
                                <strong>
                                  {esBase
                                    ? "Sin recarga (40 %)"
                                    : `Recarga ${porcentaje} %`}
                                </strong>
                                <small>
                                  {esBase
                                    ? precioBase > 0
                                      ? dinero(precioBase)
                                      : "Precio por confirmar"
                                    : "Precio por confirmar"}
                                </small>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>

              {faltanRecargas && (
                <p className="myc-chat-aviso">
                  Elige una opción para cada producto antes de continuar.
                </p>
              )}

              {hayRecargasDuplicadas && (
                <p className="myc-chat-error" role="alert">
                  No puedes elegir el mismo porcentaje para dos líneas del
                  mismo producto.
                </p>
              )}

              {error && (
                <p className="myc-chat-error" role="alert">{error}</p>
              )}

              <button
                type="button"
                className="myc-chat-boton-paso"
                onClick={continuarDesdeRecargas}
                disabled={faltanRecargas || hayRecargasDuplicadas}
              >
                Continuar <Flecha />
              </button>
            </>
          )}

          {paso === 2 && (
            <>
              <div className="myc-chat-burbuja myc-chat-burbuja-bot">
                Perfecto. Para registrar el pedido necesito tu nombre y tu
                número de celular de contacto.
              </div>

              <form
                className="myc-chat-formulario"
                onSubmit={validarDatos}
                aria-busy={enviando}
              >
                <label>
                  Nombre completo *
                  <input
                    type="text"
                    autoComplete="name"
                    maxLength={100}
                    value={datos.nombre}
                    onChange={(e) => actualizarDato("nombre", e.target.value)}
                    placeholder="Ej. Laura Méndez"
                    required
                  />
                </label>

                <label>
                  Celular de contacto *
                  <input
                    type="tel"
                    autoComplete="tel"
                    maxLength={20}
                    value={datos.telefono}
                    onChange={(e) =>
                      actualizarDato("telefono", e.target.value)
                    }
                    placeholder="Ej. 300 123 4567"
                    required
                  />
                </label>

                <label className="myc-chat-consentimiento">
                  <input
                    type="checkbox"
                    checked={datos.aceptaDatos}
                    onChange={(e) =>
                      actualizarDato("aceptaDatos", e.target.checked)
                    }
                  />
                  <span>
                    Autorizo el uso de estos datos para gestionar esta solicitud.
                  </span>
                </label>

                {error && (
                  <p className="myc-chat-error" role="alert">{error}</p>
                )}

                <button
                  type="submit"
                  className="myc-chat-boton-paso"
                  disabled={enviando}
                >
                  Revisar pedido <Flecha />
                </button>
              </form>
            </>
          )}

          {paso === 3 && (
            <>
              <div className="myc-chat-burbuja myc-chat-burbuja-bot">
                Gracias, {datos.nombre}. Revisa el resumen antes de continuar.
              </div>

              <div className="myc-chat-revision">
                <h3>Datos de contacto</h3>
                <p><strong>Nombre:</strong> {datos.nombre}</p>
                <p><strong>Celular:</strong> {datos.telefono}</p>
                <p><strong>Autorización de datos:</strong> Aceptada</p>

                <hr />

                <h3>Productos</h3>
                {itemsConRecarga.map((item) => (
                  <p key={item.lineKey || `${item.productId}-${item.mililitros}`}>
                    {item.nombre} · {item.mililitros || item.presentacion} ·{" "}
                    {textoRecarga(item)} · cantidad {item.cantidad}
                  </p>
                ))}

                <div className="myc-chat-total">
                  <span>Total estimado</span>
                  <strong>{dinero(total)}</strong>
                </div>

                {hayPreciosPendientes && (
                  <p className="myc-chat-aviso">
                    El total es provisional porque hay recargas pendientes de precio.
                  </p>
                )}
              </div>

              <div className="myc-chat-burbuja myc-chat-burbuja-bot">
                Al confirmar, el pedido se registrará en MYC y quedará
                pendiente de revisión administrativa. No se considera
                confirmado hasta que el administrador lo gestione.
              </div>

              {error && <p className="myc-chat-error" role="alert">{error}</p>}

              <div className="myc-chat-botones-fila">
                <button
                  type="button"
                  className="myc-chat-volver"
                  onClick={() => {
                    if (!enviando) {
                      setError("");
                      setPaso(2);
                    }
                  }}
                  disabled={enviando}
                >
                  Editar datos
                </button>

                <button
                  type="button"
                  className="myc-chat-boton-paso"
                  onClick={enviarPedido}
                  disabled={enviando}
                >
                  {enviando ? "Registrando pedido..." : "Registrar pedido"}{" "}
                  <Flecha />
                </button>
              </div>
            </>
          )}

          {paso === 4 && (
            <div className="myc-chat-final">
              <span aria-hidden="true">✓</span>
              <h3>
                {reutilizado
                  ? "Pedido ya registrado"
                  : "¡Pedido registrado!"}
              </h3>
              <p>
                <strong>Pedido #{pedidoRegistrado?.id}</strong>
              </p>
              <p>
                Estado: {pedidoRegistrado?.estado || "pendiente"}
              </p>
              {reutilizado && (
                <p>
                  Este intento ya había sido registrado anteriormente;
                  no se creó otra compra.
                </p>
              )}
              <p>
                Total{" "}
                {pedidoRegistrado?.precios_completos
                  ? ""
                  : "provisional: "}
                {dinero(Number(pedidoRegistrado?.total) || 0)}
              </p>
              {!pedidoRegistrado?.precios_completos && (
                <p className="myc-chat-aviso">
                  El pedido incluye recargas pendientes de precio. El
                  administrador confirmará el valor antes de gestionarlo.
                </p>
              )}
              <p>
                El pedido queda pendiente de confirmación administrativa.
              </p>
              <button
                type="button"
                className="myc-chat-boton-paso"
                onClick={onCerrar}
              >
                Cerrar <Flecha />
              </button>
            </div>
          )}
        </div>

        {paso !== 4 && (
          <footer className="myc-chat-acciones">
            <button
              type="button"
              className="myc-chat-volver"
              onClick={retroceder}
              disabled={enviando}
            >
              {paso === 0 ? "Volver al catálogo" : "Volver"}
            </button>

            <small>MYC Perfumes · Pedido seguro</small>
          </footer>
        )}
      </section>
    </div>
  );
}

function Inicio({ onVerCatalogo, onAdminLogin }) {
  const [vista, setVista] = useState(obtenerVistaDesdeUrl);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [productoElegido, setProductoElegido] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [publico, setPublico] = useState("Todos");
  const [familia, setFamilia] = useState("");
  const [productos, setProductos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [familias, setFamilias] = useState([]);
  const [cargandoCatalogo, setCargandoCatalogo] = useState(true);
  const [errorCatalogo, setErrorCatalogo] = useState("");
  const [intentoCatalogo, setIntentoCatalogo] = useState(0);
  const [seleccion, setSeleccion] = useState(() => leerSeleccion());
  const [chatAbierto, setChatAbierto] = useState(false);
  const [contextoChat, setContextoChat] = useState({ origen: "producto", items: [] });
  const [aviso, setAviso] = useState("");
  const [heroError, setHeroError] = useState(false);
  const [nosotrosImageError, setNosotrosImageError] = useState(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(CLAVE_SELECCION, JSON.stringify(seleccion));
    } catch {
      setAviso("El navegador no pudo guardar Mi colección.");
    }
  }, [seleccion]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = vista === "inicio" ? "/" : `/#${vista}`;
    window.history.replaceState(null, "", url);
  }, [vista]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    function sincronizarVista() {
      setVista(obtenerVistaDesdeUrl());
      setMenuAbierto(false);
      setProductoElegido(null);
    }

    window.addEventListener("hashchange", sincronizarVista);
    window.addEventListener("popstate", sincronizarVista);

    return () => {
      window.removeEventListener("hashchange", sincronizarVista);
      window.removeEventListener("popstate", sincronizarVista);
    };
  }, []);

  useEffect(() => {
    const controlador = new AbortController();
    let activo = true;

    async function cargarCatalogo() {
      setCargandoCatalogo(true);
      setErrorCatalogo("");

      try {
        const resultados = await Promise.allSettled([
          listarProductos({ signal: controlador.signal }),
          listarCategorias({ signal: controlador.signal }),
          listarFamiliasOlfativas({ signal: controlador.signal }),
        ]);

        if (!activo) return;

        const [
          productosResultado,
          categoriasResultado,
          familiasResultado,
        ] = resultados;

        if (productosResultado.status === "rejected") {
          throw productosResultado.reason;
        }

        const productosNormalizados = (
          productosResultado.value || []
        ).map(normalizarProducto);

        const categoriasApi =
          categoriasResultado.status === "fulfilled"
            ? categoriasResultado.value
                .map((categoria) => String(categoria?.nombre || "").trim())
                .filter(Boolean)
            : [];

        const familiasApi =
          familiasResultado.status === "fulfilled"
            ? familiasResultado.value
                .map((item) => String(item?.nombre || "").trim())
                .filter(Boolean)
            : [];

        setProductos(productosNormalizados);
        setCategorias(
          categoriasApi.length
            ? categoriasApi
            : derivarCategorias(productosNormalizados)
        );
        setFamilias(
          familiasApi.length
            ? familiasApi
            : derivarFamilias(productosNormalizados)
        );
      } catch (error) {
        if (!activo || error?.isCanceled) return;

        setErrorCatalogo(
          error?.message || "No se pudo cargar el catálogo."
        );
      } finally {
        if (activo) setCargandoCatalogo(false);
      }
    }

    cargarCatalogo();

    return () => {
      activo = false;
      controlador.abort();
    };
  }, [intentoCatalogo]);

  const productosPublicados = useMemo(
    () => productos.filter((producto) => producto.activo !== false),
    [productos]
  );

  const productoHero = productosPublicados[0] || null;
  const heroImagen =
    !heroError && productoHero?.imagen
      ? productoHero.imagen
      : fondoFloral;
  const heroAlt = productoHero
    ? `Fotografía de ${productoHero.nombre}`
    : "Composición floral de MYC Perfumes";
  const nosotrosHeroImagen =
    !nosotrosImageError && productoHero?.imagen
      ? productoHero.imagen
      : fondoFloral;
  const nosotrosHeroAlt = productoHero
    ? `Fotografía de ${productoHero.nombre}`
    : "Composición floral de MYC Perfumes";

  const opcionesPublico = useMemo(
    () => [...new Set(["Todos", ...categorias])],
    [categorias]
  );

  const familiasDisponibles = useMemo(() => {
    if (publico === "Todos") return [];

    const familiasDelBackend = new Set(familias);

    return [
      ...new Set(
        productosPublicados
          .filter((producto) => producto.publico === publico)
          .flatMap((producto) => producto.familiasOlfativas)
          .filter(
            (valor) =>
              valor &&
              valor !== "Sin especificar" &&
              (!familiasDelBackend.size || familiasDelBackend.has(valor))
          )
      ),
    ].sort((a, b) => a.localeCompare(b, "es"));
  }, [productosPublicados, publico, familias]);

  const productosFiltrados = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase("es");

    return productosPublicados.filter((producto) => {
      const coincidePublico =
        publico === "Todos" || producto.publico === publico;

      const coincideFamilia =
        !familia || producto.familiasOlfativas.includes(familia);

      const texto = [
        producto.nombre,
        producto.categoria,
        producto.mililitros,
        producto.publico,
        producto.familiasOlfativas.join(" "),
        producto.descripcion,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("es");

      return coincidePublico && coincideFamilia && texto.includes(termino);
    });
  }, [productosPublicados, busqueda, publico, familia]);

  const cantidadSeleccion = seleccion.reduce(
    (suma, item) => suma + Number(item.cantidad || 0),
    0
  );

  function avisoTemporal(mensaje) {
    setAviso(mensaje);
    window.setTimeout(() => setAviso(""), 2800);
  }

  function volverInicio() {
    setVista("inicio");
    setMenuAbierto(false);
    setProductoElegido(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function abrirCatalogo() {
    setVista("catalogo");
    setMenuAbierto(false);
    setProductoElegido(null);
    setBusqueda("");
    setPublico("Todos");
    setFamilia("");
    window.scrollTo({ top: 0, behavior: "smooth" });
    void onVerCatalogo;
  }

  function abrirNosotros() {
    setVista("nosotros");
    setMenuAbierto(false);
    setProductoElegido(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function lineaProducto(
    producto,
    cantidad = 1,
    concentracion = PORCENTAJE_BASE
  ) {
    const ml = extraerMililitros(producto);
    const presentacion = String(
      ml || producto.presentacion || "sin-presentacion"
    )
      .toLocaleLowerCase("es")
      .trim();
    const concentracionNormalizada = String(
      concentracion || PORCENTAJE_BASE
    );
    const claveBase = `${String(producto.id)}::${presentacion}`;

    return {
      lineKey:
        concentracionNormalizada !== PORCENTAJE_BASE
          ? `${claveBase}::${concentracionNormalizada}`
          : claveBase,
      productId: producto.id,
      nombre: producto.nombre,
      imagen: producto.imagen || "",
      mililitros: ml,
      presentacion: producto.presentacion || "",
      tipo: producto.tipo || "",
      categoria: producto.categoria || "",
      publico: producto.publico || "Sin especificar",
      familiasOlfativas: producto.familiasOlfativas || [],
      familiaAromatica: producto.familiaAromatica || "Sin especificar",
      descripcion: producto.descripcion || "",
      concentracion: concentracionNormalizada,
      precioBase: Number(producto.precio) || 0,
      precioUnitario: precioParaRecarga(
        producto,
        concentracionNormalizada
      ),
      cantidad,
    };
  }

  function anadirSeleccion(producto) {
    if (producto.id == null) {
      avisoTemporal(
        "El producto no tiene un ID del catálogo. No se puede añadir."
      );
      return;
    }

    confirmarAnadirSeleccion(producto, PORCENTAJE_BASE);
  }

  function confirmarAnadirSeleccion(producto, concentracion) {
    const nuevaLinea = lineaProducto(producto, 1, concentracion);
    const yaAgregado = seleccion.some(
      (item) => item.lineKey === nuevaLinea.lineKey
    );

    if (yaAgregado) {
      avisoTemporal(
        `${producto.nombre} ya está en Mi colección. Puedes cambiar la cantidad desde Mi colección.`
      );
      return;
    }

    setSeleccion((actual) => [...actual, nuevaLinea]);
    avisoTemporal(
      `${producto.nombre} se añadió a Mi colección.`
    );
  }

  function cambiarCantidad(lineKey, cantidad) {
    if (!Number.isInteger(cantidad) || cantidad < 1) return;

    setSeleccion((actual) =>
      actual.map((item) =>
        item.lineKey === lineKey ? { ...item, cantidad } : item
      )
    );
  }

  function eliminarSeleccion(lineKey) {
    setSeleccion((actual) =>
      actual.filter((item) => item.lineKey !== lineKey)
    );
  }

  function vaciarSeleccion() {
    setSeleccion([]);
    avisoTemporal("Mi colección quedó vacía.");
  }

  function comprarProducto(producto) {
    if (producto.id == null) {
      avisoTemporal(
        "Este producto no tiene un ID del catálogo. No podemos preparar su contexto de compra todavía."
      );
      return;
    }

    setContextoChat({
      origen: "producto",
      items: [lineaProducto(producto, 1, PORCENTAJE_BASE)],
    });
    setProductoElegido(null);
    setChatAbierto(true);
  }

  function comprarSeleccion() {
    if (!seleccion.length) {
      avisoTemporal("Añade primero al menos un producto a Mi colección.");
      return;
    }

    setContextoChat({
      origen: "seleccion",
      items: seleccion.map((item) => {
        const producto = productos.find(
          (actual) => String(actual.id) === String(item.productId)
        );
        const precioBase = Number(
          producto?.precio ??
            item.precioBase ??
            (Number(item.concentracion || 40) === 40
              ? item.precioUnitario
              : 0)
        ) || 0;

        return {
          ...item,
          precioBase,
        };
      }),
    });
    setChatAbierto(true);
  }

  function manejarPedidoRegistrado({
    origen,
    itemsEnviados,
  }) {
    if (origen !== "seleccion") return;

    setSeleccion((actual) =>
      eliminarSeleccionEnviada(actual, itemsEnviados)
    );
  }

  function irASeleccion() {
    setVista("seleccion");
    setMenuAbierto(false);
    setProductoElegido(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function volverDesdeChat() {
    setChatAbierto(false);
    setVista("catalogo");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main
      className={`inicio${vista === "inicio" ? " inicio-home" : ""}${
        vista === "catalogo" ? " inicio-catalogo" : ""
      }${vista === "seleccion" ? " inicio-seleccion" : ""}`}
      id="inicio-myc"
    >
      <header className="inicio-header">
        <div className="inicio-header-interior">
          <button
            className="inicio-marca"
            type="button"
            onClick={() => onAdminLogin?.()}
            aria-label="Abrir administración de MYC Perfumes"
          >
            <img src={logoMYC} alt="Logo MYC Perfumes" />
            <span className="inicio-marca-separador" />
            <span className="inicio-marca-texto">
              <strong>Perfumes MYC</strong>
              <small>Tu aroma, tu esencia</small>
            </span>
          </button>

          <button
            className="inicio-menu-movil"
            type="button"
            aria-label={menuAbierto ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={menuAbierto}
            onClick={() => setMenuAbierto(!menuAbierto)}
          >
            <span /><span /><span />
          </button>

          <nav
            className={`inicio-nav ${menuAbierto ? "inicio-nav-abierto" : ""}`}
            aria-label="Navegación principal"
          >
            <button
              type="button"
              className={`inicio-nav-link ${vista === "inicio" ? "inicio-nav-link-activo" : ""}`}
              onClick={volverInicio}
            >
              Inicio
            </button>

            <button
              type="button"
              className={`inicio-nav-link ${vista === "catalogo" ? "inicio-nav-link-activo" : ""}`}
              onClick={abrirCatalogo}
            >
              Catálogo
            </button>

            <button
              type="button"
              className={`inicio-nav-link ${vista === "nosotros" ? "inicio-nav-link-activo" : ""}`}
              onClick={abrirNosotros}
            >
              Nosotros
            </button>

            <button
              type="button"
              className={`inicio-nav-seleccion ${vista === "seleccion" ? "activo" : ""}`}
              onClick={irASeleccion}
            >
              <Bolsa />
              <span>Mi colección</span>
              {cantidadSeleccion > 0 && <b>{cantidadSeleccion}</b>}
            </button>
          </nav>
        </div>
      </header>

      {vista === "catalogo" ? (
        <div className="inicio-contenido inicio-catalogo-vista">
          <section className="inicio-catalogo-encabezado">
            <p className="inicio-mini-titulo"><span /> ENCUENTRA TU ESENCIA</p>
            <h1>Explora nuestro <em>catálogo</em></h1>
            <p className="inicio-catalogo-intro">
              Descubre productos para regalar, cuidar tu rutina y encontrar tu próxima esencia.
            </p>

            <label className="inicio-busqueda">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                placeholder="Buscar producto, categoría o familia..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                aria-label="Buscar productos"
              />
              {busqueda && (
                <button type="button" onClick={() => setBusqueda("")} aria-label="Limpiar búsqueda">
                  ×
                </button>
              )}
            </label>

            <div className="inicio-filtros-bloque">
              <span className="inicio-filtro-titulo">¿Para quién?</span>
              <div className="inicio-filtros">
                {opcionesPublico.map((opcion) => (
                  <button
                    key={opcion}
                    type="button"
                    className={publico === opcion ? "activo" : ""}
                    onClick={() => {
                      setPublico(opcion);
                      setFamilia("");
                    }}
                    aria-pressed={publico === opcion}
                  >
                    {opcion}
                  </button>
                ))}
              </div>
            </div>

            {publico !== "Todos" && familiasDisponibles.length > 0 && (
              <div className="inicio-filtros-bloque inicio-familia-bloque">
                <span className="inicio-filtro-titulo">Explora por aroma</span>
                <div className="inicio-filtros inicio-filtros-familia">
                  <button
                    type="button"
                    className={!familia ? "activo" : ""}
                    onClick={() => setFamilia("")}
                  >
                    Todas
                  </button>

                  {familiasDisponibles.map((opcion) => (
                    <button
                      key={opcion}
                      type="button"
                      className={familia === opcion ? "activo" : ""}
                      onClick={() => setFamilia((actual) => actual === opcion ? "" : opcion)}
                    >
                      {opcion}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="inicio-catalogo-resultados">
            <div className="inicio-catalogo-contador">
              {cargandoCatalogo ? (
                "Cargando productos..."
              ) : errorCatalogo ? (
                "Catálogo no disponible"
              ) : (
                <>
                  <strong>{productosFiltrados.length}</strong> productos para descubrir
                </>
              )}
            </div>

            {cargandoCatalogo ? (
              <div className="inicio-sin-resultados inicio-catalogo-estado">
                <span className="inicio-catalogo-spinner" aria-hidden="true" />
                <h2>Cargando catálogo...</h2>
                <p>Estamos consultando los productos disponibles.</p>
              </div>
            ) : errorCatalogo ? (
              <div className="inicio-sin-resultados inicio-catalogo-estado">
                <span aria-hidden="true">!</span>
                <h2>No pudimos cargar el catálogo</h2>
                <p>{errorCatalogo}</p>
                <button
                  type="button"
                  className="inicio-boton-principal inicio-reintentar"
                  onClick={() => setIntentoCatalogo((valor) => valor + 1)}
                >
                  Reintentar <Flecha />
                </button>
              </div>
            ) : productosFiltrados.length > 0 ? (
              <div className="inicio-productos-grid inicio-catalogo-grid">
                {productosFiltrados.map((producto) => (
                  <ProductCard
                    key={producto.id ?? `${producto.nombre}-${producto.mililitros}`}
                    producto={producto}
                    agregado={seleccion.some((item) => String(item.productId) === String(producto.id))}
                    onDetalles={setProductoElegido}
                    onAnadir={anadirSeleccion}
                    onComprar={comprarProducto}
                  />
                ))}
              </div>
            ) : (
              <div className="inicio-sin-resultados">
                <span>✳</span>
                <h2>
                  {productosPublicados.length
                    ? "No encontramos ese producto"
                    : "Estamos preparando el catálogo"}
                </h2>
                <p>
                  {productosPublicados.length
                    ? "Prueba con otro nombre, público o familia aromática."
                    : "Los productos aparecerán aquí cuando estén registrados en el catálogo."}
                </p>
              </div>
            )}
          </section>
        </div>
      ) : vista === "seleccion" ? (
        <MiSeleccion
          items={seleccion}
          onCambiarCantidad={cambiarCantidad}
          onEliminar={eliminarSeleccion}
          onVaciar={vaciarSeleccion}
          onComprar={comprarSeleccion}
          onVolverCatalogo={abrirCatalogo}
        />
      ) : vista === "nosotros" ? (
        <div className="inicio-contenido inicio-nosotros-vista">
          <section className="nosotros-editorial-hero">
            <div className="nosotros-editorial-imagen">
              <img
                src={nosotrosHeroImagen}
                alt={nosotrosHeroAlt}
                loading="eager"
                onError={() => setNosotrosImageError(true)}
              />
              <div className="nosotros-editorial-sello">
                <span>MYC</span><small>EAU DE ESTILO</small>
              </div>
            </div>

            <div className="nosotros-editorial-texto">
              <RamaBotanica className="nosotros-rama nosotros-rama-superior" />
              <RamaBotanica className="nosotros-rama nosotros-rama-inferior" />
              <p className="nosotros-etiqueta"><span /> NUESTRA ESENCIA</p>
              <h1>El perfume no solo se lleva, <em>se convierte en parte de ti.</em></h1>
              <p className="nosotros-editorial-descripcion">
                En MYC Perfumes creemos que una fragancia puede acompañar recuerdos,
                expresar personalidad y darle un toque especial a los momentos cotidianos.
              </p>
              <blockquote className="nosotros-cita">
                <span aria-hidden="true">“</span>
                <p>Tu aroma también cuenta tu historia. Encuentra uno que se sienta tan único como tú.</p>
              </blockquote>
              <button type="button" className="inicio-boton-principal nosotros-boton" onClick={abrirCatalogo}>
                Descubre nuestras fragancias <Flecha />
              </button>
            </div>
          </section>

          <section className="nosotros-filosofia">
            <div className="nosotros-filosofia-encabezado">
              <p className="nosotros-etiqueta nosotros-etiqueta-verde"><span /> LO QUE NOS MUEVE</p>
              <h2>Una fragancia dice mucho <em>sin palabras.</em></h2>
              <p>Queremos que elegir tu próximo aroma sea una experiencia sencilla, cercana y hecha a tu manera.</p>
            </div>

            <div className="nosotros-valores">
              <article><span className="nosotros-valor-icono">✳</span><h3>Identidad propia</h3><p>Aromas que conectan con tus gustos, tu estilo y la forma en que quieres expresarte.</p></article>
              <article><span className="nosotros-valor-icono">◇</span><h3>Una elección cercana</h3><p>Un catálogo pensado para explorar opciones con claridad y encontrar tu próxima esencia.</p></article>
              <article><span className="nosotros-valor-icono">❋</span><h3>Momentos que permanecen</h3><p>Fragancias para acompañarte en ocasiones especiales y también en los días de siempre.</p></article>
            </div>
          </section>

          <section className="nosotros-cierre">
            <div><p>EL SIGUIENTE AROMA PUEDE SER EL TUYO</p><h2>Encuentra una esencia <em>que sabe de ti.</em></h2></div>
            <button type="button" className="nosotros-cierre-boton" onClick={abrirCatalogo}>Catálogo Explorador <Flecha /></button>
          </section>
        </div>
      ) : (
        <div className="inicio-contenido inicio-home-contenido">
          <section className="inicio-hero">
            <div className="inicio-hero-texto">
              <p className="inicio-mini-titulo"><span /> BIENVENIDO A MYC PERFUMES</p>
              <h1>El aroma correcto habla <em>sin decir una palabra</em>.</h1>
              <p className="inicio-hero-descripcion">
                Explora una selección de fragancias y encuentra la que mejor
                acompaña tu personalidad.
              </p>
              <button className="inicio-boton-principal" type="button" onClick={abrirCatalogo}>
                Explorar catálogo <Flecha />
              </button>
            </div>

            <div className="inicio-hero-foto">
              <img
                src={heroImagen}
                alt={heroAlt}
                loading="eager"
                onError={() => setHeroError(true)}
              />
              <div className="inicio-hero-foto-sello"><span>MYC</span><small>PERFUMES</small></div>
            </div>

            <div className="inicio-beneficios">
              <div>
                <span className="inicio-beneficio-icono"><IconoHoja /></span>
                <span>Fragancias para distintos estilos</span>
              </div>
              <i>·</i>
              <div>
                <span className="inicio-beneficio-icono"><IconoDiamante /></span>
                <span>Opciones para regalar</span>
              </div>
              <i>·</i>
              <div>
                <span className="inicio-beneficio-icono"><Corazon /></span>
                <span>Aromas para cada ocasión</span>
              </div>
            </div>
          </section>

          <section className="inicio-productos inicio-mas-vendidos">
            <div className="inicio-productos-encabezado">
              <div>
                <p className="inicio-mini-titulo"><span /> NUESTROS FAVORITOS</p>
                <h2>Más vendidos</h2>
              </div>
              <button type="button" className="inicio-enlace" onClick={abrirCatalogo}>
                Ver todos <Flecha />
              </button>
            </div>

            {cargandoCatalogo ? (
              <p className="inicio-productos-vacio">
                Cargando productos...
              </p>
            ) : errorCatalogo ? (
              <div className="inicio-productos-vacio">
                <p>No pudimos cargar los productos destacados.</p>
                <button
                  type="button"
                  className="inicio-enlace"
                  onClick={() => setIntentoCatalogo((valor) => valor + 1)}
                >
                  Reintentar <Flecha />
                </button>
              </div>
            ) : (
              <div className="inicio-productos-grid inicio-destacados-grid">
                {productosPublicados.slice(0, 3).map((producto) => (
                  <ProductCard
                    key={producto.id ?? producto.nombre}
                    producto={producto}
                    agregado={seleccion.some((item) => String(item.productId) === String(producto.id))}
                    onDetalles={setProductoElegido}
                    onAnadir={anadirSeleccion}
                    onComprar={comprarProducto}
                    variante="destacado"
                  />
                ))}
              </div>
            )}

            {!cargandoCatalogo &&
              !errorCatalogo &&
              productosPublicados.length === 0 && (
                <p className="inicio-productos-vacio">
                  Los productos aparecerán aquí cuando estén registrados en el catálogo.
                </p>
              )}
          </section>

          <section className="inicio-presentacion">
            <p className="inicio-mini-titulo"><span /> NUESTRA ESENCIA</p>
            <h2>Una fragancia, <em>una historia, tu esencia.</em></h2>
            <p>
              En MYC Perfumes creemos que una fragancia puede acompañar
              recuerdos, expresar personalidad y darle un toque especial a los
              momentos cotidianos.
            </p>
            <button type="button" className="inicio-enlace" onClick={abrirNosotros}>
              Conoce más sobre nosotros <Flecha />
            </button>
          </section>
        </div>
      )}

      <footer className="inicio-footer">
        <div className="inicio-footer-marca">
          <img src={logoMYC} alt="" />
          <span><strong>MYC Perfumes</strong><small>Tu aroma, tu esencia</small></span>
        </div>
        <p>Una fragancia, una historia, tu esencia.</p>
        <button type="button" onClick={volverInicio}>Volver al inicio ↑</button>
      </footer>

      {aviso && (
        <div className="inicio-aviso" role="status">
          {aviso}
          <button type="button" onClick={() => setAviso("")} aria-label="Cerrar aviso">×</button>
        </div>
      )}

      {productoElegido && (
        <div
          className="inicio-modal-fondo"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setProductoElegido(null);
          }}
        >
          <section className="inicio-modal" role="dialog" aria-modal="true" aria-labelledby="inicio-modal-titulo">
            <button className="inicio-modal-cerrar" type="button" onClick={() => setProductoElegido(null)} aria-label="Cerrar detalles">×</button>

            <div className="inicio-modal-imagen">
              <ImagenProducto src={productoElegido.imagen} alt={`Fotografía de ${productoElegido.nombre}`} />
            </div>

            <div className="inicio-modal-contenido">
              <p className="inicio-mini-titulo">DETALLES DEL PRODUCTO</p>
              <h2 id="inicio-modal-titulo">{productoElegido.nombre}</h2>
              <p className="inicio-modal-subtitulo">
                {[productoElegido.tipo, productoElegido.mililitros || productoElegido.presentacion].filter(Boolean).join(" · ")}
              </p>
              <p className="inicio-modal-precio">
                {productoElegido.precio > 0 ? dinero(productoElegido.precio) : "Precio por confirmar"}
              </p>
              <span className="inicio-modal-categoria">
                {productoElegido.publico !== "Sin especificar" ? productoElegido.publico : productoElegido.categoria}
                {productoElegido.familiasOlfativas?.length
                  ? ` · ${productoElegido.familiasOlfativas.join(" · ")}`
                  : ""}
              </span>

              <div className="inicio-modal-perfil">
                <small>DESCRIPCIÓN / PERFIL AROMÁTICO</small>
                <strong>{productoElegido.descripcion || "Descripción por confirmar."}</strong>
              </div>

              <p className="inicio-modal-nota">
                Entrega estimada: {productoElegido.tiempoEntrega}. Las condiciones finales se confirmarán al preparar el pedido.
              </p>

              <div className="inicio-modal-acciones">
                <button type="button" className="inicio-producto-accion inicio-producto-anadir" onClick={() => { anadirSeleccion(productoElegido); setProductoElegido(null); }}>
                  <span>＋</span> Añadir
                </button>
                <button type="button" className="inicio-producto-accion inicio-producto-comprar" onClick={() => comprarProducto(productoElegido)}>
                  Comprar <Flecha />
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      <ChatbotCompra
        abierto={chatAbierto}
        contexto={contextoChat}
        onCerrar={() => setChatAbierto(false)}
        onVolver={volverDesdeChat}
        onPedidoRegistrado={manejarPedidoRegistrado}
      />
    </main>
  );
}

export default Inicio;

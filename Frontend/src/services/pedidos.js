import { api } from "./api.js";

export const CLAVE_INTENTO_COMPRA = "myc_pedido_intento_v1";

const MAX_LINEAS = 20;
const MAX_CANTIDAD_POR_LINEA = 100;
const PORCENTAJES_VALIDOS = new Set([40, 60, 70, 80]);

let intentoEnMemoria = null;

function obtenerSessionStorage() {
  if (typeof window === "undefined") return null;

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function normalizarTelefono(valor) {
  return String(valor ?? "").replace(/\D/g, "");
}

function normalizarPorcentaje(valor) {
  const porcentaje = Number(valor || 40);

  if (!PORCENTAJES_VALIDOS.has(porcentaje)) {
    throw new Error("El porcentaje de recarga no es válido.");
  }

  return porcentaje;
}

export function construirLineasPedido(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("La selección está vacía.");
  }

  if (items.length > MAX_LINEAS) {
    throw new Error(
      `El pedido admite como máximo ${MAX_LINEAS} líneas.`
    );
  }

  const lineas = items.map((item) => {
    const productoId = Number(item?.productId);
    const cantidad = Number(item?.cantidad);
    const porcentaje = normalizarPorcentaje(item?.concentracion);

    if (!Number.isInteger(productoId) || productoId <= 0) {
      throw new Error(
        "Hay un producto sin un identificador válido de Django."
      );
    }

    if (
      !Number.isInteger(cantidad) ||
      cantidad < 1 ||
      cantidad > MAX_CANTIDAD_POR_LINEA
    ) {
      throw new Error(
        `La cantidad debe ser un entero entre 1 y ${MAX_CANTIDAD_POR_LINEA}.`
      );
    }

    return {
      producto_id: productoId,
      cantidad,
      recarga_solicitada: porcentaje !== 40,
      porcentaje,
    };
  });

  const claves = new Set();

  for (const linea of lineas) {
    const clave = `${linea.producto_id}:${linea.porcentaje}`;

    if (claves.has(clave)) {
      throw new Error(
        "No se puede repetir el mismo producto con el mismo porcentaje."
      );
    }

    claves.add(clave);
  }

  return lineas;
}

export function construirPayloadPedido({
  items,
  telefono,
  nombreCliente,
}) {
  const lineas = construirLineasPedido(items);
  const telefonoNormalizado = normalizarTelefono(telefono);
  const nombre = String(nombreCliente || "").trim();

  if (
    telefonoNormalizado.length < 7 ||
    telefonoNormalizado.length > 15
  ) {
    throw new Error(
      "El teléfono debe contener entre 7 y 15 dígitos."
    );
  }

  if (!nombre) {
    throw new Error("El nombre del cliente es obligatorio.");
  }

  return {
    telefono: telefonoNormalizado,
    nombre_cliente: nombre,
    lineas,
  };
}

export function claveLineaChat(item, indice = 0) {
  return (
    item?.lineKey ||
    `${item?.productId ?? "producto"}-${indice}`
  );
}

export function aplicarRecargas(items, recargas = {}) {
  return (items || []).map((item, indice) => {
    const clave = claveLineaChat(item, indice);
    const seleccion = recargas[clave];
    const porcentaje = seleccion || item.concentracion || "40";
    const precioBase = Number(
      item.precioBase ??
        (Number(item.concentracion || 40) === 40
          ? item.precioUnitario
          : 0)
    ) || 0;

    return {
      ...item,
      lineKey: item.lineKey || clave,
      concentracion: String(porcentaje),
      precioUnitario: Number(porcentaje) === 40 ? precioBase : 0,
    };
  });
}

export function crearHuellaPayload(payload) {
  const lineas = [...payload.lineas]
    .map((linea) => ({
      producto_id: Number(linea.producto_id),
      cantidad: Number(linea.cantidad),
      recarga_solicitada: Boolean(linea.recarga_solicitada),
      porcentaje: Number(linea.porcentaje),
    }))
    .sort((a, b) => (
      a.producto_id - b.producto_id ||
      a.porcentaje - b.porcentaje ||
      a.cantidad - b.cantidad
    ));

  const contenido = JSON.stringify({
    telefono: normalizarTelefono(payload.telefono),
    nombre_cliente: String(payload.nombre_cliente || "").trim(),
    lineas,
  });

  let hash = 2166136261;

  for (let indice = 0; indice < contenido.length; indice += 1) {
    hash ^= contenido.charCodeAt(indice);
    hash = Math.imul(hash, 16777619);
  }

  return `${(hash >>> 0).toString(16)}-${contenido.length.toString(16)}`;
}

export function generarClaveIdempotencia() {
  const cryptoObj =
    typeof globalThis !== "undefined" ? globalThis.crypto : null;

  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }

  const aleatorio = () =>
    Math.random().toString(36).slice(2, 10);

  return `myc-${Date.now().toString(36)}-${aleatorio()}-${aleatorio()}`;
}

export function leerIntentoCompra() {
  const almacenamiento = obtenerSessionStorage();

  if (almacenamiento) {
    try {
      const guardado = almacenamiento.getItem(CLAVE_INTENTO_COMPRA);

      if (guardado) {
        const intento = JSON.parse(guardado);

        if (intento?.clave && intento?.huella) {
          return intento;
        }
      }
    } catch {
      // Se utiliza el respaldo en memoria.
    }
  }

  return intentoEnMemoria;
}

function guardarIntentoCompra(intento) {
  intentoEnMemoria = intento;

  const almacenamiento = obtenerSessionStorage();

  if (!almacenamiento) return;

  try {
    almacenamiento.setItem(
      CLAVE_INTENTO_COMPRA,
      JSON.stringify(intento)
    );
  } catch {
    // La clave se conserva en memoria durante esta pestaña.
  }
}

export function limpiarIntentoCompra() {
  intentoEnMemoria = null;

  const almacenamiento = obtenerSessionStorage();

  if (!almacenamiento) return;

  try {
    almacenamiento.removeItem(CLAVE_INTENTO_COMPRA);
  } catch {
    // No hay nada más que limpiar.
  }
}

export function obtenerClaveIntento(payload) {
  const huella = crearHuellaPayload(payload);
  const intento = leerIntentoCompra();

  if (intento?.huella === huella && intento?.clave) {
    return intento.clave;
  }

  const clave = generarClaveIdempotencia();

  guardarIntentoCompra({
    clave,
    huella,
  });

  return clave;
}

export async function registrarPedido({
  items,
  telefono,
  nombreCliente,
}) {
  const payload = construirPayloadPedido({
    items,
    telefono,
    nombreCliente,
  });
  const claveIdempotencia = obtenerClaveIntento(payload);

  const respuesta = await api.post(
    "/pedidos/tienda/",
    payload,
    {
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": claveIdempotencia,
      },
    },
  );

  limpiarIntentoCompra();

  return {
    pedido: respuesta.data,
    status: respuesta.status,
    reutilizado: Boolean(respuesta.data?.reutilizado),
    claveIdempotencia,
    payload,
  };
}

export function mensajeErrorPedido(error) {
  if (error?.status === 400) {
    return (
      error.message ||
      "Revisa los datos del pedido antes de volver a intentarlo."
    );
  }

  if (error?.status === 409) {
    return (
      error.message ||
      "El intento no coincide con la solicitud anterior. Revisa los datos antes de reenviar."
    );
  }

  if (error?.status === 429) {
    return (
      error.message ||
      "Se realizaron demasiados intentos. Espera un momento y vuelve a probar."
    );
  }

  if (
    error?.status === 0 ||
    error?.isNetworkError ||
    (error?.status >= 500 && error.status <= 599)
  ) {
    return (
      "No pudimos confirmar si el pedido se registró. " +
      "Conservamos la clave del intento para que puedas reintentar de forma segura."
    );
  }

  return (
    error?.message ||
    "No se pudo registrar el pedido. Inténtalo de nuevo."
  );
}

export function eliminarSeleccionEnviada(
  seleccionActual,
  itemsEnviados
) {
  if (
    !Array.isArray(seleccionActual) ||
    !Array.isArray(itemsEnviados) ||
    itemsEnviados.length === 0
  ) {
    return seleccionActual;
  }

  const enviados = new Map();

  for (const item of itemsEnviados) {
    if (!item?.lineKey) continue;

    enviados.set(item.lineKey, Number(item.cantidad));
  }

  return seleccionActual.filter((item) => {
    const cantidadEnviada = enviados.get(item.lineKey);

    if (cantidadEnviada === undefined) {
      return true;
    }

    return Number(item.cantidad) !== cantidadEnviada;
  });
}

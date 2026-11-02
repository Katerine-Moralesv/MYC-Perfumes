import { api } from "./api.js";
import {
  TTL_ADMIN,
  invalidarCacheAdmin,
  obtenerConCache,
} from "./adminCache.js";
import {
  esFechaFutura,
  esFechaISO,
} from "./fechas.js";

const ESTADOS_PAGO_VALIDOS = new Set([
  "pendiente",
  "abonado",
  "pagado",
]);

const ESTADOS_OPERATIVOS = new Set([
  "preparando",
  "listo",
  "entregado",
]);

const PATRON_IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,64}$/;

const operacionesEnCurso = new Set();

export class OperacionEnCursoError extends Error {
  constructor() {
    super("Ya hay una operación en curso para este pedido.");
    this.name = "OperacionEnCursoError";
  }
}

function validarPedidoId(valor) {
  const id = Number(valor);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("El identificador del pedido no es válido.");
  }

  return id;
}

function ejecutarOperacionUnica(pedidoId, operacion) {
  const clave = `pedido:${pedidoId}`;

  if (operacionesEnCurso.has(clave)) {
    return Promise.reject(new OperacionEnCursoError());
  }

  operacionesEnCurso.add(clave);

  return Promise.resolve()
    .then(operacion)
    .finally(() => {
      operacionesEnCurso.delete(clave);
    });
}

function extraerLista(datos) {
  if (Array.isArray(datos)) return datos;
  if (Array.isArray(datos?.results)) return datos.results;

  throw new Error("La respuesta de pedidos no tiene el formato esperado.");
}

function validarClaveIdempotencia(valor, obligatoria = false) {
  const clave = String(valor ?? "").trim();

  if (!clave) {
    if (!obligatoria) return "";
    throw new Error("Falta la clave de idempotencia del anticipo.");
  }

  if (!PATRON_IDEMPOTENCIA.test(clave)) {
    throw new Error(
      "La clave de idempotencia debe tener entre 8 y 64 caracteres válidos.",
    );
  }

  return clave;
}

function validarMonto(monto) {
  const texto = String(monto ?? "").trim();
  const valor = Number(texto);

  if (!texto || !Number.isFinite(valor) || valor <= 0) {
    throw new Error("El monto debe ser mayor que cero.");
  }

  return texto;
}

function validarFecha(fecha, nombre = "fecha") {
  const valor = String(fecha ?? "").trim();

  if (!esFechaISO(valor) || esFechaFutura(valor)) {
    throw new Error(`La ${nombre} no es válida o es futura.`);
  }

  return valor;
}

export async function listarPedidos({ signal } = {}) {
  return obtenerConCache(
    "pedidos:lista",
    async () => {
      const respuesta = await api.get("/pedidos/");
      return extraerLista(respuesta.data);
    },
    {
      ttl: TTL_ADMIN.listas,
      signal,
    },
  );
}

export function construirPayloadConfirmacion({
  estadoPago,
  lineasPrecio = [],
  montoRecibido = null,
  fechaPago = null,
  metodoPago = "",
  referencia = "",
}) {
  if (!ESTADOS_PAGO_VALIDOS.has(estadoPago)) {
    throw new Error("El estado de pago no es válido.");
  }

  const lineas = (Array.isArray(lineasPrecio) ? lineasPrecio : []).map(
    (linea) => {
      const detalleId = Number(linea?.detalleId);
      const precioVenta = String(linea?.precioVenta ?? "").trim();
      const precio = Number(precioVenta);

      if (!Number.isInteger(detalleId) || detalleId <= 0) {
        throw new Error("Hay una línea de pedido sin identificador válido.");
      }

      if (!Number.isFinite(precio) || precio <= 0) {
        throw new Error("Todos los precios pendientes deben ser mayores que cero.");
      }

      return {
        detalle_id: detalleId,
        precio_venta: precioVenta,
      };
    },
  );

  const ids = lineas.map((linea) => linea.detalle_id);

  if (new Set(ids).size !== ids.length) {
    throw new Error("No se puede repetir una línea en los precios.");
  }

  const payload = {
    estado_pago: estadoPago,
  };

  if (lineas.length > 0) {
    payload.lineas_precio = lineas;
  }

  if (estadoPago === "abonado") {
    const monto = String(montoRecibido ?? "").trim();
    const valor = Number(monto);

    if (!Number.isFinite(valor) || valor <= 0) {
      throw new Error("Indica el monto recibido para registrar el abono.");
    }

    payload.monto_recibido = monto;
  }

  if (estadoPago !== "pendiente" && fechaPago) {
    payload.fecha_pago = validarFecha(fechaPago, "fecha de pago");
  }

  const metodo = String(metodoPago ?? "").trim();
  const referenciaTexto = String(referencia ?? "").trim();

  if (metodo) payload.metodo_pago = metodo;
  if (referenciaTexto) payload.referencia = referenciaTexto;

  return payload;
}

export async function confirmarPedido(pedidoId, opciones) {
  const id = validarPedidoId(pedidoId);
  const payload = construirPayloadConfirmacion(opciones);

  return ejecutarOperacionUnica(id, async () => {
    const respuesta = await api.post(
      `/pedidos/${id}/confirmar/`,
      payload,
    );

    invalidarCacheAdmin();
    return respuesta.data;
  });
}

export function construirPayloadAnticipo({
  monto,
  fecha,
  metodoPago = "",
  referencia = "",
}) {
  return {
    monto: validarMonto(monto),
    fecha: validarFecha(fecha, "fecha del anticipo"),
    metodo_pago: String(metodoPago ?? "").trim(),
    referencia: String(referencia ?? "").trim(),
  };
}

export async function registrarAnticipo(
  pedidoId,
  {
    monto,
    fecha,
    metodoPago = "",
    referencia = "",
    claveIdempotencia,
  } = {},
) {
  const id = validarPedidoId(pedidoId);
  const clave = validarClaveIdempotencia(
    claveIdempotencia,
    true,
  );
  const payload = construirPayloadAnticipo({
    monto,
    fecha,
    metodoPago,
    referencia,
  });

  return ejecutarOperacionUnica(id, async () => {
    const respuesta = await api.post(
      `/pedidos/${id}/anticipos/`,
      payload,
      {
        headers: { "Idempotency-Key": clave },
      },
    );

    invalidarCacheAdmin();
    return respuesta.data;
  });
}

export async function completarVentaPedido(
  pedidoId,
  { claveIdempotencia = "" } = {},
) {
  const id = validarPedidoId(pedidoId);
  const clave = validarClaveIdempotencia(claveIdempotencia);

  return ejecutarOperacionUnica(id, async () => {
    const respuesta = await api.post(
      `/pedidos/${id}/venta/`,
      {},
      clave
        ? { headers: { "Idempotency-Key": clave } }
        : undefined,
    );

    invalidarCacheAdmin();
    return respuesta.data;
  });
}

export function construirPayloadCancelacion({
  motivo = "",
  montoDevolucion = "",
  fechaDevolucion = "",
  metodoPago = "",
  referencia = "",
}) {
  const payload = {
    motivo: String(motivo ?? "").trim(),
  };
  const monto = String(montoDevolucion ?? "").trim();

  if (monto) {
    payload.monto_devolucion = validarMonto(monto);
  }

  if (fechaDevolucion) {
    payload.fecha_devolucion = validarFecha(
      fechaDevolucion,
      "fecha de devolución",
    );
  }

  const metodo = String(metodoPago ?? "").trim();
  const referenciaTexto = String(referencia ?? "").trim();

  if (metodo) payload.metodo_pago = metodo;
  if (referenciaTexto) payload.referencia = referenciaTexto;

  return payload;
}

export async function cancelarPedido(
  pedidoId,
  {
    motivo = "",
    montoDevolucion = "",
    fechaDevolucion = "",
    metodoPago = "",
    referencia = "",
    claveIdempotencia = "",
  } = {},
) {
  const id = validarPedidoId(pedidoId);
  const clave = validarClaveIdempotencia(claveIdempotencia);
  const payload = construirPayloadCancelacion({
    motivo,
    montoDevolucion,
    fechaDevolucion,
    metodoPago,
    referencia,
  });

  return ejecutarOperacionUnica(id, async () => {
    const respuesta = await api.post(
      `/pedidos/${id}/cancelar/`,
      payload,
      clave
        ? { headers: { "Idempotency-Key": clave } }
        : undefined,
    );

    invalidarCacheAdmin();
    return respuesta.data;
  });
}

export async function cambiarEstadoPedido(pedidoId, estado) {
  const id = validarPedidoId(pedidoId);
  const valor = String(estado ?? "").trim();

  if (!ESTADOS_OPERATIVOS.has(valor)) {
    throw new Error("El estado operativo no es válido.");
  }

  return ejecutarOperacionUnica(id, async () => {
    const respuesta = await api.post(
      `/pedidos/${id}/estado/`,
      { estado: valor },
    );

    invalidarCacheAdmin();
    return respuesta.data;
  });
}

export async function rechazarPedido(pedidoId, motivo = "") {
  const id = validarPedidoId(pedidoId);
  const texto = String(motivo ?? "").trim();

  if (texto.length > 255) {
    throw new Error("El motivo del rechazo admite máximo 255 caracteres.");
  }

  return ejecutarOperacionUnica(id, async () => {
    const respuesta = await api.post(
      `/pedidos/${id}/rechazar/`,
      { motivo: texto },
    );

    invalidarCacheAdmin();
    return respuesta.data;
  });
}

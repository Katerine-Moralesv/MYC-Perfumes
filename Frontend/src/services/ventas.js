import { api } from "./api.js";
import { invalidarCacheAdmin } from "./adminCache.js";
import {
  esFechaFutura,
  esFechaISO,
} from "./fechas.js";
import { crearClaveIdempotencia } from "./idempotencia.js";

const ESTADOS_CREACION = new Set([
  "pendiente",
  "pagado",
  "abonado",
]);
const operacionesEnCurso = new Set();

export class OperacionEnCursoError extends Error {
  constructor() {
    super("Ya hay una venta en proceso de registro.");
    this.name = "OperacionEnCursoError";
  }
}

function validarEnteroPositivo(valor, mensaje) {
  const numero = Number(valor);

  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(mensaje);
  }

  return numero;
}

function validarFecha(valor) {
  const fecha = String(valor ?? "").trim();

  if (!esFechaISO(fecha)) {
    throw new Error("La fecha de la venta no es válida.");
  }

  return fecha;
}

export function construirPayloadVenta({
  clienteId,
  clienteNombre,
  clienteTelefono,
  fecha,
  estadoPago,
  lineas,
  montoInicial,
  fechaPago,
}) {
  let datosCliente;

  if (clienteId) {
    datosCliente = {
      cliente_id: validarEnteroPositivo(
        clienteId,
        "El cliente indicado no es válido.",
      ),
    };
  } else {
    const nombre = String(clienteNombre ?? "").trim();

    if (!nombre) {
      throw new Error(
        "Escribe el nombre del cliente para la venta.",
      );
    }

    if (nombre.length > 150) {
      throw new Error(
        "El nombre del cliente admite máximo 150 caracteres.",
      );
    }

    datosCliente = {
      cliente_nombre: nombre,
      cliente_telefono: String(
        clienteTelefono ?? "",
      ).trim(),
    };
  }

  if (!ESTADOS_CREACION.has(estadoPago)) {
    throw new Error(
      "La creación de la venta admite estado pendiente, pagado o abonado.",
    );
  }

  if (!Array.isArray(lineas) || lineas.length === 0) {
    throw new Error("La venta debe incluir al menos una presentación.");
  }

  const lineasPayload = lineas.map((linea) => {
    const presentacionId = validarEnteroPositivo(
      linea?.presentacionId,
      "Hay una presentación sin identificador válido.",
    );
    const cantidad = validarEnteroPositivo(
      linea?.cantidad,
      "La cantidad debe ser un entero mayor que cero.",
    );
    const precioVenta = String(linea?.precioVenta ?? "").trim();
    const precio = Number(precioVenta);

    if (!Number.isFinite(precio) || precio <= 0) {
      throw new Error(
        "El precio de venta debe ser mayor que cero.",
      );
    }

    return {
      presentacion_id: presentacionId,
      cantidad,
      precio_venta: precioVenta,
    };
  });

  const ids = lineasPayload.map((linea) => linea.presentacion_id);

  if (new Set(ids).size !== ids.length) {
    throw new Error(
      "No se puede repetir una presentación dentro de la venta.",
    );
  }

  const payload = {
    ...datosCliente,
    fecha: validarFecha(fecha),
    estado_pago: estadoPago,
    lineas: lineasPayload,
  };

  if (estadoPago === "pendiente" && montoInicial != null) {
    throw new Error(
      "Una venta pendiente no puede tener pago inicial.",
    );
  }

  if (estadoPago === "abonado") {
    const montoTexto = String(montoInicial ?? "").trim();
    const monto = Number(montoTexto);
    const total = lineasPayload.reduce(
      (acumulado, linea) =>
        acumulado +
        Number(linea.precio_venta) * linea.cantidad,
      0,
    );

    if (!Number.isFinite(monto) || monto <= 0) {
      throw new Error(
        "Indica el monto inicial para registrar la venta abonada.",
      );
    }

    if (monto >= total) {
      throw new Error(
        "El abono inicial debe ser menor que el total. Para un pago completo usa Pagado.",
      );
    }

    payload.monto_inicial = montoTexto;
  }

  if (estadoPago !== "pendiente" && fechaPago) {
    payload.fecha_pago = validarFecha(fechaPago);

    if (esFechaFutura(payload.fecha_pago)) {
      throw new Error(
        "La fecha del pago inicial no puede ser futura.",
      );
    }
  }

  return payload;
}

export async function crearVenta(datos) {
  const payload = construirPayloadVenta(datos);
  const claveOperacion = "venta:manual";
  const claveIdempotencia = String(
    datos?.claveIdempotencia ??
      crearClaveIdempotencia("venta"),
  ).trim();

  if (!claveIdempotencia) {
    throw new Error(
      "No se pudo generar la clave de idempotencia de la venta.",
    );
  }

  if (operacionesEnCurso.has(claveOperacion)) {
    return Promise.reject(new OperacionEnCursoError());
  }

  operacionesEnCurso.add(claveOperacion);

  return Promise.resolve()
    .then(async () => {
      const respuesta = await api.post(
        "/finanzas/ventas/registrar/",
        payload,
        {
          headers: {
            "Idempotency-Key": claveIdempotencia,
          },
        },
      );

      invalidarCacheAdmin();
      return respuesta.data;
    })
    .finally(() => {
      operacionesEnCurso.delete(claveOperacion);
    });
}

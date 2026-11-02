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
import { crearClaveIdempotencia } from "./idempotencia.js";

export { crearClaveIdempotencia };

const operacionesEnCurso = new Set();

export class OperacionEnCursoError extends Error {
  constructor(mensaje = "Ya hay una operación en curso.") {
    super(mensaje);
    this.name = "OperacionEnCursoError";
  }
}

function ejecutarOperacionUnica(clave, operacion) {
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

  throw new Error("La respuesta no tiene el formato esperado.");
}

export function normalizarTelefono(valor) {
  const soloDigitos = String(valor ?? "").replace(/\D/g, "");

  if (!soloDigitos) return "";

  if (
    soloDigitos.length === 10 &&
    soloDigitos.startsWith("3")
  ) {
    return `+57${soloDigitos}`;
  }

  if (
    soloDigitos.startsWith("57") &&
    soloDigitos.length === 12
  ) {
    return `+${soloDigitos}`;
  }

  return soloDigitos;
}

export function buscarClientePorTelefono(clientes, telefono) {
  const normalizado = normalizarTelefono(telefono);

  if (!normalizado) return null;

  return (
    (Array.isArray(clientes) ? clientes : []).find(
      (cliente) =>
        normalizarTelefono(cliente?.telefono) === normalizado,
    ) || null
  );
}

export function construirPayloadCliente({
  nombre,
  telefono = "",
  notas = "",
}) {
  const nombreLimpio = String(nombre ?? "").trim();

  if (!nombreLimpio) {
    throw new Error("El nombre del cliente es obligatorio.");
  }

  if (nombreLimpio.length > 150) {
    throw new Error(
      "El nombre del cliente admite máximo 150 caracteres.",
    );
  }

  const telefonoOriginal = String(telefono ?? "").trim();
  const telefonoNormalizado = normalizarTelefono(
    telefonoOriginal,
  );

  if (telefonoOriginal && !telefonoNormalizado) {
    throw new Error("El teléfono no es válido.");
  }

  if (telefonoNormalizado) {
    const digitos = telefonoNormalizado.replace(/\D/g, "");

    if (digitos.length < 7 || digitos.length > 15) {
      throw new Error(
        "El teléfono debe contener entre 7 y 15 dígitos.",
      );
    }
  }

  return {
    nombre: nombreLimpio,
    telefono: telefonoNormalizado,
    notas: String(notas ?? "").trim(),
  };
}

export async function listarClientes({ signal } = {}) {
  return obtenerConCache(
    "clientes:lista",
    async () => {
      const respuesta = await api.get("/finanzas/clientes/");
      return extraerLista(respuesta.data);
    },
    {
      ttl: TTL_ADMIN.listas,
      signal,
    },
  );
}

export async function crearCliente(datos) {
  const payload = construirPayloadCliente(datos);
  const clave = `cliente:${
    payload.telefono ||
    payload.nombre.toLocaleLowerCase("es")
  }`;

  return ejecutarOperacionUnica(clave, async () => {
    const respuesta = await api.post(
      "/finanzas/clientes/",
      payload,
    );
    invalidarCacheAdmin();

    return respuesta.data;
  });
}

export async function listarVentas({
  signal,
  conPendientes = false,
} = {}) {
  const clave = conPendientes
    ? "ventas:listas:pendientes"
    : "ventas:listas";

  return obtenerConCache(
    clave,
    async () => {
      const respuesta = await api.get("/finanzas/ventas/", {
        params: conPendientes
          ? { con_pendientes: "1" }
          : undefined,
      });

      return extraerLista(respuesta.data);
    },
    {
      ttl: TTL_ADMIN.listas,
      signal,
    },
  );
}

export async function listarResumenClientes({ signal } = {}) {
  return obtenerConCache(
    "clientes:resumen",
    async () => {
      const respuesta = await api.get(
        "/finanzas/clientes/resumen/",
      );

      return extraerLista(respuesta.data);
    },
    {
      ttl: TTL_ADMIN.listas,
      signal,
    },
  );
}

export async function obtenerResumenCliente(clienteId, { signal } = {}) {
  const id = Number(clienteId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("El identificador del cliente no es válido.");
  }

  return obtenerConCache(
    `clientes:resumen:${id}`,
    async () => {
      const respuesta = await api.get(
        `/finanzas/clientes/${id}/resumen/`,
      );

      return respuesta.data;
    },
    {
      ttl: TTL_ADMIN.listas,
      signal,
    },
  );
}

export async function registrarAbono(
  ventaId,
  { monto, fecha, claveIdempotencia },
) {
  const id = Number(ventaId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("El identificador de la venta no es válido.");
  }

  const montoTexto = String(monto ?? "").trim();
  const valor = Number(montoTexto);

  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error("El abono debe ser mayor que cero.");
  }

  const fechaTexto = String(fecha ?? "").trim();

  if (
    !esFechaISO(fechaTexto) ||
    esFechaFutura(fechaTexto)
  ) {
    throw new Error(
      "La fecha del abono no es válida o es futura.",
    );
  }

  const clave = String(
    claveIdempotencia ?? crearClaveIdempotencia(),
  ).trim();

  if (!clave) {
    throw new Error(
      "No se pudo generar la clave de idempotencia del abono.",
    );
  }

  return ejecutarOperacionUnica(`abono:${id}`, async () => {
    const respuesta = await api.post(
      `/finanzas/ventas/${id}/abonos/`,
      {
        monto: montoTexto,
        fecha: fechaTexto,
      },
      {
        headers: {
          "Idempotency-Key": clave,
        },
      },
    );
    invalidarCacheAdmin();

    return respuesta.data;
  });
}

import { api } from "./api.js";
import {
  TTL_ADMIN,
  invalidarCacheAdmin,
  obtenerConCache,
} from "./adminCache.js";
import { crearClaveIdempotencia } from "./idempotencia.js";

function extraerLista(datos) {
  if (Array.isArray(datos)) return datos;
  if (Array.isArray(datos?.results)) return datos.results;
  return [];
}

export async function listarCompras({ signal } = {}) {
  return obtenerConCache(
    "compras:lista",
    async () => {
      const { data } = await api.get("/finanzas/compras/");
      return extraerLista(data);
    },
    {
      ttl: TTL_ADMIN.listas,
      signal,
    },
  );
}

export async function listarProveedores({ signal } = {}) {
  return obtenerConCache(
    "proveedores:lista",
    async () => {
      const { data } = await api.get("/finanzas/proveedores/");
      return extraerLista(data);
    },
    {
      ttl: TTL_ADMIN.catalogo,
      signal,
    },
  );
}

export async function crearProveedor({
  nombre,
  telefono = "",
}) {
  const nombreLimpio = String(nombre || "").trim();

  if (!nombreLimpio) {
    throw new Error("El nombre del proveedor es obligatorio.");
  }

  const { data } = await api.post(
    "/finanzas/proveedores/",
    {
      nombre: nombreLimpio,
      telefono: String(telefono || "").trim(),
    }
  );
  invalidarCacheAdmin();

  return data;
}

export function incorporarProveedor(proveedores, proveedor) {
  const anteriores = proveedores.filter(
    (actual) => actual.id !== proveedor.id,
  );

  return {
    proveedores: [...anteriores, proveedor],
    proveedorId: String(proveedor.id),
  };
}

function normalizarAsignaciones(asignaciones, cantidadRecibida) {
  const lista = Array.isArray(asignaciones) ? asignaciones : [];
  const ids = [];
  let total = 0;

  const resultado = lista.map((asignacion) => {
    const detalleId = Number(
      asignacion?.detallePedidoId ??
        asignacion?.detalle_pedido_id,
    );
    const cantidad = Number(asignacion?.cantidad);

    if (!Number.isInteger(detalleId) || detalleId <= 0) {
      throw new Error(
        "Hay una asignación sin una línea de pedido válida.",
      );
    }

    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      throw new Error(
        "La cantidad asignada debe ser un entero mayor o igual a 1.",
      );
    }

    ids.push(detalleId);
    total += cantidad;

    return {
      detalle_pedido_id: detalleId,
      cantidad,
    };
  });

  if (new Set(ids).size !== ids.length) {
    throw new Error(
      "No se puede asignar dos veces la misma línea de pedido.",
    );
  }

  if (total > cantidadRecibida) {
    throw new Error(
      "Las asignaciones superan la cantidad recibida de la compra.",
    );
  }

  return resultado;
}

function normalizarLinea(linea) {
  const presentacion = Number(
    linea?.presentacionId ?? linea?.presentacion_id,
  );
  const cantidadNumero = Number(linea?.cantidad);
  const costo = String(
    linea?.costoUnitario ?? linea?.costo_unitario ?? "",
  ).trim();
  const costoNumero = Number(costo);
  const recibidaCruda =
    linea?.cantidadRecibida ?? linea?.cantidad_recibida;
  const recibida =
    recibidaCruda === null ||
    recibidaCruda === undefined ||
    String(recibidaCruda).trim() === ""
      ? 0
      : Number(recibidaCruda);

  if (!Number.isInteger(presentacion) || presentacion <= 0) {
    throw new Error("Selecciona una presentación válida.");
  }

  if (
    !Number.isInteger(cantidadNumero) ||
    cantidadNumero < 1
  ) {
    throw new Error("La cantidad debe ser un entero mayor o igual a 1.");
  }

  if (
    !costo ||
    !Number.isFinite(costoNumero) ||
    costoNumero <= 0
  ) {
    throw new Error(
      "El costo unitario debe ser mayor que cero."
    );
  }

  if (
    !Number.isInteger(recibida) ||
    recibida < 0 ||
    recibida > cantidadNumero
  ) {
    throw new Error(
      "La cantidad recibida debe estar entre cero y la cantidad comprada.",
    );
  }

  const asignaciones = normalizarAsignaciones(
    linea?.asignaciones,
    recibida,
  );
  const resultado = {
    presentacion_id: presentacion,
    cantidad: cantidadNumero,
    costo_unitario: costo,
  };

  if (recibida > 0) {
    resultado.cantidad_recibida = recibida;
  }

  if (asignaciones.length > 0) {
    if (recibida <= 0) {
      throw new Error(
        "Primero recibe físicamente las unidades antes de asignarlas.",
      );
    }

    resultado.asignaciones = asignaciones;
  }

  return resultado;
}

export function construirPayloadCompra({
  proveedorId,
  fecha,
  lineas,
  presentacionId,
  cantidad,
  costoUnitario,
  cantidadRecibida,
  asignaciones,
}) {
  const proveedor = Number(proveedorId);

  if (!Number.isInteger(proveedor) || proveedor <= 0) {
    throw new Error("Selecciona un proveedor válido.");
  }

  if (!fecha) {
    throw new Error("Selecciona la fecha de compra.");
  }

  const lineasEntrada =
    Array.isArray(lineas) && lineas.length > 0
      ? lineas
      : [
          {
            presentacionId,
            cantidad,
            costoUnitario,
            cantidadRecibida,
            asignaciones,
          },
        ];

  const lineasNormalizadas = lineasEntrada.map(normalizarLinea);
  const presentaciones = lineasNormalizadas.map(
    (linea) => linea.presentacion_id,
  );

  if (new Set(presentaciones).size !== presentaciones.length) {
    throw new Error(
      "No se puede repetir una presentación dentro de una compra.",
    );
  }

  return {
    proveedor_id: proveedor,
    fecha,
    lineas: lineasNormalizadas,
  };
}

export function calcularTotalCompra(lineas) {
  return (Array.isArray(lineas) ? lineas : []).reduce(
    (total, linea) =>
      total +
      Math.max(0, Number(linea?.cantidad) || 0) *
        Math.max(0, Number(linea?.costoUnitario) || 0),
    0,
  );
}

export async function registrarCompra(datos) {
  const payload = construirPayloadCompra(datos);
  const clave = String(
    datos?.claveIdempotencia ?? crearClaveIdempotencia(),
  ).trim();
  const { data } = await api.post(
    "/finanzas/compras/registrar/",
    payload,
    {
      headers: { "Idempotency-Key": clave },
    },
  );
  invalidarCacheAdmin();

  return data;
}

export function construirPayloadRecepcion({ fecha, lineas }) {
  if (!fecha) {
    throw new Error("Selecciona la fecha de recepción.");
  }

  const resultado = (Array.isArray(lineas) ? lineas : [])
    .map((linea) => {
      const detalleId = Number(
        linea?.detalleCompraId ?? linea?.detalle_compra_id,
      );
      const cantidad = Number(linea?.cantidad);
      const asignaciones = normalizarAsignaciones(
        linea?.asignaciones,
        cantidad,
      );

      if (!Number.isInteger(detalleId) || detalleId <= 0) {
        throw new Error(
          "La recepción contiene una línea de compra inválida.",
        );
      }

      if (!Number.isInteger(cantidad) || cantidad <= 0) {
        throw new Error(
          "La cantidad recibida debe ser un entero mayor o igual a 1.",
        );
      }

      return {
        detalle_compra_id: detalleId,
        cantidad,
        ...(asignaciones.length ? { asignaciones } : {}),
      };
    })
    .filter((linea) => linea.cantidad > 0);

  if (!resultado.length) {
    throw new Error("Indica al menos una cantidad por recibir.");
  }

  const ids = resultado.map((linea) => linea.detalle_compra_id);

  if (new Set(ids).size !== ids.length) {
    throw new Error(
      "No se puede repetir una línea de compra en la recepción.",
    );
  }

  return { fecha, lineas: resultado };
}

export async function registrarRecepcionCompra(
  compraId,
  { fecha, lineas, claveIdempotencia } = {},
) {
  const id = Number(compraId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("El identificador de la compra no es válido.");
  }

  const payload = construirPayloadRecepcion({ fecha, lineas });
  const clave = String(
    claveIdempotencia ?? crearClaveIdempotencia(),
  ).trim();
  const { data } = await api.post(
    `/finanzas/compras/${id}/recibir/`,
    payload,
    {
      headers: { "Idempotency-Key": clave },
    },
  );
  invalidarCacheAdmin();

  return data;
}

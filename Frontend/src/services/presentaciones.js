import { api } from "./api.js";
import {
  TTL_ADMIN,
  invalidarCacheAdmin,
  obtenerConCache,
} from "./adminCache.js";

const PORCENTAJES_VALIDOS = new Set([40, 60, 70, 80]);

function extraerLista(datos) {
  if (Array.isArray(datos)) return datos;
  if (Array.isArray(datos?.results)) return datos.results;
  return [];
}

export async function listarPresentaciones({
  producto,
  signal,
} = {}) {
  const clave =
    producto != null && producto !== ""
      ? `catalogo:presentaciones:${producto}`
      : "catalogo:presentaciones";

  return obtenerConCache(
    clave,
    async () => {
      const config = {};

      if (producto != null && producto !== "") {
        config.params = { producto };
      }

      const { data } = await api.get(
        "/catalogo/presentaciones/",
        config,
      );

      return extraerLista(data);
    },
    {
      ttl: TTL_ADMIN.catalogo,
      signal,
    },
  );
}

export function construirPayloadPresentacion({
  producto,
  porcentaje,
  activo = true,
}) {
  const productoId = Number(producto);
  const porcentajeNumero = Number(porcentaje);

  if (!Number.isInteger(productoId) || productoId <= 0) {
    throw new Error("Selecciona un producto válido.");
  }

  if (!PORCENTAJES_VALIDOS.has(porcentajeNumero)) {
    throw new Error(
      "El porcentaje debe ser 40, 60, 70 u 80."
    );
  }

  return {
    producto: productoId,
    porcentaje: porcentajeNumero,
    activo: Boolean(activo),
  };
}

export async function crearPresentacion(datos) {
  const payload = construirPayloadPresentacion(datos);
  const { data } = await api.post(
    "/catalogo/presentaciones/",
    payload
  );
  invalidarCacheAdmin();

  return data;
}

export async function actualizarActivoPresentacion(
  id,
  activo
) {
  const { data } = await api.patch(
    `/catalogo/presentaciones/${id}/`,
    { activo: Boolean(activo) }
  );
  invalidarCacheAdmin();

  return data;
}

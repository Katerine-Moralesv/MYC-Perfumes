import { api } from "./api.js";

function extraerLista(datos) {
  if (Array.isArray(datos)) return datos;
  if (Array.isArray(datos?.results)) return datos.results;
  return [];
}

export async function listarProductosAdmin({ signal } = {}) {
  const { data } = await api.get("/catalogo/productos/admin/", {
    signal,
  });

  return extraerLista(data);
}

export function construirPayloadProducto(formulario) {
  const familias = (formulario.familias_olfativas || [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);

  return {
    nombre: String(formulario.nombre || "").trim(),
    descripcion: String(formulario.descripcion || "").trim(),
    categoria: formulario.categoria
      ? Number(formulario.categoria)
      : null,
    familias_olfativas: familias,
    precio: String(formulario.precio ?? "").trim(),
    contenido_ml: Number(formulario.contenido_ml),
    dias_entrega: Number(formulario.dias_entrega),
    activo: Boolean(formulario.activo),
  };
}

export function construirFormDataProducto(formulario, archivoFoto) {
  const data = new FormData();
  const payload = construirPayloadProducto(formulario);

  data.append("nombre", payload.nombre);
  data.append("descripcion", payload.descripcion);

  if (payload.categoria != null) {
    data.append("categoria", String(payload.categoria));
  }

  for (const familiaId of payload.familias_olfativas) {
    data.append("familias_olfativas", String(familiaId));
  }

  data.append("precio", payload.precio);
  data.append("contenido_ml", String(payload.contenido_ml));
  data.append("dias_entrega", String(payload.dias_entrega));
  data.append("activo", payload.activo ? "true" : "false");

  if (archivoFoto) {
    data.append(
      "foto",
      archivoFoto,
      archivoFoto.name || "producto.jpg"
    );
  }

  return data;
}

export async function crearProducto({
  formulario,
  archivoFoto = null,
}) {
  const payload = archivoFoto
    ? construirFormDataProducto(formulario, archivoFoto)
    : construirPayloadProducto(formulario);

  const { data } = await api.post("/catalogo/productos/", payload);
  return data;
}

export async function actualizarProducto(
  id,
  {
    formulario,
    archivoFoto = null,
    quitarFoto = false,
  }
) {
  let payload;

  if (archivoFoto) {
    payload = construirFormDataProducto(formulario, archivoFoto);
  } else {
    payload = construirPayloadProducto(formulario);

    if (quitarFoto) {
      payload.foto = null;
    }
  }

  const { data } = await api.patch(
    `/catalogo/productos/${id}/`,
    payload
  );

  return data;
}

export async function actualizarActivo(id, activo) {
  const { data } = await api.patch(
    `/catalogo/productos/${id}/`,
    { activo: Boolean(activo) }
  );

  return data;
}

import { API_BASE_URL, api } from "./api.js";

function extraerLista(datos) {
  if (Array.isArray(datos)) return datos;
  if (Array.isArray(datos?.results)) return datos.results;
  return [];
}

export async function listarProductos({ signal } = {}) {
  const { data } = await api.get("/catalogo/productos/", { signal });
  return extraerLista(data);
}

export async function listarCategorias({ signal } = {}) {
  const { data } = await api.get("/catalogo/categorias/", { signal });
  return extraerLista(data);
}

export async function listarFamiliasOlfativas({ signal } = {}) {
  const { data } = await api.get("/catalogo/familias-olfativas/", {
    signal,
  });
  return extraerLista(data);
}

export function normalizarNombreFamilia(nombre) {
  return String(nombre ?? "").trim().replace(/\s+/g, " ");
}

export function obtenerErrorNombreFamilia(
  nombre,
  familias = [],
  idExcluido = null,
) {
  const nombreLimpio = normalizarNombreFamilia(nombre);

  if (!nombreLimpio) {
    return "El nombre de la familia olfativa es obligatorio.";
  }

  if (nombreLimpio.length > 100) {
    return "El nombre no puede superar los 100 caracteres.";
  }

  const nombreComparable = nombreLimpio.toLocaleLowerCase("es");
  const duplicada = familias.some(
    (familia) =>
      String(familia.id) !== String(idExcluido) &&
      normalizarNombreFamilia(familia.nombre).toLocaleLowerCase("es") ===
        nombreComparable,
  );

  if (duplicada) {
    return "Ya existe una familia olfativa con este nombre.";
  }

  return "";
}

function prepararNombreFamilia(nombre) {
  const nombreLimpio = normalizarNombreFamilia(nombre);

  if (!nombreLimpio) {
    throw new Error(
      "El nombre de la familia olfativa es obligatorio.",
    );
  }

  return nombreLimpio;
}

export async function crearFamiliaOlfativa(nombre) {
  const nombreLimpio = prepararNombreFamilia(nombre);

  const { data } = await api.post(
    "/catalogo/familias-olfativas/",
    { nombre: nombreLimpio },
  );

  return data;
}

export async function actualizarFamiliaOlfativa(id, nombre) {
  const nombreLimpio = prepararNombreFamilia(nombre);

  const { data } = await api.patch(
    `/catalogo/familias-olfativas/${id}/`,
    { nombre: nombreLimpio },
  );

  return data;
}

export async function eliminarFamiliaOlfativa(id) {
  const { data } = await api.delete(
    `/catalogo/familias-olfativas/${id}/`,
  );

  return data;
}

function obtenerOrigenApi() {
  if (!/^https?:\/\//i.test(API_BASE_URL)) {
    return "";
  }

  try {
    return new URL(API_BASE_URL).origin;
  } catch {
    return "";
  }
}

export function resolverUrlMedia(valor) {
  if (typeof valor !== "string") return "";

  const texto = valor.trim();

  if (!texto) return "";

  if (/^(https?:|data:|blob:)/i.test(texto)) {
    return texto;
  }

  const origen = obtenerOrigenApi();

  if (texto.startsWith("/")) {
    return origen ? `${origen}${texto}` : texto;
  }

  return origen ? `${origen}/${texto}` : `/${texto}`;
}

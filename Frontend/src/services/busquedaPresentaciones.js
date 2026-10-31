export const PORCENTAJES_RECARGA = [40, 60, 70, 80];

export const MENSAJE_PORCENTAJE_INVALIDO =
  "Porcentaje de recarga no válido. Solo se permite 40 %, 60 %, 70 % u 80 %";

function normalizarTexto(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim();
}

export function porcentajeRecargaValido(valor) {
  return /^(40|60|70|80)$/.test(String(valor ?? "").trim());
}

export function filtrarSugerencias(
  items,
  texto,
  limite = 8,
) {
  const termino = normalizarTexto(texto);
  const lista = Array.isArray(items) ? items : [];

  return lista
    .filter((item) => {
      if (!termino) return true;

      const contenido = normalizarTexto(
        `${item.label || ""} ${item.description || ""} ${
          item.searchText || ""
        }`,
      );

      return contenido.includes(termino);
    })
    .slice(0, limite);
}

export function resolverPresentacion(
  presentaciones,
  productoId,
  porcentaje,
) {
  if (!productoId || !porcentajeRecargaValido(porcentaje)) {
    return null;
  }

  const numero = Number(porcentaje);

  return (
    presentaciones.find(
      (presentacion) =>
        String(presentacion.producto) === String(productoId) &&
        Number(presentacion.porcentaje) === numero &&
        presentacion.activo !== false,
    ) || null
  );
}

export function construirOpcionesProductos(
  productos,
  presentaciones,
) {
  const presentacionesActivas = (
    Array.isArray(presentaciones) ? presentaciones : []
  ).filter((presentacion) => presentacion.activo !== false);

  return (Array.isArray(productos) ? productos : [])
    .filter(
      (producto) =>
        producto.activo !== false &&
        presentacionesActivas.some(
          (presentacion) =>
            String(presentacion.producto) === String(producto.id),
        ),
    )
    .map((producto) => {
      const ml = producto.contenido_ml
        ? `${producto.contenido_ml} ml`
        : "Contenido sin definir";

      return {
        id: producto.id,
        label: producto.nombre,
        description: ml,
        searchText: `${producto.nombre} ${ml}`,
      };
    })
    .sort((a, b) =>
      String(a.label).localeCompare(String(b.label), "es"),
    );
}

export function construirOpcionesPresentaciones(
  presentaciones,
  productosPorId,
) {
  return (Array.isArray(presentaciones) ? presentaciones : [])
    .map((presentacion) => {
      const producto = productosPorId.get(
        String(presentacion.producto),
      );
      const nombre =
        producto?.nombre ||
        presentacion.producto_nombre ||
        "Producto";
      const ml = producto?.contenido_ml
        ? `${producto.contenido_ml} ml`
        : "Contenido sin definir";
      const recarga =
        Number(presentacion.porcentaje) === 40
          ? "Sin recarga"
          : "Recarga";

      return {
        id: presentacion.id,
        label: `${nombre} · ${ml}`,
        description: `${presentacion.porcentaje} % · ${recarga}`,
        searchText: `${nombre} ${ml} ${presentacion.porcentaje} ${recarga}`,
      };
    })
    .sort(
      (a, b) =>
        String(a.label).localeCompare(String(b.label), "es") ||
        String(a.description).localeCompare(
          String(b.description),
          "es",
        ),
    );
}

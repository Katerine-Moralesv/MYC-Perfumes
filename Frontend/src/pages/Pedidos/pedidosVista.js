export const ESTADOS_PEDIDO = {
  pendiente: "Pendiente",
  confirmado: "Confirmado",
  por_comprar: "Por comprar",
  comprado: "Comprado",
  preparando: "Preparando",
  listo: "Listo",
  entregado: "Entregado",
  cancelado: "Cancelado",
  rechazado: "Rechazado",
};

export const ESTADOS_PAGO = {
  pendiente: "Pendiente",
  abonado: "Abonado",
  pagado: "Pagado",
};

export const FILTROS_PEDIDO = [
  { valor: "pendiente", etiqueta: "Pendientes" },
  { valor: "confirmado", etiqueta: "Confirmados" },
  { valor: "por_comprar", etiqueta: "Por comprar" },
  { valor: "comprado", etiqueta: "Comprados" },
  { valor: "preparando", etiqueta: "Preparando" },
  { valor: "listo", etiqueta: "Listos" },
  { valor: "entregado", etiqueta: "Entregados" },
  { valor: "cancelado", etiqueta: "Cancelados" },
  { valor: "rechazado", etiqueta: "Rechazados" },
  { valor: "todos", etiqueta: "Todos" },
];

export const TRANSICIONES_ESTADO = {
  comprado: {
    estado: "preparando",
    etiqueta: "Marcar preparando",
  },
  preparando: {
    estado: "listo",
    etiqueta: "Marcar listo",
  },
  listo: {
    estado: "entregado",
    etiqueta: "Marcar entregado",
  },
};

const ESTADOS_CON_ANTICIPO = new Set([
  "confirmado",
  "por_comprar",
  "comprado",
  "preparando",
  "listo",
]);

const ESTADOS_FINALES = new Set([
  "entregado",
  "cancelado",
  "rechazado",
]);

export function etiquetaEstadoPedido(estado) {
  return ESTADOS_PEDIDO[estado] || estado || "Sin estado";
}

export function etiquetaPagoPedido(estado) {
  return ESTADOS_PAGO[estado] || "Sin pago registrado";
}

export function pedidoPendienteDeCompra(pedido) {
  if (pedido?.esVentaManual) {
    return Boolean(
      pedido.estado === "por_comprar" &&
        Number(pedido.unidades_pendientes_compra || 0) > 0,
    );
  }

  return Boolean(
    pedido &&
      ["confirmado", "por_comprar"].includes(pedido.estado) &&
      !pedido.venta,
  );
}

export function construirPedidosDesdeVentasPendientes(ventas) {
  return (Array.isArray(ventas) ? ventas : [])
    .filter(
      (venta) =>
        venta &&
        venta.origen !== "pedido" &&
        Number(venta.unidades_pendientes_abastecimiento || 0) > 0,
    )
    .map((venta) => {
      const total = Number(venta.total || 0);
      const saldo = Number(venta.saldo || 0);
      const montoPagado = Number(
        venta.monto_pagado ?? total - saldo,
      );

      return {
        id: `venta-manual-${venta.id}`,
        ventaId: venta.id,
        venta: venta.id,
        esVentaManual: true,
        origen: "manual",
        cliente: venta.cliente,
        cliente_nombre: venta.cliente_nombre || "Cliente",
        telefono_origen: venta.cliente_telefono || "",
        estado: "por_comprar",
        estado_pago: venta.estado_pago || "pendiente",
        estado_abastecimiento: venta.estado_abastecimiento,
        total,
        saldo,
        monto_pagado: montoPagado,
        precios_completos: true,
        puede_generar_venta: false,
        unidades_pendientes_compra: Number(
          venta.unidades_pendientes_abastecimiento || 0,
        ),
        anticipos: venta.abonos || [],
        creado_en:
          venta.creado_en || `${venta.fecha || ""}T00:00:00`,
        detalles: (venta.detalles || []).map((detalle) => ({
          ...detalle,
          porcentaje_recarga: detalle.porcentaje,
          cantidad_cubierta: Number(
            detalle.cantidad_cubierta ??
              Number(detalle.cantidad || 0) -
                Number(detalle.cantidad_pendiente || 0),
          ),
          cantidad_pendiente: Number(
            detalle.cantidad_pendiente || 0,
          ),
          precio_unitario: detalle.precio_venta,
          precio_pendiente: false,
        })),
      };
    });
}

export function pedidoPuedeConfirmar(pedido) {
  if (!pedido || pedido.estado !== "pendiente") return false;

  const total = Number(pedido.total || 0);
  const detalles = Array.isArray(pedido.detalles)
    ? pedido.detalles
    : [];

  return (
    total > 0 &&
    detalles.length > 0 &&
    detalles.every((detalle) => !detalle.precio_pendiente) &&
    (pedido.precios_completos !== false)
  );
}

export function puedeConfirmarConPrecios(
  pedido,
  detalles,
  precios = {},
) {
  if (!pedido || pedido.estado !== "pendiente") return false;

  const lineas = Array.isArray(detalles) ? detalles : [];

  if (!lineas.length) return false;

  const faltanPrecios = lineas
    .filter((detalle) => detalle.precio_pendiente)
    .some(
      (detalle) =>
        !(Number(precios[String(detalle.id)]) > 0),
    );

  return !faltanPrecios && calcularTotalEstimado(lineas, precios) > 0;
}

export function pedidoPuedeRegistrarAnticipo(pedido) {
  if (!pedido || pedido.venta) return false;
  if (!ESTADOS_CON_ANTICIPO.has(pedido.estado)) return false;

  return Number(pedido.saldo ?? pedido.total ?? 0) > 0;
}

export function pedidoPuedeCancelar(pedido) {
  return Boolean(
    pedido &&
      !ESTADOS_FINALES.has(pedido.estado),
  );
}

export function siguienteEstadoPedido(pedido) {
  if (!pedido) return null;

  return TRANSICIONES_ESTADO[pedido.estado] || null;
}

export function puedeGenerarVentaPedido(pedido) {
  return Boolean(pedido?.puede_generar_venta);
}

export function calcularTotalEstimado(detalles, precios = {}) {
  return (Array.isArray(detalles) ? detalles : []).reduce(
    (total, detalle) => {
      const precio = detalle.precio_pendiente
        ? Number(precios[String(detalle.id)] || 0)
        : Number(detalle.precio_unitario || 0);

      return total + precio * Number(detalle.cantidad || 0);
    },
    0,
  );
}

export function construirLineasPrecioConfirmacion(
  detalles,
  precios = {},
) {
  return (Array.isArray(detalles) ? detalles : [])
    .filter((detalle) => detalle.precio_pendiente)
    .map((detalle) => ({
      detalleId: detalle.id,
      precioVenta: String(precios[String(detalle.id)] ?? "").trim(),
    }));
}

export function contarPedidosPorEstado(pedidos) {
  const conteos = {
    todos: Array.isArray(pedidos) ? pedidos.length : 0,
  };

  for (const estado of Object.keys(ESTADOS_PEDIDO)) {
    conteos[estado] = 0;
  }

  for (const pedido of Array.isArray(pedidos) ? pedidos : []) {
    if (pedido?.estado in conteos) {
      conteos[pedido.estado] += 1;
    }
  }

  return conteos;
}

export function filtrarPedidos(pedidos, filtro, busqueda = "") {
  const termino = String(busqueda ?? "")
    .trim()
    .toLocaleLowerCase("es");

  return (Array.isArray(pedidos) ? pedidos : []).filter(
    (pedido) => {
      if (filtro !== "todos" && pedido.estado !== filtro) {
        return false;
      }

      if (!termino) return true;

      const texto = [
        pedido.id,
        pedido.cliente_nombre,
        pedido.telefono_origen,
        ...(pedido.detalles || []).map(
          (detalle) => detalle.producto_nombre,
        ),
      ]
        .join(" ")
        .toLocaleLowerCase("es");

      return texto.includes(termino);
    },
  );
}

export function resumenPagoPedido(pedido) {
  const montoPagado = Number(pedido?.monto_pagado || 0);
  const saldo = Number(pedido?.saldo || 0);

  return {
    montoPagado,
    saldo,
    estadoPago: pedido?.estado_pago || "pendiente",
    etiquetaPago: etiquetaPagoPedido(
      pedido?.estado_pago || "pendiente",
    ),
  };
}

export const ETIQUETAS_PAGO = {
  pagado: "Pagado",
  abonado: "Abonado",
  pendiente: "Pendiente",
};

export function datosVenta(venta) {
  const total = Math.max(0, Number(venta?.total || 0));
  const saldo = Math.max(0, Number(venta?.saldo || 0));
  const montoPagado = Math.max(0, total - saldo);
  const estadoPago =
    venta?.estado_pago ||
    (saldo <= 0
      ? "pagado"
      : montoPagado > 0
        ? "abonado"
        : "pendiente");

  return {
    total,
    saldo,
    montoPagado,
    estadoPago,
    etiquetaPago: ETIQUETAS_PAGO[estadoPago] || estadoPago,
  };
}

export function resumenLineas(venta) {
  const lineas = (venta.detalles || []).map((detalle) => {
    const pendiente = Number(detalle.cantidad_pendiente || 0);

    return (
      `${detalle.producto_nombre || "Producto"} ` +
      `${detalle.porcentaje} % × ${detalle.cantidad}` +
      (pendiente > 0
        ? ` (${pendiente} por abastecer)`
        : "")
    );
  });

  return lineas.length ? lineas.join(" · ") : "Sin detalle de líneas";
}

export function construirClientes(clientesApi, ventasApi, pedidosApi) {
  const ventasPorCliente = new Map();

  (Array.isArray(ventasApi) ? ventasApi : []).forEach((venta) => {
    if (!venta || venta.cliente == null) return;
    const clave = String(venta.cliente);

    if (!ventasPorCliente.has(clave)) {
      ventasPorCliente.set(clave, []);
    }

    ventasPorCliente.get(clave).push({
      ...venta,
      ...datosVenta(venta),
    });
  });

  const pedidosPorCliente = new Map();

  (Array.isArray(pedidosApi) ? pedidosApi : []).forEach((pedido) => {
    if (!pedido || pedido.cliente == null) return;
    if (pedido.estado === "confirmado") return;

    const clave = String(pedido.cliente);

    if (!pedidosPorCliente.has(clave)) {
      pedidosPorCliente.set(clave, []);
    }

    pedidosPorCliente.get(clave).push(pedido);
  });

  return (Array.isArray(clientesApi) ? clientesApi : [])
    .map((cliente) => {
      const ventas = ventasPorCliente.get(String(cliente.id)) || [];
      const pedidos = pedidosPorCliente.get(String(cliente.id)) || [];
      const totalVendido = ventas.reduce(
        (total, venta) => total + venta.total,
        0,
      );
      const totalPagado = ventas.reduce(
        (total, venta) => total + venta.montoPagado,
        0,
      );
      const saldoPendiente = ventas.reduce(
        (total, venta) => total + venta.saldo,
        0,
      );

      let estado = "Sin ventas";

      if (ventas.length) {
        estado =
          saldoPendiente <= 0
            ? "Pagado"
            : totalPagado > 0
              ? "Abonado"
              : "Pendiente";
      } else if (pedidos.some((pedido) => pedido.estado === "pendiente")) {
        estado = "Pedido pendiente";
      } else if (pedidos.some((pedido) => pedido.estado === "rechazado")) {
        estado = "Pedido rechazado";
      }

      return {
        ...cliente,
        ventas,
        pedidos,
        totalVendido,
        totalPagado,
        saldoPendiente,
        estado,
      };
    })
    .sort((a, b) =>
      String(a.nombre).localeCompare(String(b.nombre), "es"),
    );
}

function numero(valor) {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : 0;
}

export function construirClientesDesdeResumen(resumenApi) {
  return (Array.isArray(resumenApi) ? resumenApi : [])
    .map((cliente) => {
      const ventas = (cliente.ventas || []).map((venta) => ({
        ...venta,
        total: numero(venta.total),
        saldo: numero(venta.saldo),
        montoPagado: numero(venta.monto_pagado),
        etiquetaPago:
          ETIQUETAS_PAGO[venta.estado_pago] ||
          venta.estado_pago ||
          "Pendiente",
      }));
      const pedidos = (cliente.pedidos || []).map((pedido) => ({
        ...pedido,
        total: numero(pedido.total),
        saldo: numero(pedido.saldo),
        montoPagado: numero(pedido.monto_pagado),
        etiquetaPago:
          ETIQUETAS_PAGO[pedido.estado_pago] ||
          pedido.estado_pago ||
          "Pendiente",
        unidadesPendientesCompra: numero(
          pedido.unidades_pendientes_compra,
        ),
      }));

      return {
        ...cliente,
        ventas,
        pedidos,
        totalVendido: numero(cliente.total_ventas),
        totalPedidos: numero(cliente.total_pedidos),
        totalAcordado: numero(cliente.total_acordado),
        totalPagado: numero(cliente.total_pagado),
        saldoPendiente: numero(cliente.saldo_pendiente),
      };
    })
    .sort((a, b) =>
      String(a.nombre).localeCompare(String(b.nombre), "es"),
    );
}

export function filtrarClientes(clientes, busqueda, filtro) {
  const termino = String(busqueda || "")
    .trim()
    .toLocaleLowerCase("es");
  const terminoDigitos = termino.replace(/\D/g, "");

  return (Array.isArray(clientes) ? clientes : []).filter((cliente) => {
    const texto = `${cliente.nombre} ${cliente.telefono} ${
      cliente.notas || ""
    }`.toLocaleLowerCase("es");
    const coincideBusqueda =
      !termino ||
      texto.includes(termino) ||
      (terminoDigitos &&
        String(cliente.telefono || "").includes(terminoDigitos));

    const coincideFiltro =
      filtro === "Todos" ||
      (filtro === "Con saldo" && cliente.saldoPendiente > 0) ||
      (filtro === "Al día" &&
        (cliente.ventas.length > 0 ||
          cliente.pedidos.length > 0) &&
        cliente.saldoPendiente <= 0) ||
      (filtro === "Pedidos sin confirmar" &&
        cliente.pedidos.some(
          (pedido) => pedido.estado === "pendiente",
        ));

    return coincideBusqueda && coincideFiltro;
  });
}

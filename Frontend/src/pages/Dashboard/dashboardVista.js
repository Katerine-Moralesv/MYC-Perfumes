const MONEDA_COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

const NUMERO = new Intl.NumberFormat("es-CO", {
  maximumFractionDigits: 0,
});

const NUMERO_COMPACTO = new Intl.NumberFormat("es-CO", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export const SECCIONES_SOLO_ADMIN = [
  "Dashboard",
  "Catálogo",
  "Compras",
  "Pedidos",
];

export const ESTADOS_PEDIDO = {
  pendiente: "Pendiente",
  confirmado: "Confirmado",
  comprado: "Comprado",
  preparando: "Preparando",
  listo: "Listo",
  entregado: "Entregado",
  cancelado: "Cancelado",
  rechazado: "Rechazado",
};

function convertirNumero(valor) {
  if (valor === null || valor === undefined || valor === "") {
    return null;
  }

  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

export function resolverSeccion(seccion, isAdmin) {
  if (!isAdmin && SECCIONES_SOLO_ADMIN.includes(seccion)) {
    return "Ventas";
  }

  return seccion;
}

export function puedeMostrarResumenInferior({
  cargando = true,
  error = "",
  resumenPeriodo = null,
  metricasActuales = null,
} = {}) {
  return Boolean(
    !cargando &&
      !error &&
      resumenPeriodo !== null &&
      resumenPeriodo !== undefined &&
      metricasActuales,
  );
}

export function formatearMonedaCOP(valor) {
  const numero = convertirNumero(valor);

  return numero === null ? "—" : MONEDA_COP.format(numero);
}

export function formatearNumero(valor) {
  const numero = convertirNumero(valor);

  return numero === null ? "—" : NUMERO.format(numero);
}

export function formatearCompactoCOP(valor) {
  const numero = convertirNumero(valor);

  return numero === null
    ? "—"
    : `$ ${NUMERO_COMPACTO.format(numero)}`;
}

export function etiquetaMes(mes) {
  const [anio, numeroMes] = String(mes ?? "").split("-").map(Number);

  if (!Number.isInteger(anio) || !Number.isInteger(numeroMes)) {
    return String(mes ?? "");
  }

  const fecha = new Date(anio, numeroMes - 1, 2);

  if (Number.isNaN(fecha.getTime())) return String(mes ?? "");

  return fecha.toLocaleDateString("es-CO", {
    month: "long",
    year: "numeric",
  });
}

export function etiquetaMesCorto(mes) {
  const [anio, numeroMes] = String(mes ?? "").split("-").map(Number);

  if (!Number.isInteger(anio) || !Number.isInteger(numeroMes)) {
    return String(mes ?? "");
  }

  const fecha = new Date(anio, numeroMes - 1, 2);
  const etiqueta = fecha
    .toLocaleDateString("es-CO", { month: "short" })
    .replace(".", "");

  return etiqueta.charAt(0).toLocaleUpperCase("es-CO") + etiqueta.slice(1);
}

export function formatearFechaPedido(fecha) {
  if (!fecha) return "—";

  const valor = new Date(fecha);

  if (Number.isNaN(valor.getTime())) return String(fecha);

  return valor.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function etiquetaEstadoPedido(estado) {
  return ESTADOS_PEDIDO[estado] || estado || "Sin estado";
}

export function mensajeRecaudacionNoDisponible(motivo) {
  const texto = String(motivo ?? "").trim();

  if (
    /pagos no registrados|datos inconsistentes|pagos hist[oó]ricos/i.test(
      texto,
    )
  ) {
    return "No hay información de pagos suficientemente consistente para certificar la recaudación de este periodo.";
  }

  if (/datos inv[aá]lidos|pagos con datos/i.test(texto)) {
    return "Hay pagos con información inconsistente en este periodo; la recaudación no se puede certificar.";
  }

  return "La recaudación no está disponible para este periodo.";
}

export function describirRecaudacion(recaudacion) {
  const disponible = recaudacion?.disponible === true;

  if (!disponible) {
    return {
      disponible: false,
      valor: "No disponible",
      detalle: mensajeRecaudacionNoDisponible(recaudacion?.motivo),
      esCero: false,
    };
  }

  const importe = recaudacion?.importe;

  return {
    disponible: true,
    valor: formatearMonedaCOP(importe),
    detalle: "Pagos recibidos durante el periodo",
    esCero: convertirNumero(importe) === 0,
  };
}

export function construirTarjetas({
  metricas_periodo: periodo = {},
  metricas_actuales: actuales = {},
} = {}) {
  const recaudacion = describirRecaudacion(periodo?.recaudacion);
  const clientesConDeudas = convertirNumero(
    actuales?.clientes_con_deudas,
  );
  const sufijoDeudas =
    clientesConDeudas === 1 ? "cliente" : "clientes";
  const pedidosPorComprar = convertirNumero(
    actuales?.pedidos_confirmados_sin_venta ??
      actuales?.pedidos_por_comprar,
  );
  const sufijoPorComprar =
    pedidosPorComprar === 1 ? "pedido" : "pedidos";

  return [
    {
      clave: "ganancia",
      titulo: "Ganancia bruta del mes",
      valor: formatearMonedaCOP(periodo?.ganancia_bruta),
      nota: "Calculada con costos reales asignados",
      icono: "ganancia",
      tipo: "moneda",
    },
    {
      clave: "recaudacion",
      titulo: "Total recaudado en el periodo",
      valor: recaudacion.valor,
      nota: recaudacion.detalle,
      icono: "recaudacion",
      tipo: recaudacion.disponible ? "moneda" : "no-disponible",
      alerta: !recaudacion.disponible,
    },
    {
      clave: "vendido",
      titulo: "Total vendido durante el mes",
      valor: formatearMonedaCOP(periodo?.total_vendido),
      nota: "Ventas financieras registradas",
      icono: "vendido",
      tipo: "moneda",
    },
    {
      clave: "devoluciones",
      titulo: "Devoluciones del periodo",
      valor: formatearMonedaCOP(periodo?.devoluciones),
      nota: "Salidas de dinero registradas",
      icono: "devolucion",
      tipo: "moneda",
    },
    {
      clave: "porcomprar",
      titulo: "Pedidos pendientes de compra",
      valor: formatearNumero(pedidosPorComprar),
      nota: `${formatearMonedaCOP(
        actuales?.saldo_pedidos_por_comprar,
      )} pendiente de compra`,
      icono: "pedidos",
      tipo: "cantidad",
      sufijo: sufijoPorComprar,
    },
    {
      clave: "deudas",
      titulo: "Clientes con deudas",
      valor: formatearNumero(actuales?.clientes_con_deudas),
      nota: `${formatearMonedaCOP(
        actuales?.saldo_por_cobrar,
      )} por cobrar en ventas`,
      icono: "deudas",
      tipo: "cantidad",
      sufijo: sufijoDeudas,
    },
  ];
}

export function construirResumenActual(actuales = {}) {
  const clientes = convertirNumero(actuales?.clientes_registrados);
  const pendientes = convertirNumero(actuales?.pedidos_pendientes);
  const porComprar = convertirNumero(
    actuales?.pedidos_confirmados_sin_venta ??
      actuales?.pedidos_por_comprar,
  );

  return [
    {
      clave: "saldo",
      etiqueta: "Saldo por cobrar de ventas",
      valor: formatearMonedaCOP(actuales?.saldo_por_cobrar),
      icono: "recaudacion",
      tipo: "moneda",
    },
    {
      clave: "saldo-pedidos",
      etiqueta: "Saldo de pedidos por comprar",
      valor: formatearMonedaCOP(
        actuales?.saldo_pedidos_por_comprar,
      ),
      icono: "pedidos",
      tipo: "moneda",
    },
    {
      clave: "clientes",
      etiqueta: "Clientes registrados",
      valor: formatearNumero(actuales?.clientes_registrados),
      icono: "clientes",
      tipo: "cantidad",
      sufijo: clientes === 1 ? "cliente" : "clientes",
    },
    {
      clave: "pendientes",
      etiqueta: "Pedidos pendientes de revisión",
      valor: formatearNumero(actuales?.pedidos_pendientes),
      icono: "pedidos",
      tipo: "cantidad",
      sufijo: pendientes === 1 ? "pedido" : "pedidos",
    },
    {
      clave: "porcomprar",
      etiqueta: "Pedidos pendientes de compra",
      valor: formatearNumero(porComprar),
      icono: "compras",
      tipo: "cantidad",
      sufijo: porComprar === 1 ? "pedido" : "pedidos",
    },
  ];
}

function serieNumerica(items, campo, etiqueta, textoValor) {
  return (Array.isArray(items) ? items : []).map((item, indice) => {
    const numero = convertirNumero(item?.[campo]) ?? 0;

    return {
      clave: String(item?.producto_id ?? item?.mes ?? `${etiqueta}-${indice}`),
      etiqueta: item?.producto_nombre || etiqueta,
      valor: numero,
      textoValor: textoValor(numero),
    };
  });
}

export function prepararSeries(metricasPeriodo = {}) {
  const unidades = serieNumerica(
    metricasPeriodo?.unidades_por_producto,
    "unidades",
    "Producto",
    (valor) => `${formatearNumero(valor)} und.`,
  );

  const gananciasProducto = serieNumerica(
    metricasPeriodo?.ganancia_por_producto,
    "ganancia",
    "Producto",
    (valor) => formatearMonedaCOP(valor),
  );

  const gananciasMensuales = (
    Array.isArray(metricasPeriodo?.ganancias_mensuales)
      ? metricasPeriodo.ganancias_mensuales
      : []
  ).map((item, indice) => {
    const numero = convertirNumero(item?.ganancia) ?? 0;

    return {
      clave: String(item?.mes ?? `mes-${indice}`),
      etiqueta: etiquetaMesCorto(item?.mes),
      etiquetaLarga: etiquetaMes(item?.mes),
      valor: numero,
      textoValor: formatearCompactoCOP(numero),
      textoCompleto: formatearMonedaCOP(numero),
    };
  });

  return { unidades, gananciasProducto, gananciasMensuales };
}

function pasoEscala(rango, pasos, enteros) {
  const bruto = rango / pasos;

  if (!Number.isFinite(bruto) || bruto <= 0) return 1;
  if (enteros) return Math.max(1, Math.ceil(bruto));

  const magnitud = 10 ** Math.floor(Math.log10(bruto));
  const normalizado = bruto / magnitud;
  const factor =
    normalizado <= 1
      ? 1
      : normalizado <= 2
        ? 2
        : normalizado <= 2.5
          ? 2.5
          : normalizado <= 5
            ? 5
            : 10;

  return factor * magnitud;
}

export function crearEscala(
  valores,
  { formatear = formatearNumero, pasos = 4, enteros = false } = {},
) {
  const numeros = (Array.isArray(valores) ? valores : [])
    .map(convertirNumero)
    .filter((valor) => valor !== null);

  let minimo = Math.min(0, ...numeros);
  let maximo = Math.max(0, ...numeros);

  if (minimo === maximo) {
    maximo = enteros ? 4 : 1;
  }

  const paso = pasoEscala(maximo - minimo, pasos, enteros);
  const inicio = Math.floor(minimo / paso) * paso;
  const fin = Math.ceil(maximo / paso) * paso;
  const ticks = [];

  for (
    let valor = inicio;
    valor <= fin + paso / 2;
    valor += paso
  ) {
    ticks.push(
      Math.abs(valor) < 1e-9
        ? 0
        : Number(valor.toFixed(6)),
    );
  }

  return {
    minimo: inicio,
    maximo: fin,
    ticks,
    etiquetas: ticks.map(formatear),
  };
}

export function posicionBarraVertical(valor, minimo, maximo) {
  const rango = maximo - minimo || 1;
  const numero = convertirNumero(valor) ?? 0;
  const cero = ((0 - minimo) / rango) * 100;
  const magnitud = (Math.abs(numero) / rango) * 100;

  return {
    inferior: numero >= 0 ? cero : cero - magnitud,
    altura: magnitud,
    negativa: numero < 0,
    cero,
  };
}

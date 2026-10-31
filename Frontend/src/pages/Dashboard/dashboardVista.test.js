import assert from "node:assert/strict";
import { test } from "node:test";

import {
  construirResumenActual,
  construirTarjetas,
  crearEscala,
  describirRecaudacion,
  etiquetaMes,
  formatearMonedaCOP,
  formatearNumero,
  posicionBarraVertical,
  prepararSeries,
  puedeMostrarResumenInferior,
  resolverSeccion,
} from "./dashboardVista.js";

const sinEspacios = (valor) =>
  String(valor).replace(/\u00a0/g, " ");

const metricasPeriodo = {
  ganancia_bruta: 540000,
  total_vendido: 850000,
  devoluciones: 50000,
  recaudacion: {
    disponible: true,
    importe: 450000,
    motivo: null,
  },
  unidades_por_producto: [
    {
      producto_id: 2,
      producto_nombre: "Perfume B",
      unidades: 4,
    },
    {
      producto_id: 1,
      producto_nombre: "Perfume A",
      unidades: 3,
    },
  ],
  ganancia_por_producto: [
    {
      producto_id: 1,
      producto_nombre: "Perfume A",
      ganancia: 300000,
    },
    {
      producto_id: 2,
      producto_nombre: "Perfume B",
      ganancia: 240000,
    },
  ],
  ganancias_mensuales: [
    { mes: "2026-05", ganancia: 0 },
    { mes: "2026-06", ganancia: 0 },
    { mes: "2026-07", ganancia: 0 },
    { mes: "2026-08", ganancia: 0 },
    { mes: "2026-09", ganancia: 100000 },
    { mes: "2026-10", ganancia: 540000 },
  ],
};

const metricasActuales = {
  saldo_por_cobrar: 450000,
  clientes_con_deudas: 2,
  clientes_registrados: 3,
  pedidos_pendientes: 1,
  pedidos_por_comprar: 2,
  saldo_pedidos_por_comprar: 20000,
  pedidos_confirmados_sin_venta: 3,
};

test("formatea importes COP y cantidades de forma distinta", () => {
  assert.equal(
    sinEspacios(formatearMonedaCOP(1234567)),
    "$ 1.234.567",
  );
  assert.equal(sinEspacios(formatearMonedaCOP(0)), "$ 0");
  assert.equal(formatearMonedaCOP(null), "—");
  assert.equal(formatearMonedaCOP(undefined), "—");
  assert.equal(formatearNumero(1234), "1.234");
  assert.equal(formatearNumero(null), "—");
});

test("construye las seis tarjetas con los campos del endpoint", () => {
  const tarjetas = construirTarjetas({
    metricas_periodo: metricasPeriodo,
    metricas_actuales: metricasActuales,
  });

  assert.equal(tarjetas.length, 6);
  assert.deepEqual(
    tarjetas.map((tarjeta) => tarjeta.titulo),
    [
      "Ganancia bruta del mes",
      "Total recaudado en el periodo",
      "Total vendido durante el mes",
      "Devoluciones del periodo",
      "Pedidos pendientes de compra",
      "Clientes con deudas",
    ],
  );
  assert.equal(
    sinEspacios(tarjetas[0].valor),
    "$ 540.000",
  );
  assert.equal(
    sinEspacios(tarjetas[1].valor),
    "$ 450.000",
  );
  assert.equal(
    sinEspacios(tarjetas[2].valor),
    "$ 850.000",
  );
  assert.equal(
    sinEspacios(tarjetas[3].valor),
    "$ 50.000",
  );
  assert.equal(tarjetas[4].valor, "3");
  assert.equal(tarjetas[4].tipo, "cantidad");
  assert.equal(tarjetas[4].sufijo, "pedidos");
  assert.equal(
    sinEspacios(tarjetas[4].nota),
    "$ 20.000 pendiente de compra",
  );
  assert.equal(tarjetas[5].valor, "2");
  assert.equal(tarjetas[5].tipo, "cantidad");
  assert.equal(tarjetas[5].sufijo, "clientes");
  assert.equal(
    sinEspacios(tarjetas[5].nota),
    "$ 450.000 por cobrar en ventas",
  );
});

test("muestra la recaudación disponible con su importe real", () => {
  const resultado = describirRecaudacion({
    disponible: true,
    importe: 450000,
    motivo: null,
  });

  assert.equal(resultado.disponible, true);
  assert.equal(sinEspacios(resultado.valor), "$ 450.000");
  assert.equal(resultado.esCero, false);
});

test("acepta el cero legítimo cuando la recaudación está disponible", () => {
  const resultado = describirRecaudacion({
    disponible: true,
    importe: 0,
    motivo: null,
  });

  assert.equal(resultado.disponible, true);
  assert.equal(sinEspacios(resultado.valor), "$ 0");
  assert.equal(resultado.esCero, true);
});

test("no convierte una recaudación no disponible en cero", () => {
  const resultado = describirRecaudacion({
    disponible: false,
    importe: null,
    motivo:
      "La recaudación no se puede certificar porque existen ventas con pagos no registrados o datos inconsistentes.",
  });

  assert.equal(resultado.disponible, false);
  assert.equal(resultado.valor, "No disponible");
  assert.equal(resultado.esCero, false);
  assert.doesNotMatch(resultado.detalle, /\$ 0/);
  assert.match(resultado.detalle, /No hay información de pagos/);
});

test("no convierte un importe nulo disponible en cero", () => {
  const resultado = describirRecaudacion({
    disponible: true,
    importe: null,
    motivo: null,
  });

  assert.equal(resultado.valor, "—");
  assert.equal(resultado.esCero, false);
});

test("prepara las tres series sin mezclar unidades con ganancias", () => {
  const series = prepararSeries(metricasPeriodo);

  assert.deepEqual(
    series.unidades.map((item) => item.textoValor),
    ["4 und.", "3 und."],
  );
  assert.deepEqual(
    series.gananciasProducto.map((item) =>
      sinEspacios(item.textoValor),
    ),
    ["$ 300.000", "$ 240.000"],
  );
  assert.deepEqual(
    series.gananciasMensuales.map((item) => item.etiqueta),
    ["May", "Jun", "Jul", "Ago", "Sept", "Oct"],
  );
  assert.equal(
    series.gananciasMensuales[5].etiquetaLarga,
    "octubre de 2026",
  );
  assert.equal(series.gananciasMensuales[5].valor, 540000);
});

test("construye el resumen actual independiente del periodo", () => {
  const resumen = construirResumenActual(metricasActuales);

  assert.equal(resumen[0].etiqueta, "Saldo por cobrar de ventas");
  assert.equal(
    sinEspacios(resumen[0].valor),
    "$ 450.000",
  );
  assert.equal(resumen[1].etiqueta, "Saldo de pedidos por comprar");
  assert.equal(
    sinEspacios(resumen[1].valor),
    "$ 20.000",
  );
  assert.equal(resumen[2].valor, "3");
  assert.equal(resumen[2].sufijo, "clientes");
  assert.equal(resumen[3].valor, "1");
  assert.equal(resumen[3].sufijo, "pedido");
  assert.equal(resumen[4].valor, "3");
  assert.equal(resumen[4].sufijo, "pedidos");
});

test("maneja la ausencia de datos sin inventar importes", () => {
  const tarjetas = construirTarjetas();
  const series = prepararSeries();

  assert.equal(tarjetas[0].valor, "—");
  assert.equal(tarjetas[2].valor, "—");
  assert.equal(tarjetas[1].valor, "No disponible");
  assert.equal(tarjetas[3].valor, "—");
  assert.equal(tarjetas[4].valor, "—");
  assert.equal(tarjetas[5].valor, "—");
  assert.deepEqual(series.unidades, []);
  assert.deepEqual(series.gananciasProducto, []);
  assert.deepEqual(series.gananciasMensuales, []);
  assert.equal(describirRecaudacion(undefined).valor, "No disponible");
});

test("mantiene el acceso al Dashboard restringido a administradores", () => {
  assert.equal(resolverSeccion("Dashboard", true), "Dashboard");
  assert.equal(resolverSeccion("Pedidos", true), "Pedidos");
  assert.equal(resolverSeccion("Dashboard", false), "Ventas");
  assert.equal(resolverSeccion("Catálogo", false), "Ventas");
  assert.equal(resolverSeccion("Clientes", false), "Clientes");
});

test("crea escalas con etiquetas legibles para unidades y COP", () => {
  const unidades = crearEscala([4, 3], {
    formatear: formatearNumero,
    enteros: true,
  });
  const moneda = crearEscala([0, 540000]);

  assert.deepEqual(unidades.ticks, [0, 1, 2, 3, 4]);
  assert.deepEqual(unidades.etiquetas, ["0", "1", "2", "3", "4"]);
  assert.equal(moneda.minimo, 0);
  assert.ok(moneda.maximo >= 540000);
  assert.ok(moneda.ticks.includes(0));
});

test("incluye valores negativos en la escala y en la barra vertical", () => {
  const escala = crearEscala([-50000, 300000]);
  const barraNegativa = posicionBarraVertical(
    -50000,
    escala.minimo,
    escala.maximo,
  );
  const barraPositiva = posicionBarraVertical(
    300000,
    escala.minimo,
    escala.maximo,
  );

  assert.ok(escala.minimo < 0);
  assert.ok(escala.maximo > 0);
  assert.ok(barraNegativa.negativa);
  assert.ok(barraNegativa.altura > 0);
  assert.ok(barraNegativa.inferior >= 0);
  assert.equal(barraPositiva.negativa, false);
  assert.ok(barraPositiva.altura > 0);
});

test("oculta el resumen inferior durante la carga o tras un error", () => {
  const datosCompletos = {
    resumenPeriodo: {},
    metricasActuales: { saldo_por_cobrar: 1 },
  };

  assert.equal(
    puedeMostrarResumenInferior({
      cargando: false,
      error: "",
      ...datosCompletos,
    }),
    true,
  );

  assert.equal(
    puedeMostrarResumenInferior({
      cargando: false,
      error: "No se pudo cargar el Dashboard.",
      ...datosCompletos,
    }),
    false,
  );

  assert.equal(
    puedeMostrarResumenInferior({
      cargando: true,
      error: "",
      resumenPeriodo: null,
      metricasActuales: { saldo_por_cobrar: 1 },
    }),
    false,
  );

  assert.equal(
    puedeMostrarResumenInferior({
      cargando: false,
      error: "",
      resumenPeriodo: {},
      metricasActuales: null,
    }),
    false,
  );
});

test("etiqueta meses válidos y conserva valores desconocidos", () => {
  assert.equal(etiquetaMes("2026-10"), "octubre de 2026");
  assert.equal(etiquetaMes("sin-mes"), "sin-mes");
});

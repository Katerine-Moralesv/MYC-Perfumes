import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { ApiError, api } from "./api.js";
import { limpiarCacheAdmin } from "./adminCache.js";
import {
  obtenerResumenDashboard,
  validarMesDashboard,
} from "./dashboardMetricas.js";

const getOriginal = api.get;

const resumen = {
  periodo: {
    mes: "2026-10",
    fecha_inicio: "2026-10-01",
    fecha_fin_exclusiva: "2026-11-01",
  },
  moneda: "COP",
  metricas_periodo: {
    ganancia_bruta: 540000,
    total_vendido: 850000,
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
    ],
    ganancia_por_producto: [
      {
        producto_id: 1,
        producto_nombre: "Perfume A",
        ganancia: 300000,
      },
    ],
    ganancias_mensuales: [
      { mes: "2026-10", ganancia: 540000 },
    ],
  },
  metricas_actuales: {
    saldo_por_cobrar: 450000,
    clientes_con_deudas: 2,
    clientes_registrados: 3,
    pedidos_pendientes: 3,
  },
  pedidos_recientes: [
    {
      id: 10,
      cliente_nombre: "Clienta uno",
      total: 10000,
      estado: "pendiente",
      creado_en: "2026-10-01T10:00:00-05:00",
    },
  ],
};

beforeEach(() => {
  api.get = getOriginal;
  limpiarCacheAdmin();
});

afterEach(() => {
  api.get = getOriginal;
  limpiarCacheAdmin();
});

test("consume el endpoint agregado con el mes seleccionado", async () => {
  let solicitud = null;

  api.get = async (url, config) => {
    solicitud = { url, config };
    return { data: resumen };
  };

  const datos = await obtenerResumenDashboard("2026-10");

  assert.equal(
    solicitud.url,
    "/finanzas/reportes/dashboard/",
  );
  assert.deepEqual(solicitud.config.params, { mes: "2026-10" });
  assert.equal(datos, resumen);
});

test("cancela la espera del periodo sin romper la caché", async () => {
  const controlador = new AbortController();
  let resolver = null;
  let iniciar = null;
  const iniciado = new Promise((resolve) => {
    iniciar = resolve;
  });

  api.get = () =>
    new Promise((resolve) => {
      resolver = resolve;
      iniciar();
    });

  const promesa = obtenerResumenDashboard("2026-10", {
    signal: controlador.signal,
  });

  await iniciado;
  controlador.abort();

  await assert.rejects(
    promesa,
    (error) => error?.isCanceled === true,
  );

  resolver({ data: resumen });
});

test("rechaza periodos con formato inválido antes de llamar a la API", async () => {
  let llamadas = 0;

  api.get = async () => {
    llamadas += 1;
    return { data: resumen };
  };

  for (const mes of ["", "2026-13", "2026-1", "octubre", null]) {
    await assert.rejects(
      obtenerResumenDashboard(mes),
      /YYYY-MM/,
    );
  }

  assert.equal(llamadas, 0);
  assert.throws(() => validarMesDashboard("2026-00"), /YYYY-MM/);
  assert.equal(validarMesDashboard("2026-01"), "2026-01");
});

test("propaga los errores de permisos del endpoint", async () => {
  const error = new ApiError({
    status: 403,
    message: "No tienes permisos para realizar esta acción.",
  });

  api.get = async () => {
    throw error;
  };

  await assert.rejects(
    obtenerResumenDashboard("2026-10"),
    /permisos/,
  );
});

test("conserva la recaudación no disponible sin convertirla en cero", async () => {
  api.get = async () => ({
    data: {
      ...resumen,
      metricas_periodo: {
        ...resumen.metricas_periodo,
        recaudacion: {
          disponible: false,
          importe: null,
          motivo:
            "La recaudación no se puede certificar porque existen ventas con pagos no registrados o datos inconsistentes.",
        },
      },
    },
  });

  const datos = await obtenerResumenDashboard("2026-10");

  assert.equal(
    datos.metricas_periodo.recaudacion.disponible,
    false,
  );
  assert.equal(
    datos.metricas_periodo.recaudacion.importe,
    null,
  );
  assert.ok(datos.metricas_periodo.recaudacion.motivo);
});

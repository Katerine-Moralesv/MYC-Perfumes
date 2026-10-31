import { api } from "./api.js";

const PATRON_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export function validarMesDashboard(mes) {
  const texto = String(mes ?? "").trim();

  if (!PATRON_MES.test(texto)) {
    throw new Error("El periodo debe tener el formato YYYY-MM.");
  }

  return texto;
}

export async function obtenerResumenDashboard(mes, { signal } = {}) {
  const periodo = validarMesDashboard(mes);
  const respuesta = await api.get("/finanzas/reportes/dashboard/", {
    params: { mes: periodo },
    signal,
  });

  return respuesta.data;
}

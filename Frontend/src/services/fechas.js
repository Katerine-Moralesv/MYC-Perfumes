const ZONA_HORARIA_NEGOCIO = "America/Bogota";

export function fechaActualColombia(instante = new Date()) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONA_HORARIA_NEGOCIO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instante);

  const valores = Object.fromEntries(
    partes.map((parte) => [parte.type, parte.value]),
  );

  return `${valores.year}-${valores.month}-${valores.day}`;
}

export function esFechaISO(fecha) {
  const valor = String(fecha ?? "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return false;
  }

  const [anio, mes, dia] = valor
    .split("-")
    .map(Number);
  const fechaLocal = new Date(anio, mes - 1, dia, 12);

  return (
    fechaLocal.getFullYear() === anio &&
    fechaLocal.getMonth() === mes - 1 &&
    fechaLocal.getDate() === dia
  );
}

export function esFechaFutura(
  fecha,
  hoy = fechaActualColombia(),
) {
  return esFechaISO(fecha) && fecha > hoy;
}

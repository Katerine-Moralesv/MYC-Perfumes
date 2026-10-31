import assert from "node:assert/strict";
import { test } from "node:test";

import {
  esFechaFutura,
  esFechaISO,
  fechaActualColombia,
} from "./fechas.js";

test("usa el día colombiano en los límites de medianoche", () => {
  assert.equal(
    fechaActualColombia(
      new Date("2026-10-29T04:59:00.000Z"),
    ),
    "2026-10-28",
  );
  assert.equal(
    fechaActualColombia(
      new Date("2026-10-29T05:00:00.000Z"),
    ),
    "2026-10-29",
  );
});

test("conserva exactamente una fecha ISO elegida", () => {
  assert.equal(esFechaISO("2026-10-28"), true);
  assert.equal(esFechaISO("2026-02-30"), false);
  assert.equal(esFechaISO("28-10-2026"), false);
});

test("compara fechas futuras contra el día colombiano", () => {
  const hoy = "2026-10-28";

  assert.equal(esFechaFutura(hoy, hoy), false);
  assert.equal(esFechaFutura("2026-10-27", hoy), false);
  assert.equal(esFechaFutura("2026-10-29", hoy), true);
});

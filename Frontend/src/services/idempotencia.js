export function crearClaveIdempotencia(prefijo = "operacion") {
  if (
    typeof globalThis.crypto?.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  return `${prefijo}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function detalleCompatibleConPresentacion(
  detalle,
  presentacionCompra,
  presentacionPedido = null,
) {
  if (!detalle || !presentacionCompra) return false;

  const productoCompra = Number(presentacionCompra.producto);
  const productoPedido = Number(
    detalle.producto ?? presentacionPedido?.producto,
  );
  const porcentajeCompra = Number(presentacionCompra.porcentaje);
  const porcentajePedido = Number(detalle.porcentaje_recarga);

  if (
    !Number.isInteger(productoCompra) ||
    productoCompra <= 0 ||
    productoCompra !== productoPedido
  ) {
    return false;
  }

  if (
    !Number.isInteger(porcentajeCompra) ||
    porcentajeCompra !== porcentajePedido
  ) {
    return false;
  }

  if (
    detalle.presentacion != null &&
    String(detalle.presentacion) !== String(presentacionCompra.id)
  ) {
    return false;
  }

  return true;
}

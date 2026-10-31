from django.urls import path
from apps.finanzas import views

urlpatterns = [
    path("clientes/", views.ClienteListCreateView.as_view(), name="cliente-list-create"),
    path("clientes/resumen/", views.ClienteResumenView.as_view(), name="cliente-resumen"),
    path("clientes/<int:cliente_id>/resumen/", views.ClienteResumenDetailView.as_view(), name="cliente-resumen-detail"),
    path("proveedores/", views.ProveedorListCreateView.as_view(), name="proveedor-list-create"),
    path("proveedores/<int:pk>/", views.ProveedorDetailView.as_view(), name="proveedor-detail"),

    path("compras/", views.CompraListView.as_view(), name="compra-list"),
    path("compras/registrar/", views.CompraCreateView.as_view(), name="compra-create"),
    path("compras/<int:compra_id>/recibir/", views.CompraRecepcionView.as_view(), name="compra-recepcion"),

    path("ventas/", views.VentaListView.as_view(), name="venta-list"),
    path("ventas/registrar/", views.VentaCreateView.as_view(), name="venta-create"),
    path("ventas/<int:venta_id>/", views.VentaDetailView.as_view(), name="venta-detail"),
    path("ventas/<int:venta_id>/abonos/", views.AbonoCreateView.as_view(), name="abono-create"),

    path("reportes/dashboard/", views.ReporteDashboardView.as_view(), name="reporte-dashboard"),
    path("reportes/ganancia-por-producto/", views.ReporteGananciaPorProductoView.as_view(), name="reporte-ganancia-producto"),
    path("reportes/resumen-mensual/", views.ReporteResumenMensualView.as_view(), name="reporte-resumen-mensual"),
    path("reportes/balance/", views.ReporteBalanceView.as_view(), name="reporte-balance"),
    path("reportes/clientes-con-saldo/", views.ReporteClientesConSaldoView.as_view(), name="reporte-clientes-saldo"),
]
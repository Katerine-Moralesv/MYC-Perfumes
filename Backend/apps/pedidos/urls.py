from django.urls import path
from apps.pedidos import views

urlpatterns = [
    path("webhook/", views.WebhookPedidoView.as_view(), name="pedido-webhook"),
    path("tienda/", views.RegistrarPedidoTiendaView.as_view(), name="pedido-tienda"),
    path("", views.PedidoListView.as_view(), name="pedido-list"),
    path("<int:pedido_id>/confirmar/", views.ConfirmarPedidoView.as_view(), name="pedido-confirmar"),
    path("<int:pedido_id>/rechazar/", views.RechazarPedidoView.as_view(), name="pedido-rechazar"),
    path("<int:pedido_id>/anticipos/", views.AnticipoCreateView.as_view(), name="pedido-anticipo"),
    path("<int:pedido_id>/venta/", views.CompletarVentaPedidoView.as_view(), name="pedido-venta"),
    path("<int:pedido_id>/cancelar/", views.CancelarPedidoView.as_view(), name="pedido-cancelar"),
    path("<int:pedido_id>/estado/", views.EstadoPedidoView.as_view(), name="pedido-estado"),
]

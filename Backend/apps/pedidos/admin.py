from django.contrib import admin
from apps.pedidos.models import Pedido, DetallePedido

admin.site.register(Pedido)
admin.site.register(DetallePedido)

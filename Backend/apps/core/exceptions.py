class ReglaNegocioError(Exception):
    def __init__(self, mensaje: str):
        self.mensaje = mensaje
        super().__init__(mensaje)


class RecursoNoEncontradoError(Exception):
    def __init__(self, mensaje: str = "Recurso no encontrado."):
        self.mensaje = mensaje
        super().__init__(mensaje)


class ConflictoError(Exception):
    def __init__(self, mensaje: str):
        self.mensaje = mensaje
        super().__init__(mensaje)
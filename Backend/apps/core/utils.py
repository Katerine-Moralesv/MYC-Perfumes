import re


def normalizar_telefono(valor: str) -> str:
    """
    Deja solo dígitos y antepone +57 si parece un celular colombiano
    de 10 dígitos sin indicativo. Útil porque tanto 'finanzas' (Cliente)
    como 'pedidos' (tienda y webhook) reciben teléfonos en formatos
    distintos y necesitan compararlos de forma consistente.
    """
    if not valor:
        return ""
    solo_digitos = re.sub(r"\D", "", valor)
    if len(solo_digitos) == 10 and solo_digitos.startswith("3"):
        return f"+57{solo_digitos}"
    if solo_digitos.startswith("57") and len(solo_digitos) == 12:
        return f"+{solo_digitos}"
    return solo_digitos

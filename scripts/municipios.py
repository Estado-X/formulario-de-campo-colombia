"""Descarga la lista de municipios (DIVIPOLA) del DANE desde datos.gov.co
y la deja en data/municipios.json, lista para el autocompletado.

Uso:  python scripts/municipios.py
Solo usa la biblioteca estándar de Python. No necesita clave.
Fuente: «DIVIPOLA- Códigos municipios», DANE, en Datos Abiertos Colombia.
https://www.datos.gov.co/d/gdxc-w37w  (licencia CC BY-SA 4.0)
"""
import datetime
import json
import pathlib
import re
import urllib.request

CONJUNTO = "gdxc-w37w"
BASE = "https://www.datos.gov.co"
SALIDA = pathlib.Path(__file__).resolve().parent.parent / "data" / "municipios.json"
MINUSCULAS = {"de", "del", "la", "las", "los", "el", "y", "e"}


def leer(url):
    pedido = urllib.request.Request(url, headers={"User-Agent": "formulario-de-campo-colombia"})
    with urllib.request.urlopen(pedido, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def nombre(texto):
    """MEDELLÍN -> Medellín · SANTA FE DE ANTIOQUIA -> Santa Fe de Antioquia · BOGOTÁ, D.C. -> Bogotá, D.C."""
    texto = re.sub(r"\s+", " ", texto.strip())

    def palabra(m):
        p = m.group(0)
        if "." in p:  # siglas como D.C.
            return p.upper()
        bajo = p.lower()
        if bajo in MINUSCULAS and m.start() > 0 and texto[m.start() - 1] != "(":
            return bajo
        return bajo[:1].upper() + bajo[1:]

    return re.sub(r"[^\s(),\-]+", palabra, texto)


def main():
    meta = leer(f"{BASE}/api/views/{CONJUNTO}.json")
    filas = leer(f"{BASE}/resource/{CONJUNTO}.json?$limit=5000&$order=cod_mpio")
    municipios = []
    for f in filas:
        codigo = f["cod_mpio"].strip()
        if not re.fullmatch(r"\d{5}", codigo):
            raise SystemExit(f"Código inesperado: {codigo!r}")
        municipios.append([codigo, nombre(f["nom_mpio"]), nombre(f["dpto"])])
    if len(municipios) < 1100 or len({m[0] for m in municipios}) != len(municipios):
        raise SystemExit(f"La lista no parece completa ({len(municipios)} filas). No se guardó.")
    actualizado = datetime.datetime.fromtimestamp(meta["rowsUpdatedAt"], datetime.timezone.utc)
    datos = {
        "fuente": "DIVIPOLA- Códigos municipios · Departamento Administrativo Nacional de Estadística (DANE)",
        "url": f"{BASE}/d/{CONJUNTO}",
        "licencia": "CC BY-SA 4.0",
        "nota_del_dane": re.sub(r"\s+", " ", meta.get("description", "")).strip(),
        "datos_actualizados": actualizado.strftime("%d/%m/%Y"),
        "consultado": datetime.date.today().strftime("%d/%m/%Y"),
        "cambios": "Nombres pasados de MAYÚSCULAS a mayúscula inicial; se dejaron solo código, municipio y departamento.",
        "columnas": ["codigo", "municipio", "departamento"],
        "municipios": municipios,
    }
    texto = json.dumps(datos, ensure_ascii=False, separators=(",", ":"))
    texto = texto.replace('"municipios":[', '"municipios":[\n').replace("],[", "],\n[")
    SALIDA.write_text(texto + "\n", encoding="utf-8", newline="\n")
    print(f"{len(municipios)} municipios y áreas guardados en {SALIDA.name}")


if __name__ == "__main__":
    main()

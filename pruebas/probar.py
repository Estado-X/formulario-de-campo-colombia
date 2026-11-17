"""Pruebas del formulario de campo, de punta a punta, en un navegador de verdad.

    pip install playwright openpyxl
    playwright install chromium
    python pruebas/probar.py

Sirve el repo en http://127.0.0.1:<puerto>/formulario-de-campo-colombia/ (la misma subruta
que tendrá en GitHub Pages) y revisa: carga sin errores, validaciones, uso sin conexión,
registros que sobreviven a recargar, editor y JSON, Excel y CSV, borrado, celular y teclado.
"""
import csv
import functools
import http.server
import io
import json
import pathlib
import re
import sys
import tempfile
import threading
import zipfile

import openpyxl
from playwright.sync_api import expect, sync_playwright

RAIZ = pathlib.Path(__file__).resolve().parent.parent
SUBRUTA = "/formulario-de-campo-colombia/"
ESTADO = {"version_sw": None}  # para simular que se publicó una versión nueva


class Servidor(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def translate_path(self, path):
        limpio = path.split("?", 1)[0].split("#", 1)[0]
        if not limpio.startswith(SUBRUTA):
            return str(RAIZ / "__no_existe__")
        return super().translate_path("/" + limpio[len(SUBRUTA):])

    def do_GET(self):
        if ESTADO["version_sw"] and self.path.split("?", 1)[0] == SUBRUTA + "sw.js":
            texto = (RAIZ / "sw.js").read_text(encoding="utf-8")
            texto = re.sub(r"var VERSION = '[^']+';", "var VERSION = '%s';" % ESTADO["version_sw"], texto)
            datos = texto.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript")
            self.send_header("Content-Length", str(len(datos)))
            self.end_headers()
            self.wfile.write(datos)
            return
        super().do_GET()


def servir():
    manejador = functools.partial(Servidor, directory=str(RAIZ))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), manejador)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, "http://127.0.0.1:%d%s" % (srv.server_address[1], SUBRUTA)


# ---------- Ayudas ----------
class Sesion:
    """Un navegador limpio (sin registros ni caché) con los errores de consola a la vista."""

    def __init__(self, navegador, base, ancho=390, alto=844):
        self.base = base
        self.ctx = navegador.new_context(viewport={"width": ancho, "height": alto}, locale="es-CO",
                                         timezone_id="America/Bogota", accept_downloads=True)
        self.errores = []
        self.pedidos = []
        self.page = self.ctx.new_page()
        self.page.on("console", lambda m: self.errores.append(m.text) if m.type == "error" else None)
        self.page.on("pageerror", lambda e: self.errores.append(str(e)))
        self.page.on("request", lambda r: self.pedidos.append(r.url))

    def abrir(self, vista="registrar"):
        self.page.goto(self.base + "#" + vista)
        self.page.wait_for_selector("html[data-lista='si']")
        return self.page

    def esperar_sw(self):
        self.page.evaluate("() => navigator.serviceWorker.ready.then(() => new Promise(ok => {"
                           " if (navigator.serviceWorker.controller) ok();"
                           " else navigator.serviceWorker.addEventListener('controllerchange', () => ok()); }))")

    def cerrar(self):
        self.ctx.close()


PERSONA = {
    "nombres": "María José", "apellidos": "Pérez Gómez", "tipo": "CC", "documento": "1032456789",
    "nacimiento": "05/03/1990", "sexo": "Mujer", "municipio": "Medellín, Antioquia", "vereda": "Santa Elena", "telefono": "3001234567",
}


def llenar(page, **cambios):
    d = dict(PERSONA, **cambios)
    page.fill("#c-nombres", d["nombres"])
    page.fill("#c-apellidos", d["apellidos"])
    if d["tipo"]:
        page.locator("[data-campo='tipo_documento'] .chip", has_text=re.compile("^%s$" % d["tipo"])).click()
    page.fill("#c-numero_documento", d["documento"])
    page.fill("#c-fecha_nacimiento", d["nacimiento"])
    if d["sexo"]:
        page.locator("[data-campo='sexo'] .chip", has_text=d["sexo"]).click()
    page.fill("#c-municipio", d["municipio"])
    page.fill("#c-vereda_barrio", d["vereda"])
    page.fill("#c-telefono", d["telefono"])
    if d.get("autoriza", True):
        page.check("#autorizo")


def guardar(page, **cambios):
    llenar(page, **cambios)
    page.click("#btn-guardar")
    expect(page.locator("#msg-registrar")).to_contain_text("Registro guardado")


def total(page):
    return int(page.locator("#n-total").text_content())


# ---------- Pruebas ----------
def prueba_carga_limpia(nav, base):
    s = Sesion(nav, base)
    s.page.goto(base)
    s.page.wait_for_selector("html[data-lista='si']")
    # Primera visita: se presenta la herramienta.
    expect(s.page.locator("#vista-acerca")).to_be_visible()
    expect(s.page.locator("#t-acerca")).to_have_text("Formulario de campo")
    expect(s.page.locator("#estado-listo")).to_contain_text("Lista para usar sin conexión")
    for vista in ("registrar", "registros", "formulario", "acerca"):
        s.page.click(".pestanas a[data-vista='%s']" % vista)
        expect(s.page.locator("#vista-" + vista)).to_be_visible()
    assert s.errores == [], s.errores
    fuera = [u for u in s.pedidos if not u.startswith(base) and not u.startswith("data:") and not u.startswith("blob:")]
    assert fuera == [], "La página pidió algo fuera de su carpeta: %s" % fuera
    assert s.page.locator("meta[charset]").get_attribute("charset").lower() == "utf-8"
    assert s.page.evaluate("document.querySelectorAll('[style]').length") == 0
    s.cerrar()


def prueba_validaciones(nav, base):
    s = Sesion(nav, base)
    page = s.abrir()
    page.click("#btn-guardar")
    expect(page.locator("#err-resumen")).to_contain_text("Faltan 7 datos")
    for campo in ("nombres", "apellidos", "tipo_documento", "numero_documento", "fecha_nacimiento", "municipio"):
        expect(page.locator("#err-" + campo)).to_be_visible()
    expect(page.locator("#err-sexo")).to_be_hidden()
    expect(page.locator("#err-autorizo")).to_contain_text("autorización")
    assert page.evaluate("document.activeElement.id") == "c-nombres"
    assert page.get_attribute("#c-nombres", "aria-invalid") == "true"

    casos = [
        (dict(documento="12AB34"), "numero_documento", "solo números"),
        (dict(documento="12345678901"), "numero_documento", "máximo 10"),
        (dict(tipo="TI", documento="12345"), "numero_documento", "10 u 11"),
        (dict(nacimiento="31/02/1990"), "fecha_nacimiento", "no existe"),
        (dict(nacimiento="01/01/2999"), "fecha_nacimiento", "futura"),
        (dict(nacimiento="1990"), "fecha_nacimiento", "no existe"),
        (dict(telefono="30012"), "telefono", "10 números"),
        (dict(telefono="300abc4567"), "telefono", "solo números"),
    ]
    for cambios, campo, texto in casos:
        llenar(page, **cambios)
        page.click("#btn-guardar")
        expect(page.locator("#err-" + campo)).to_contain_text(texto)
        expect(page.locator("#err-resumen")).to_contain_text("Falta revisar un dato")
        assert total(page) == 0

    # Sin autorización no se guarda.
    llenar(page)
    page.uncheck("#autorizo")
    page.click("#btn-guardar")
    expect(page.locator("#err-autorizo")).to_be_visible()
    assert total(page) == 0

    # «Otro» documento sí acepta letras; la fecha se arma sola al escribir.
    llenar(page, tipo="Otro", documento="ab123456", nacimiento="")
    page.locator("#c-fecha_nacimiento").press_sequentially("05031990")
    assert page.input_value("#c-fecha_nacimiento") == "05/03/1990"
    page.click("#btn-guardar")
    expect(page.locator("#msg-registrar")).to_contain_text("Hoy van 1")
    assert total(page) == 1
    assert page.input_value("#c-nombres") == ""
    assert not page.is_checked("#autorizo")
    assert s.errores == [], s.errores
    s.cerrar()


def prueba_municipios(nav, base):
    s = Sesion(nav, base)
    page = s.abrir()
    page.locator("#c-municipio").press_sequentially("medel")
    opciones = page.locator("#lista-municipio [role='option']")
    expect(opciones.first).to_contain_text("Medellín")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")
    assert page.input_value("#c-municipio") == "Medellín, Antioquia"
    expect(page.locator("#lista-municipio")).to_be_hidden()
    # Sin tildes y con un nombre repetido en varios departamentos.
    page.fill("#c-municipio", "")
    page.locator("#c-municipio").press_sequentially("la union")
    assert opciones.count() >= 4
    opciones.filter(has_text="Nariño").dispatch_event("pointerdown")
    assert page.input_value("#c-municipio") == "La Unión, Nariño"
    datos = json.loads((RAIZ / "data" / "municipios.json").read_text(encoding="utf-8"))
    assert len(datos["municipios"]) >= 1100 and "datos.gov.co" in datos["url"] and datos["consultado"]
    s.cerrar()


def prueba_sin_conexion_y_recarga(nav, base):
    s = Sesion(nav, base)
    page = s.abrir()
    s.esperar_sw()
    guardar(page)
    page.reload()
    page.wait_for_selector("html[data-lista='si']")
    assert total(page) == 1, "El registro no sobrevivió a recargar"

    s.ctx.set_offline(True)
    s.pedidos.clear()
    page.reload()
    page.wait_for_selector("html[data-lista='si']")
    expect(page.locator("#red-texto")).to_have_text("Sin conexión: tus registros se guardan en este celular")
    assert total(page) == 1
    # Sin señal: los municipios siguen ahí y se puede guardar.
    page.locator("#c-municipio").press_sequentially("quibd")
    expect(page.locator("#lista-municipio [role='option']").first).to_contain_text("Quibdó")
    guardar(page, documento="52123456", nombres="Ana", municipio="Quibdó, Chocó")
    assert total(page) == 2
    # También se abre sin señal la dirección sin «index.html» y con parámetros.
    page.goto(base + "?desde=icono#registros")
    page.wait_for_selector("html[data-lista='si']")
    expect(page.locator(".reg")).to_have_count(2)
    # Y se puede exportar sin señal.
    with page.expect_download() as d:
        page.click("#btn-excel")
    assert d.value.suggested_filename.endswith(".xlsx")
    s.ctx.set_offline(False)
    page.evaluate("window.dispatchEvent(new Event('online'))")
    expect(page.locator("#red-texto")).to_contain_text("Con conexión")
    assert s.errores == [], s.errores
    s.cerrar()


def prueba_repetido_editar_borrar(nav, base):
    s = Sesion(nav, base)
    page = s.abrir()
    guardar(page)
    llenar(page, nombres="Otra persona")
    page.click("#btn-guardar")
    expect(page.locator("#repetido")).to_be_visible()
    expect(page.locator("#repetido-texto")).to_contain_text("María José Pérez Gómez")
    page.click("#btn-repetido-no")
    assert total(page) == 1
    page.click("#btn-guardar")
    page.click("#btn-repetido-si")
    expect(page.locator("#msg-registrar")).to_contain_text("Hoy van 2")

    page.click(".pestanas a[data-vista='registros']")
    expect(page.locator("#conteo-hoy")).to_contain_text("2 registros")
    expect(page.locator(".reg")).to_have_count(2)
    # Editar
    page.locator(".reg", has_text="Otra persona").get_by_role("button", name=re.compile("^Editar")).click()
    expect(page.locator("#vista-registrar")).to_be_visible()
    assert page.input_value("#c-nombres") == "Otra persona"
    assert page.input_value("#c-fecha_nacimiento") == "05/03/1990"
    assert page.is_checked("[data-campo='tipo_documento'] input[value='CC']")
    page.fill("#c-nombres", "Luisa Fernanda")
    page.fill("#c-numero_documento", "79888777")
    page.click("#btn-guardar")
    expect(page.locator("#msg-registrar")).to_have_text("Cambios guardados.")
    assert total(page) == 2
    page.click(".pestanas a[data-vista='registros']")
    expect(page.locator(".reg", has_text="Luisa Fernanda")).to_have_count(1)
    expect(page.locator(".reg", has_text="CC 79888777")).to_have_count(1)
    # Borrar, con la confirmación de la propia página
    fila = page.locator(".reg", has_text="Luisa Fernanda")
    fila.get_by_role("button", name=re.compile("^Borrar")).click()
    fila.get_by_role("button", name="No").click()
    expect(page.locator(".reg")).to_have_count(2)
    fila.get_by_role("button", name=re.compile("^Borrar")).click()
    fila.get_by_role("button", name="Sí, borrar").click()
    expect(page.locator(".reg")).to_have_count(1)
    expect(page.locator("#msg-registros")).to_have_text("Registro borrado.")
    page.reload()
    page.wait_for_selector("html[data-lista='si']")
    assert total(page) == 1
    assert s.errores == [], s.errores
    s.cerrar()


def prueba_editor_y_json(nav, base):
    s = Sesion(nav, base, ancho=1280, alto=900)
    page = s.abrir("formulario")
    campos = page.locator("#ed-campos > li")
    expect(campos).to_have_count(9)
    # Renombrar, agregar dos campos, ordenar y quitar.
    page.fill("#ed-titulo", "Asistencia al taller")
    campos.nth(7).locator("[data-ed='etiqueta']").fill("Vereda")
    page.click("#btn-agregar")
    expect(campos).to_have_count(10)
    nuevo = campos.nth(9)
    assert page.evaluate("document.activeElement.getAttribute('data-ed')") == "etiqueta"
    nuevo.locator("[data-ed='etiqueta']").fill("Organización")
    nuevo.locator("[data-ed='obligatorio']").check()
    page.click("#btn-agregar")
    opc = campos.nth(10)
    opc.locator("[data-ed='etiqueta']").fill("Rol en el proyecto")
    opc.locator("[data-ed='tipo']").select_option("opcion")
    # Sin opciones no deja guardar.
    page.click("#btn-guardar-forma")
    expect(page.locator("#err-editor")).to_contain_text("al menos dos opciones")
    opc.locator("[data-ed='opciones']").fill("Lideresa\nParticipante\nDocente")
    page.click("#btn-agregar")
    campos.nth(11).locator("[data-ed='etiqueta']").fill("¿Primera vez?")
    campos.nth(11).locator("[data-ed='tipo']").select_option("sino")
    page.click("#btn-agregar")
    campos.nth(12).locator("[data-ed='etiqueta']").fill("Personas a cargo")
    campos.nth(12).locator("[data-ed='tipo']").select_option("numero")
    page.click("#btn-agregar")
    campos.nth(13).locator("[data-ed='etiqueta']").fill("Fecha del taller")
    campos.nth(13).locator("[data-ed='tipo']").select_option("fecha")
    # «Organización» sube dos puestos; se quita «Teléfono».
    campos.nth(9).locator("[data-ed='subir']").click()
    campos.nth(8).locator("[data-ed='subir']").click()
    assert campos.nth(7).locator("[data-ed='etiqueta']").input_value() == "Organización"
    campos.filter(has=page.locator("input[value='Teléfono']")).locator("[data-ed='quitar']").click()
    expect(campos).to_have_count(13)
    page.click("#btn-guardar-forma")
    expect(page.locator("#msg-formulario")).to_contain_text("«Asistencia al taller», con 13 campos")

    # El formulario nuevo se usa para registrar y sobrevive a recargar.
    page.reload()
    page.wait_for_selector("html[data-lista='si']")
    page.click(".pestanas a[data-vista='registrar']")
    expect(page.locator("#t-registrar")).to_have_text("Asistencia al taller")
    etiquetas = page.locator("#campos > .campo > label, #campos > .campo > legend").all_text_contents()
    assert [e.replace(" (opcional)", "") for e in etiquetas] == [
        "Nombres", "Apellidos", "Tipo de documento", "Número de documento", "Fecha de nacimiento", "Sexo", "Municipio",
        "Organización", "Vereda", "Rol en el proyecto", "¿Primera vez?", "Personas a cargo", "Fecha del taller"], etiquetas
    assert page.locator("#c-telefono").count() == 0
    page.click("#btn-guardar")
    expect(page.locator("#err-campo_1")).to_be_visible()  # Organización es obligatoria
    llenar_base = dict(PERSONA)
    page.fill("#c-nombres", llenar_base["nombres"]); page.fill("#c-apellidos", llenar_base["apellidos"])
    page.locator("[data-campo='tipo_documento'] .chip", has_text=re.compile("^CC$")).click()
    page.fill("#c-numero_documento", "1032456789"); page.fill("#c-fecha_nacimiento", "05/03/1990")
    page.fill("#c-municipio", "Medellín, Antioquia"); page.fill("#c-campo_1", "Junta de acción comunal")
    page.locator("[data-campo='campo_2'] .chip", has_text="Docente").click()
    page.locator("[data-campo='campo_3'] .chip", has_text="Sí").click()
    page.fill("#c-campo_4", "dos")
    page.fill("#c-campo_5", "17/12/2026")
    page.check("#autorizo")
    page.click("#btn-guardar")
    expect(page.locator("#err-campo_4")).to_contain_text("solo un número")
    page.fill("#c-campo_4", "3")
    page.click("#btn-guardar")
    expect(page.locator("#msg-registrar")).to_contain_text("Registro guardado")

    # Exportar la definición como JSON.
    page.click(".pestanas a[data-vista='formulario']")
    expect(page.locator("#aviso-con-registros")).to_contain_text("1 registro guardado")
    with page.expect_download() as d:
        page.click("#btn-exportar-forma")
    assert d.value.suggested_filename == "formulario_asistencia-al-taller.json"
    carpeta = pathlib.Path(tempfile.mkdtemp())
    ruta_json = carpeta / d.value.suggested_filename
    d.value.save_as(ruta_json)
    definicion = json.loads(ruta_json.read_text(encoding="utf-8"))
    assert definicion["formato"] == "formulario-de-campo" and definicion["titulo"] == "Asistencia al taller"
    assert [c["etiqueta"] for c in definicion["campos"]][7:10] == ["Organización", "Vereda", "Rol en el proyecto"]
    assert definicion["campos"][9]["opciones"] == ["Lideresa", "Participante", "Docente"]
    assert "Ley 1581 de 2012" in definicion["autorizacion"]["texto"] and "[nombre de la organización]" in definicion["autorizacion"]["texto"]
    assert "registros" not in json.dumps(definicion)

    # Volver a la plantilla (con confirmación en la página) e importar el JSON en un celular «nuevo».
    page.click("#btn-plantilla")
    page.click("#btn-plantilla-no")
    expect(campos).to_have_count(13)
    page.click("#btn-plantilla")
    page.click("#btn-plantilla-si")
    expect(page.locator("#msg-formulario")).to_contain_text("plantilla")
    expect(campos).to_have_count(9)
    assert s.errores == [], s.errores
    s.cerrar()

    otro = Sesion(nav, base)
    page = otro.abrir("formulario")
    page.set_input_files("#archivo-forma", str(ruta_json))
    expect(page.locator("#msg-formulario")).to_contain_text("Formulario importado y guardado: «Asistencia al taller», con 13 campos")
    page.click(".pestanas a[data-vista='registrar']")
    expect(page.locator("#t-registrar")).to_have_text("Asistencia al taller")
    expect(page.locator("#c-campo_1")).to_be_visible()

    # Archivos que no son un formulario, y uno que intenta colar HTML.
    page.click(".pestanas a[data-vista='formulario']")
    malos = {
        "roto.json": "{esto no es json",
        "otro.json": json.dumps({"hola": 1}),
        "sin-campos.json": json.dumps({"formato": "formulario-de-campo", "version": 1, "campos": []}),
        "tipo-raro.json": json.dumps({"formato": "formulario-de-campo", "version": 1, "campos": [{"etiqueta": "x", "tipo": "html"}]}),
    }
    for nombre, texto in malos.items():
        (carpeta / nombre).write_text(texto, encoding="utf-8")
        page.set_input_files("#archivo-forma", str(carpeta / nombre))
        expect(page.locator("#err-editor")).to_be_visible()
        expect(page.locator("#ed-titulo")).to_have_value("Asistencia al taller")
    trampa = {"formato": "formulario-de-campo", "version": 1, "titulo": "<img src=x onerror=window.colado=1>",
              "autorizacion": {"activa": True, "texto": "<script>window.colado=2</script> Autorizo"},
              "campos": [{"id": "../x", "etiqueta": "<b onclick=window.colado=3>Nombre</b>", "tipo": "opcion", "obligatorio": "si",
                          "opciones": ["<i>a</i>", "b"], "rol": "numero_documento"}]}
    (carpeta / "trampa.json").write_text(json.dumps(trampa), encoding="utf-8")
    page.set_input_files("#archivo-forma", str(carpeta / "trampa.json"))
    expect(page.locator("#msg-formulario")).to_contain_text("importado")
    page.click(".pestanas a[data-vista='registrar']")
    expect(page.locator("#t-registrar")).to_have_text("<img src=x onerror=window.colado=1>")
    assert page.locator("#vista-registrar img, #vista-registrar script, #vista-registrar b, #vista-registrar i").count() == 0
    assert page.evaluate("window.colado") is None
    assert page.locator("#campos [data-campo]").get_attribute("data-campo") == "campo_1"
    assert otro.errores == [], otro.errores
    otro.cerrar()


PELIGROSAS = ["=HYPERLINK(\"http://x\",\"clic\")", "+573001234567", "-2+3", "@SUM(A1)"]


def registros_de_prueba(page):
    guardar(page)
    guardar(page, nombres="José", apellidos=PELIGROSAS[0], documento="0012345678", municipio="San José del Guaviare", vereda=PELIGROSAS[1], sexo="")
    guardar(page, nombres=PELIGROSAS[2], apellidos=PELIGROSAS[3], tipo="Otro", documento="AX-99812", municipio="Una vereda que no está en la lista",
            vereda="<img src=x onerror=window.colado=1>", telefono="")


def prueba_excel_csv_y_borrado(nav, base):
    s = Sesion(nav, base)
    page = s.abrir()
    registros_de_prueba(page)
    page.click(".pestanas a[data-vista='registros']")
    expect(page.locator(".reg")).to_have_count(3)
    # Lo escrito por la persona se pinta como texto, nunca como HTML.
    assert page.locator("#vista-registros img").count() == 0 and page.evaluate("window.colado") is None

    carpeta = pathlib.Path(tempfile.mkdtemp())
    with page.expect_download() as d:
        page.click("#btn-excel")
    nombre = d.value.suggested_filename
    assert re.fullmatch(r"inscripcion-de-participantes_\d{4}-\d{2}-\d{2}_\d{4}\.xlsx", nombre), nombre
    ruta = carpeta / nombre
    d.value.save_as(ruta)
    expect(page.locator("#despues-titulo")).to_have_text("Se descargó " + nombre)
    expect(page.locator("#despues-texto")).to_contain_text("3 registros")

    libro = openpyxl.load_workbook(ruta)
    hoja = libro.active
    assert hoja.title == "Inscripción de participantes"
    filas = list(hoja.iter_rows(values_only=True))
    encabezados = list(filas[0])
    assert encabezados == ["Nombres", "Apellidos", "Tipo de documento", "Número de documento", "Fecha de nacimiento", "Sexo",
                           "Municipio", "Departamento", "Código DIVIPOLA", "Vereda o barrio", "Teléfono",
                           "Autorización de datos", "Fecha del registro", "Hora del registro", "Id del registro"], encabezados
    assert len(filas) == 4
    col = {n: i for i, n in enumerate(encabezados)}
    uno, dos, tres = filas[1], filas[2], filas[3]   # en el orden en que se registraron
    assert uno[col["Nombres"]] == "María José" and uno[col["Municipio"]] == "Medellín" and uno[col["Departamento"]] == "Antioquia"
    assert uno[col["Código DIVIPOLA"]] == "05001" and uno[col["Número de documento"]] == "1032456789"
    assert uno[col["Fecha de nacimiento"]].strftime("%d/%m/%Y") == "05/03/1990"
    assert hoja.cell(2, col["Fecha de nacimiento"] + 1).number_format == "dd/mm/yyyy"
    assert uno[col["Autorización de datos"]] == "Sí" and uno[col["Teléfono"]] == "3001234567"
    assert dos[col["Número de documento"]] == "0012345678", "Se perdieron los ceros del documento"
    assert dos[col["Municipio"]] == "San José del Guaviare" and dos[col["Departamento"]] == "Guaviare" and dos[col["Sexo"]] is None
    assert tres[col["Municipio"]] == "Una vereda que no está en la lista" and tres[col["Código DIVIPOLA"]] is None
    assert tres[col["Número de documento"]] == "AX-99812"
    # Inyección de fórmulas: quedan como texto literal, ninguna celda es fórmula.
    assert dos[col["Apellidos"]] == PELIGROSAS[0] and dos[col["Vereda o barrio"]] == PELIGROSAS[1]
    assert tres[col["Nombres"]] == PELIGROSAS[2] and tres[col["Apellidos"]] == PELIGROSAS[3]
    for fila in hoja.iter_rows():
        for celda in fila:
            assert celda.data_type != "f", "Hay una fórmula en %s" % celda.coordinate
            if isinstance(celda.value, str) and celda.value[:1] in "=+-@" and celda.row > 1:
                assert celda.quotePrefix, "Falta marcar como texto literal %s" % celda.coordinate
    with zipfile.ZipFile(ruta) as z:
        xml = z.read("xl/worksheets/sheet1.xml").decode("utf-8")
        assert "<f>" not in xml and "<f " not in xml
        assert z.testzip() is None

    # No, dejarlos: no se borra nada.
    page.click("#btn-borrar-exportados")
    expect(page.locator("#despues-pregunta")).to_contain_text("los 3 registros")
    page.click("#btn-borrar-no")
    page.click("#btn-dejar")
    expect(page.locator(".reg")).to_have_count(3)

    # CSV
    with page.expect_download() as d:
        page.click("#btn-csv")
    assert re.fullmatch(r"inscripcion-de-participantes_\d{4}-\d{2}-\d{2}_\d{4}\.csv", d.value.suggested_filename)
    ruta_csv = carpeta / d.value.suggested_filename
    d.value.save_as(ruta_csv)
    crudo = ruta_csv.read_bytes()
    assert crudo.startswith(b"\xef\xbb\xbf")
    tabla = list(csv.reader(io.StringIO(crudo.decode("utf-8-sig"), newline="")))
    assert tabla[0] == encabezados and len(tabla) == 4
    assert tabla[1][col["Fecha de nacimiento"]] == "05/03/1990" and tabla[2][col["Número de documento"]] == "0012345678"
    assert tabla[2][col["Apellidos"]] == "'" + PELIGROSAS[0] and tabla[2][col["Vereda o barrio"]] == "'" + PELIGROSAS[1]
    assert tabla[3][col["Nombres"]] == "'" + PELIGROSAS[2] and tabla[3][col["Apellidos"]] == "'" + PELIGROSAS[3]
    for fila in tabla[1:]:
        for valor in fila:
            assert valor[:1] not in ("=", "+", "-", "@"), valor

    # Borrar después de exportar, con dos pasos y sin ventanas del navegador.
    dialogos = []
    page.on("dialog", lambda dlg: dialogos.append(dlg))
    page.click("#btn-borrar-exportados")
    page.click("#btn-borrar-si")
    expect(page.locator("#msg-registros")).to_have_text("Se borraron 3 registros de este celular.")
    expect(page.locator(".reg")).to_have_count(0)
    expect(page.locator("#btn-excel")).to_be_hidden()
    assert dialogos == []
    page.reload()
    page.wait_for_selector("html[data-lista='si']")
    assert total(page) == 0
    assert s.errores == [], s.errores
    s.cerrar()


def prueba_campos_cambiados_se_exportan(nav, base):
    """Un registro hecho con un campo que después se quitó no pierde ese dato al exportar."""
    s = Sesion(nav, base)
    page = s.abrir()
    guardar(page)
    page.click(".pestanas a[data-vista='formulario']")
    page.locator("#ed-campos > li").filter(has=page.locator("input[value='Vereda o barrio']")).locator("[data-ed='quitar']").click()
    page.uncheck("#ed-aut-activa")
    page.click("#btn-guardar-forma")
    page.click(".pestanas a[data-vista='registrar']")
    expect(page.locator("#bloque-autorizacion")).to_be_hidden()
    page.fill("#c-nombres", "Sin"); page.fill("#c-apellidos", "Vereda")
    page.locator("[data-campo='tipo_documento'] .chip", has_text=re.compile("^CC$")).click()
    page.fill("#c-numero_documento", "52111222"); page.fill("#c-fecha_nacimiento", "1/1/2000"); page.fill("#c-municipio", "Leticia")
    page.click("#btn-guardar")
    expect(page.locator("#msg-registrar")).to_contain_text("Hoy van 2")
    page.click(".pestanas a[data-vista='registros']")
    with page.expect_download() as d:
        page.click("#btn-excel")
    ruta = pathlib.Path(tempfile.mkdtemp()) / d.value.suggested_filename
    d.value.save_as(ruta)
    filas = list(openpyxl.load_workbook(ruta).active.iter_rows(values_only=True))
    col = {n: i for i, n in enumerate(filas[0])}
    assert "Vereda o barrio" in col and filas[1][col["Vereda o barrio"]] == "Santa Elena" and filas[2][col["Vereda o barrio"]] is None
    assert filas[1][col["Autorización de datos"]] == "Sí" and filas[2][col["Autorización de datos"]] is None
    assert filas[2][col["Municipio"]] == "Leticia" and filas[2][col["Departamento"]] == "Amazonas"
    assert filas[2][col["Fecha de nacimiento"]].strftime("%d/%m/%Y") == "01/01/2000"
    s.cerrar()


def prueba_celular_y_pantalla_ancha(nav, base):
    for ancho, alto in ((390, 844), (360, 740), (1280, 800)):
        s = Sesion(nav, base, ancho=ancho, alto=alto)
        page = s.abrir()
        registros_de_prueba(page)
        page.click("#btn-guardar")  # con errores a la vista
        for vista in ("registrar", "registros", "formulario", "acerca"):
            page.click(".pestanas a[data-vista='%s']" % vista)
            if vista == "registros":
                with page.expect_download():
                    page.click("#btn-excel")
            medida = page.evaluate("() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]")
            assert medida[0] <= medida[1], "Desplazamiento lateral en «%s» a %d px: %s" % (vista, ancho, medida)
            if ancho < 600:
                chicos = page.evaluate("""() => [...document.querySelectorAll('main button, main a.boton, main label.boton, .pestanas a, main .chip, main input.caja, main select.caja')]
                    .filter(e => e.offsetParent !== null).map(e => [e.textContent.trim().slice(0, 30), Math.round(e.getBoundingClientRect().height)])
                    .filter(x => x[1] < 44)""")
                assert chicos == [], "Botones de menos de 44 px en «%s»: %s" % (vista, chicos)
        assert s.errores == [], s.errores
        s.cerrar()


def prueba_teclado(nav, base):
    s = Sesion(nav, base, ancho=1280, alto=800)
    page = s.abrir()
    page.keyboard.press("Tab")
    assert page.evaluate("document.activeElement.className") == "saltar"
    page.keyboard.press("Enter")
    page.focus("#c-nombres")
    page.keyboard.type("Carlos")
    page.keyboard.press("Tab"); page.keyboard.type("Rojas")
    page.keyboard.press("Tab"); page.keyboard.press("Space")       # CC
    page.keyboard.press("ArrowRight")                               # TI
    assert page.is_checked("[data-campo='tipo_documento'] input[value='TI']")
    page.keyboard.press("Tab"); page.keyboard.type("1012345678")
    page.keyboard.press("Tab"); page.keyboard.type("15082012")
    page.keyboard.press("Tab"); page.keyboard.press("Space")       # Sexo: primera opción
    page.keyboard.press("Tab")                                      # «Quitar la respuesta»
    assert page.evaluate("document.activeElement.className") == "quitar-respuesta"
    page.keyboard.press("Tab"); page.keyboard.type("popay")
    page.keyboard.press("ArrowDown"); page.keyboard.press("Enter")
    assert page.input_value("#c-municipio") == "Popayán, Cauca"
    page.keyboard.press("Tab"); page.keyboard.press("Tab")          # vereda, teléfono (opcionales)
    page.keyboard.press("Tab"); page.keyboard.press("Space")       # autorización
    assert page.is_checked("#autorizo")
    page.keyboard.press("Tab")
    assert page.evaluate("document.activeElement.id") == "btn-guardar"
    page.keyboard.press("Enter")
    expect(page.locator("#msg-registrar")).to_contain_text("Hoy van 1")
    assert page.evaluate("document.activeElement.id") == "msg-registrar"
    # El foco se ve.
    page.focus("#c-nombres")
    page.keyboard.press("Tab")
    ancho = page.evaluate("getComputedStyle(document.activeElement).outlineWidth")
    assert ancho not in ("0px", ""), ancho
    assert s.errores == [], s.errores
    s.cerrar()


def prueba_actualizacion(nav, base):
    """Cuando se publica una versión nueva, la página la ofrece y no pierde los registros."""
    s = Sesion(nav, base)
    page = s.abrir()
    s.esperar_sw()
    guardar(page)
    assert page.evaluate("caches.keys()") == ["formulario-de-campo-" + version_del_sw()]
    try:
        ESTADO["version_sw"] = "99.0.0"
        page.reload()
        page.wait_for_selector("html[data-lista='si']")
        expect(page.locator("#actualizar")).to_be_visible(timeout=15000)
        with page.expect_navigation():
            page.click("#btn-actualizar")
        page.wait_for_selector("html[data-lista='si']")
        expect(page.locator("#actualizar")).to_be_hidden()
        page.wait_for_function("caches.keys().then(k => k.length === 1 && k[0] === 'formulario-de-campo-99.0.0')")
        assert total(page) == 1
    finally:
        ESTADO["version_sw"] = None
    s.cerrar()


def version_del_sw():
    return re.search(r"var VERSION = '([^']+)';", (RAIZ / "sw.js").read_text(encoding="utf-8")).group(1)


def prueba_archivos_del_repo(nav, base):
    """El service worker guarda todo lo que la página usa, y el manifest sirve bajo la subruta."""
    sw = (RAIZ / "sw.js").read_text(encoding="utf-8")
    lista = re.findall(r"^\s+'([^']+)',?$", sw.split("var ARCHIVOS = [", 1)[1].split("];", 1)[0], re.M)
    assert "./" in lista and "index.html" in lista
    for a in lista:
        assert a == "./" or (RAIZ / a).is_file(), "sw.js guarda un archivo que no existe: " + a
        assert not a.startswith("/"), "Ruta absoluta en sw.js: " + a
    html = (RAIZ / "index.html").read_text(encoding="utf-8")
    usados = set(re.findall(r'(?:src|href)="((?:assets|data)/[^"]+|manifest\.webmanifest)"', html))
    assert usados and usados <= set(lista), "Falta guardar en sw.js: %s" % (usados - set(lista))
    assert "data/municipios.json" in lista
    manifest = json.loads((RAIZ / "manifest.webmanifest").read_text(encoding="utf-8"))
    assert manifest["start_url"] == "./" and manifest["scope"] == "./" and manifest["display"] == "standalone"
    for icono in manifest["icons"]:
        assert (RAIZ / icono["src"]).is_file() and icono["src"] in lista
    assert not re.search(r"\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\()", (RAIZ / "assets" / "app.js").read_text(encoding="utf-8"))
    assert not re.search(r"(?<![.\w])(confirm|alert|prompt)\(", (RAIZ / "assets" / "app.js").read_text(encoding="utf-8"))
    for f in list((RAIZ / "assets").glob("*.js")) + [RAIZ / "index.html", RAIZ / "sw.js", RAIZ / "assets" / "estilos.css"]:
        externos = [u for u in re.findall(r"https?://[^\s\"')]+", f.read_text(encoding="utf-8"))
                    if not re.match(r"https?://(schemas\.openxmlformats\.org|estado-x\.github\.io|github\.com|www\.linkedin\.com|estadox\.com|www\.datos\.gov\.co)", u)]
        assert externos == [], "%s nombra direcciones de fuera: %s" % (f.name, externos)
    s = Sesion(nav, base)
    page = s.abrir("acerca")
    assert page.evaluate("fetch(document.querySelector('link[rel=manifest]').href).then(r => r.ok)")
    s.esperar_sw()
    assert page.evaluate("navigator.serviceWorker.ready.then(r => r.scope)") == base
    guardadas = page.evaluate("caches.open('formulario-de-campo-%s').then(c => c.keys()).then(k => k.length)" % version_del_sw())
    assert guardadas == len(lista)
    s.cerrar()


PRUEBAS = [
    prueba_archivos_del_repo, prueba_carga_limpia, prueba_validaciones, prueba_municipios, prueba_sin_conexion_y_recarga,
    prueba_repetido_editar_borrar, prueba_editor_y_json, prueba_excel_csv_y_borrado, prueba_campos_cambiados_se_exportan,
    prueba_celular_y_pantalla_ancha, prueba_teclado, prueba_actualizacion,
]


def main():
    solo = [a for a in sys.argv[1:] if not a.startswith('--')]
    srv, base = servir()
    fallas = 0
    with sync_playwright() as p:
        nav = p.chromium.launch()
        for prueba in PRUEBAS:
            if solo and not any(t in prueba.__name__ for t in solo):
                continue
            try:
                prueba(nav, base)
                print("OK     ", prueba.__name__)
            except Exception as e:  # una falla no detiene las demás
                fallas += 1
                if '--traza' in sys.argv:
                    import traceback; traceback.print_exc()
                print("FALLA  ", prueba.__name__, "\n        ", str(e).replace("\n", "\n         ")[:1500])
        nav.close()
    srv.shutdown()
    print("\n%d pruebas, %d fallas" % (len(PRUEBAS) if not solo else sum(any(t in q.__name__ for t in solo) for q in PRUEBAS), fallas))
    return 1 if fallas else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())

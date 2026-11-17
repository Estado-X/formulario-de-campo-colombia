/* Formulario de campo · Estado X
   Service worker: guarda la página y sus archivos en el celular la primera vez que se abre
   con internet, y después la sirve desde ahí aunque no haya señal.
   No guarda ni ve los registros: esos viven en IndexedDB y no pasan por aquí.

   Si cambias cualquier archivo de la lista, sube el número de VERSION: así los celulares
   que ya la tienen instalada descargan la versión nueva y la página ofrece «Actualizar». */
'use strict';

var VERSION = '1.0.1';
var CACHE = 'formulario-de-campo-' + VERSION;
var ARCHIVOS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/estilos.css',
  'assets/zip.js',
  'assets/excel.js',
  'assets/nucleo.js',
  'assets/almacen.js',
  'assets/app.js',
  'assets/favicon.svg',
  'assets/icono-180.png',
  'assets/icono-192.png',
  'assets/icono-512.png',
  'assets/icono-maskable-512.png',
  'data/municipios.json'
];

self.addEventListener('install', function (e) {
  // cache: 'reload' se salta la caché del navegador: lo que se guarda es lo que hay publicado hoy.
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(ARCHIVOS.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (claves) {
    return Promise.all(claves.map(function (k) {
      if (k.indexOf('formulario-de-campo-') === 0 && k !== CACHE) return caches.delete(k);
      return null;
    }));
  }).then(function () { return self.clients.claim(); }));
});

// La página avisa cuando la persona toca «Actualizar»: ahí entra la versión nueva.
self.addEventListener('message', function (e) {
  if (e.data && e.data.tipo === 'ACTUALIZAR') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var pedido = e.request;
  if (pedido.method !== 'GET') return;
  var url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(pedido, { ignoreSearch: true }).then(function (guardado) {
      if (guardado) return guardado;
      // Lo que no está guardado se pide a la red; si no hay señal y era la página, se abre la guardada.
      return fetch(pedido).catch(function () {
        if (pedido.mode === 'navigate') return c.match('index.html');
        return Response.error();
      });
    });
  }));
});

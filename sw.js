/* =========================================================
   Service Worker — Visitas em Campo
   Estratégia:
   · Arquivos do app  -> cache primeiro (abre offline e rápido)
   · Chamadas à planilha -> rede sempre (nunca servir dado velho)
   ========================================================= */

const VERSAO = 'visitas-v1';

// Caminhos relativos: funcionam em usuario.github.io/repositorio/
const ARQUIVOS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// ---- Instalação: guarda o app no cache ----
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSAO)
      // addAll falha inteiro se um arquivo faltar; add individual é tolerante.
      .then((cache) => Promise.allSettled(ARQUIVOS.map((a) => cache.add(a))))
      .then(() => self.skipWaiting())
  );
});

// ---- Ativação: limpa versões antigas ----
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((c) => c !== VERSAO).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

// ---- Requisições ----
self.addEventListener('fetch', (evento) => {
  const req = evento.request;

  // Só interceptamos GET.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Nunca cachear a planilha do Google: o gerente precisa do dado atual.
  if (url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com')) return;

  // Navegação (abrir o app): rede primeiro, cache se estiver offline.
  if (req.mode === 'navigate') {
    evento.respondWith(
      fetch(req)
        .then((resposta) => {
          const copia = resposta.clone();
          caches.open(VERSAO).then((c) => c.put('./index.html', copia));
          return resposta;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Demais arquivos: cache primeiro, rede como reserva.
  evento.respondWith(
    caches.match(req).then((emCache) => {
      if (emCache) return emCache;
      return fetch(req).then((resposta) => {
        // Guarda o que veio da nossa origem (não as CDNs, que já têm cache do navegador).
        if (resposta.ok && url.origin === self.location.origin) {
          const copia = resposta.clone();
          caches.open(VERSAO).then((c) => c.put(req, copia));
        }
        return resposta;
      });
    })
  );
});

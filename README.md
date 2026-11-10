# Rummy 500 Online

App web multijugador para jugar Rummy 500 con amigos, sin registro ni base de datos. Proyecto funcional de MVP para hasta 4 personas por sala. Todos los textos de la app están en español.

## Funcionalidades

- Crear sala privada con código aleatorio de 7 caracteres y compartir enlace.
- Entrar escribiendo un nombre (no se pide email ni contraseña).
- Deshacer un robo inválido del descarte antes de hacer jugadas.
- Reanudar la sala tras actualizar la pestaña, mediante un token privado en `sessionStorage`.
- Entre 2 y 4 jugadores, turnos en tiempo real con Socket.IO.
- Repartir, robar del mazo o levantar una carta del descarte con las que están encima.
- Tríos, escaleras, comodines, agregar cartas a juegos de cualquier participante y recuperar comodines con su carta correspondiente.
- Validación autoritativa en servidor. Solo cada jugador recibe su propia mano.
- Puntajes por ronda: bajadas propias (incluidas ampliaciones a juegos ajenos) menos cartas que quedaron en mano.
- Siguiente ronda y victoria al superar los 500 puntos con puntaje único más alto.
- Diseño adaptable a celular y escritorio.

## Requisitos

- Node.js 20+ (preferentemente 22 LTS)
- npm

## Iniciar en tu computadora

```bash
npm install
npm run dev
```

Abrí **http://localhost:5173** en tu navegador. Abrí otra pestaña o dispositivo para unirte como segundo jugador. Si usás otro dispositivo, debe poder acceder a tu servidor local (o desplegar la app online).

## Probar motor del juego

```bash
npm test
```

## Construir y ejecutar para producción

```bash
npm run build
npm start
```

Abrí `http://localhost:3001`. Este mismo servidor entrega la web y los eventos en tiempo real.

## Publicar gratis con Render

1. Subí la carpeta a un repositorio en GitHub (el repo puede ser privado).
2. En Render, conectá el repositorio y elegí **Blueprint** para usar el archivo `render.yaml`; o creá un **Web Service** Node.
3. Elegí el plan **Free**, build command `npm install && npm run build`, start command `npm start`.
4. Compartí la URL `https://...onrender.com` entre tus amigos.

**Limitación importante:** la partida está en memoria RAM, y se pierde al reiniciar o redeplegar el servidor. El servicio gratis se suspende tras períodos sin actividad. La primera conexión después de una suspensión puede tardar. No usar este diseño para dinero real ni datos sensibles.

## Reglas implementadas

Esta variante tiene reglas explícitas para que podamos ajustarlas luego:

- Mazo: 52 cartas + 2 comodines.
- 2 jugadores: 13 cartas iniciales; 3 o 4 jugadores: 7 iniciales.
- Cada turno: robar, bajar cero o más juegos, descartar (salvo que se vacíe la mano al bajar).
- Al tomar del descarte, debés jugar la carta seleccionada **en la primera jugada** como parte de un juego nuevo o agregándola a uno existente; también levantás todas las cartas descartadas encima.
- Tríos de 3 o 4 del mismo valor con diferentes palos; escaleras de 3+ cartas consecutivas del mismo palo. As bajo o alto sin envolver K-A-2.
- Comodines con un mínimo de dos cartas reales por combinación inicial; se pueden colocar en extremos de escaleras o completar tríos. Se pueden intercambiar por la carta exacta que representan.
- Valor: A = 15; comodín = 15; J/Q/K = 10; cartas numeradas = valor impreso. Todas las cartas bajadas cuentan para quien las bajó.
- Al quedarse sin cartas alguien, termina la ronda inmediatamente; se descuentan las cartas que otras personas no bajaron.
- Al agotarse el mazo, quien empieza turno puede finalizar la ronda o levantar del descarte.
- Sin 'cantar Rummy' sobre descartes ni bots en esta versión.

Estas reglas son una variante concreta del Rummy 500, **no todas las reglas caseras posibles**.

## Privacidad y seguridad

- No solicita ni almacena correo, teléfono, contraseñas o cuentas personales.
- Nombres y partidas existen temporalmente en la memoria del proceso del servidor; nada se envía a una base de datos.
- Códigos de sala de 7 caracteres generados aleatoriamente; no se publican listas de salas.
- Token de acceso a jugador de 256 bits enviado solo a la conexión autenticada, guardado en `sessionStorage`. No lo compartas.
- El backend controla cartas en mano, turnos, validez de cada movimiento y puntos. El navegador no puede asignarse cartas ni puntajes.
- Se implementa limitación básica de frecuencia de eventos, headers de seguridad y restricciones de origen en las conexiones web.
- Usá HTTPS en producción (Render lo ofrece). El hosting puede conservar logs técnicos estándar, como direcciones IP, bajo sus propias políticas; no prometemos anonimato absoluto.
- El código es un MVP y no reemplaza una auditoría de seguridad; no lo uses para apuestas, dinero real ni información sensible.

## Arquitectura

```
├── server/
│   ├── game.js       # motor de reglas / estados / puntajes
│   └── index.js      # Express + Socket.IO + salas
├── src/
│   ├── App.tsx       # interfaz React
│   ├── main.tsx
│   ├── types.ts
│   └── styles.css
├── tests/
│   └── engine.test.js
├── index.html
├── render.yaml       # despliegue Render gratuito
└── package.json
```

## Próximas mejoras

- Recuperación de partidas tras reinicio con base de datos/almacenamiento persistente, sin exigir registro.
- Opciones para personalizar reglas y puntuaciones.
- Temporizador y votación para expulsar jugadores ausentes.
- Gestos táctiles y animaciones de cartas.
- Tests de integración de Socket.IO y revisión de seguridad previa a un lanzamiento público.

#!/usr/bin/env node
/**
 * La sonda: un servidor que registra todo lo que le llegue.
 *
 * Existe para **atacar** el contenedor de artefactos, no para servir nada. La
 * pregunta que contesta es una sola: cuando el HTML que escribió un agente
 * intenta salir a la red, ¿sale?
 *
 * Cualquier petición —GET, POST, imagen, fuente, WebSocket, formulario,
 * navegación— queda escrita aquí con su hora y su ruta. Que el registro esté
 * vacío es el resultado que se busca **solo si el control negativo llenó el
 * mismo registro**: sin la mitad que debe pasar, «no llegó nada» se ve igual
 * que «la prueba estaba mal escrita». Ya pasó al verificar la contención de
 * Claude.
 *
 *   node attacks/probe.mjs
 *
 * Responde a todo con CORS abierto a propósito: si algo no llega, que no quepa
 * la duda de que fue el navegador rechazando la respuesta. Lo que se mide es la
 * petición que sale, no la respuesta que vuelve.
 */
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";

const PUERTO = Number(process.env.SONDA_PUERTO || 8788);
const archivo = process.argv.includes("--log")
  ? process.argv[process.argv.indexOf("--log") + 1]
  : null;

let n = 0;

const server = createServer((req, res) => {
  n += 1;
  const hora = new Date().toISOString().slice(11, 23);
  const upgrade = req.headers.upgrade ? ` [upgrade: ${req.headers.upgrade}]` : "";
  const linea = `${hora}  #${String(n).padStart(2, "0")}  ${req.method.padEnd(4)} ${req.url}${upgrade}`;

  // El cuerpo también se registra: un `sendBeacon` manda los datos ahí, no en
  // la ruta, y es la forma más silenciosa de exfiltrar.
  let cuerpo = "";
  req.on("data", (c) => {
    if (cuerpo.length < 400) cuerpo += c.toString();
  });
  req.on("end", () => {
    const completo = cuerpo ? `${linea}\n${" ".repeat(20)}cuerpo: ${cuerpo.slice(0, 200)}` : linea;
    console.log(completo);
    if (archivo) appendFileSync(archivo, completo + "\n");
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    });
    res.end();
  });
});

// Un WebSocket llega como upgrade y muere aquí sin completar el saludo: da
// igual, lo que prueba la exfiltración es que la petición haya salido.
server.on("upgrade", (req, socket) => {
  n += 1;
  const hora = new Date().toISOString().slice(11, 23);
  const linea = `${hora}  #${String(n).padStart(2, "0")}  WS   ${req.url}`;
  console.log(linea);
  if (archivo) appendFileSync(archivo, linea + "\n");
  socket.destroy();
});

server.listen(PUERTO, "127.0.0.1", () => {
  console.log(`sonda escuchando en http://127.0.0.1:${PUERTO}`);
  console.log("cada línea de aquí abajo es código que logró salir a la red\n");
});

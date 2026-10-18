// Lo que la persona le teclea a un `!` en marcha: la terminal del motor no
// hace eco: la ventana pinta lo escrito, salvo cuando es una clave.

const CLAVE = /(password|passphrase|contrase[ñn]a|passcode|\bpin\b|token|secret)[^\n]*[:?]\s*$/i;

/** La última línea de la salida pide un secreto: lo que se escriba no se pinta. */
export function pideClave(salida: string): boolean {
  const ultima = salida.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split(/\r?\n|\r/).pop() ?? "";
  return CLAVE.test(ultima);
}

/** Fin de archivo, como `Ctrl+D` en una terminal. */
export const FIN_DE_ARCHIVO = "\u0004";

// Sin imports: lo prueban `node --test` y el visor por igual.

export function esTypst(ruta: string) {
  return ruta.toLowerCase().endsWith(".typ");
}

/**
 * Si el visor pone la vista de Typst al lado de este archivo: solo un `.typ`,
 * con el ojo puesto en un principal. Cualquier otro archivo usa su propia
 * previa o se queda en código; si no, el PDF del documento anterior se queda
 * pegado al JSON o a la notebook que se abrió después en la misma pestaña.
 */
export function llevaVistaTypst(ruta: string, principal: string | null) {
  return principal !== null && esTypst(ruta);
}

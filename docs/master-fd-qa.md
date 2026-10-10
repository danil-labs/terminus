# Entrega de la maestra: QA en macOS

La implementación está en `src-tauri/src/extracted/master_handoff.rs`, llamada
desde cada lanzamiento en `engine::spawn`, incluido el traspaso de 0.2.74.
Reutilizar un motor vivo no hace una nueva lectura del llavero.

## Condiciones de activación

La ventana valida su firma en ejecución y la firma estática de la ruta exacta
del motor mediante Security.framework. Los requisitos exigen el identificador
respectivo (`ai.danil.terminus` y `seldon-runtime`), `anchor apple generic` y
el equipo `ATG57AXYTS`. El motor se valida en todas sus arquitecturas.

Después ejecuta esa ruta con `--help`, sin argumentos de servicio ni datos,
con un límite de tres segundos y 64 KiB de salida. Debe salir correctamente y
anunciar el token `--master-fd` en stdout. No se almacena la capacidad entre
lanzamientos. El lock del motor no se modifica en este cambio: actualizarlo
a un motor que anuncie el flag activa la entrega automáticamente.

Solo entonces lee el servicio de la identidad seleccionada, cuenta `boveda`,
con la interacción del llavero deshabilitada durante la lectura. Conserva el
estado anterior de interacción. Además, la consulta SecItemCopyMatching lleva
`kSecUseAuthenticationUISkip`: omite silenciosamente las entradas que necesitan
autenticación, según [la documentación de Apple](https://developer.apple.com/documentation/security/ksecuseauthenticationuiskip).
Se usa `security-framework-sys`, ya fijado en Cargo.lock, para esta opción que
no tiene setter en PasswordOptions. En laboratorio no consulta el servicio de
producción. No crea, cambia ni borra entradas o ACL.

Acepta exactamente 64 bytes hexadecimales, normaliza a minúsculas y escribe
los 64 bytes en un pipe vacío. Cierra el escritor y pone a cero el vector
antes de crear el hijo. Pasa `--master-fd N`, con N mayor o igual que 3;
solo ese descriptor pierde CLOEXEC en el hijo. El padre lo cierra tras spawn.
La llave no entra en argumentos, entorno, disco ni logs.

Si falla una condición o la preparación del pipe, lanza sin el flag.
Una falla de spawn, incluida la configuración del descriptor en el hijo,
se propaga como falla de lanzamiento; no reintenta leyendo el llavero desde
otro proceso. El motor es responsable de validar el contenido, consumir EOF,
cerrar el descriptor y fallar cerrado en el modo de entrega.

## Escenarios E2E pendientes en la Mac de QA

Usar una cuenta de QA y una copia respaldada de sus datos. Registrar la versión
y commit de ventana y motor, firma de ambos, argumentos del proceso motor,
diálogos observados y resultado de una operación que lea una credencial
existente. No registrar la maestra ni volcar el entorno o memoria del proceso.
Los escenarios con entrega requieren primero fijar y empaquetar el motor
compatible y firmado; con el motor actual no se espera eliminar el diálogo.

1. **Actualización desde 0.2.74 sin Always Allow previo.** Crear una credencial
   en 0.2.74 firmada y cerrar esa ventana. Actualizar a la ventana nueva firmada
   con el motor compatible firmado. Aceptar el traspaso y usar la credencial.
   Esperado: cero diálogos de llavero, motor con `--master-fd N`, credencial
   utilizable y misma entrada y ACL. Repetir después de cerrar la ventana y
   esperar la salida del motor.
2. **Motor reiniciado.** Con el caso anterior abierto y sin tareas trabajando,
   detener únicamente ese motor de QA por su PID y volver a abrir la ventana.
   Esperado: nuevo PID con `--master-fd N`, cero diálogos y misma credencial
   utilizable. Comprobar que reabrir con un motor vivo reutiliza su PID.
3. **Instalación nueva.** En otra cuenta de QA sin entrada `boveda` ni datos,
   abrir la instalación firmada. Esperado: primer motor sin `--master-fd`,
   creación y uso de credenciales igual que la versión actual. En un arranque
   posterior con entrada accesible y motor compatible, se activa la entrega.
4. **Build sin firmar.** Abrir una ventana sin firma tanto con motor sin firma
   como con motor compatible firmado. Esperado: no consulta la maestra para
   entrega y nunca pasa `--master-fd`; conserva el comportamiento anterior.
   Repetir con ventana firmada y motor sin firma o de otro equipo: sin flag.
5. **Compatibilidad anterior.** Empaquetar la ventana nueva firmada con el motor
   fijado actualmente, sin capacidad. Esperado: sin `--master-fd`, sin rechazo
   por argumento desconocido y comportamiento anterior del llavero.
6. **Fallback no interactivo.** En cuentas de QA aisladas, comprobar entrada
   ausente, lectura denegada, llavero bloqueado y valor de formato inválido.
   Esperado: la lectura de la ventana no muestra diálogos y el motor arranca
   sin flag; el motor puede mostrar los diálogos de su comportamiento actual.
   Una entrada de 64 hex en mayúsculas se entrega normalizada a minúsculas.
7. **Rechazo cerrado del motor.** Con motor compatible, una maestra de formato
   válido que no corresponda a la bóveda debe rechazar el arranque. Esperado:
   no genera otra bóveda y no intenta leer el llavero como alternativa.

Este worktree se implementa y comprueba en Windows: no reproduce el defecto
de macOS ni valida ACL, diálogos, firmas o herencia nativa del descriptor.
El código condicionado a macOS necesita compilación en el CI de publicación
y estos escenarios nativos antes de dar por resuelto el defecto.

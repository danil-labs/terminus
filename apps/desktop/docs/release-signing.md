# Firma de una candidata existente

Este procedimiento prepara `0.3.0-rc.1` sin recompilar Rust ni el frontend.
La revisión del código corresponde a `dev` en `9f2805d8`. No acredita una
firma ejecutada, una notarización ni una publicación. La autorización para
usar GitHub Actions debe resolverse por separado antes de ejecutar un job.

## Credenciales y autoridad

| Uso | Referencia conocida | Restricción |
| --- | --- | --- |
| Updater de Desktop, minisign | GitHub: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Debe corresponder a `plugins.updater.pubkey` en `src-tauri/tauri.conf.json`; no generar ni rotar la llave. |
| Authenticode Windows, SSL.com eSigner | GitHub: `ES_USERNAME`, `ES_PASSWORD`, `ES_CREDENTIAL_ID`, `ES_TOTP_SECRET` | Firma remota; el workflow no usa un `.pfx` de Windows. Cada operación puede consumir una firma. |
| Developer ID macOS | GitHub: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID` | Identidad Danil, equipo público `ATG57AXYTS`. Preferir el certificado ya disponible en el llavero del Mac. |
| Notarización Apple | GitHub: `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_P8` | El workflow materializa un `.p8` temporal y usa `APPLE_API_KEY_PATH`. No incluirlo en evidencias. |
| Manifiesto del motor, Ed25519 | AWS cuenta `692771913305`, región `us-east-1`, Secrets Manager `danil/engine/release-signing` | Es otra llave: no sirve como sustituto del minisign del updater de Desktop. |

La referencia AWS del motor está registrada en la memoria operativa
`engine-release-signing-key.md`. El rol lector `seldon-release-signer` permite
`GetSecretValue` sobre ese secreto, no enumerar secretos. La ausencia de
`ListSecrets` no prueba que falte una credencial. Un perfil caducado tampoco
prueba que el secreto haya desaparecido.

GitHub permite consultar nombres de secrets; no permite recuperar su valor
mediante la API. Si la copia original no está en AWS, en el llavero o en el
almacén aprobado, un job que consuma esos secrets necesita autorización
explícita. No se exportan secrets desde Actions para recuperarlos localmente.

El relevamiento del Mac reportó que `danil/desktop/updater` en AWS contiene
la llave de pruebas de Appv2; no coincide con la pubkey de Desktop. No usarla.
La firma de producción de `0.2.88` coincide con la pubkey instalada según el
recibo del coordinador. Las credenciales Apple API y SSL.com sólo se localizaron
en GitHub. Este documento no realizó una lectura de sus valores.

## Inventario previo

Conservar los artefactos originales y registrar SHA-256, tamaño, plataforma,
arquitectura, versión, OID fuente, motor fijado y resultado de QA. La candidata
existente proviene de `529c49c5`; cambios posteriores de `dev` no forman parte
de sus bytes. Trabajar sobre copias y registrar todos los hashes resultantes.

No volver a firmar `work-tools` ni regenerar sus inventarios. Una firma cambia
bytes y puede invalidar el inventario acreditado. Si Apple exige modificar
una herramienta, detener esta ruta y preparar otra candidata con inventario
y QA propios.

## Windows

1. Instalar la copia de laboratorio y consultar `Get-AuthenticodeSignature`
   de `terminus.exe`, `seldon-runtime.exe` y el setup. Registrar estado,
   subject y existencia de sello de tiempo. El desinstalador sin firma está
   excluido explícitamente por el workflow actual.
2. Si los ejecutables instalados ya tienen firmas válidas de Danil con sello
   de tiempo, firmar sólo el setup pendiente es suficiente para completar
   esa capa. Verificar después la instalación desde ese setup.
3. Si un ejecutable interno está sin firmar, firmar únicamente el setup no
   lo corrige. Conservar los binarios compilados y los recursos/script NSIS
   originales; firmar `terminus.exe` ya parcheado con la marca NSIS y el motor
   pendiente, y volver a empaquetar con esos mismos recursos. No volver a
   invocar `tauri build`. Si faltan los recursos de empaquetado, esta ruta
   queda pendiente; el instalador existente no acredita una release completa.
4. Usar el bloque de eSigner existente en `publish.yml`, conservando el pin
   SHA-256 de CodeSignTool 1.3.2, el certificado raíz SSL.com y la separación
   de ventanas TOTP. Firmar el setup final después de empaquetar. No firmar
   dependencias de `work-tools`.
5. Repetir instalación en laboratorio. Exigir firma válida de Danil y sello
   de tiempo en los ejecutables requeridos y el setup, y conservar el listado
   de archivos instalados. Sólo entonces crear la firma minisign del setup.

Si sólo GitHub conserva los cuatro secrets de SSL.com, la alternativa es un
job manual de firma con artefactos y hashes fijados. Debe descargar únicamente
esos inputs, rechazar cualquier hash distinto, consumir los secrets en el paso
de firma y subir los resultados para revisión. Sin compilación, tags, releases,
actualización de `latest.json` ni permisos de publicación. El borrador está en
`.github/workflows/sign-existing-candidate.yml`; falta resolver la autorización
de Actions y acreditar los inputs de NSIS. La candidata rc1 examinada por el
coordinador tiene setup y `terminus.exe` sin Authenticode.

## macOS

1. Verificar Developer ID, hardened runtime y firma estricta del `.app`
   existente. No sustituir una firma válida por una ad-hoc.
2. Con la credencial Apple aprobada, someter un ZIP del `.app` ya firmado a
   notarización, esperar aceptación, grapar el ticket al `.app` y validarlo.
   Grapar modifica el artefacto: el recibo debe registrar los nuevos hashes.
3. Si el DMG existente contiene el `.app` anterior sin ticket, reconstruir
   sólo el DMG desde el `.app` grapado, preservando su disposición y recursos;
   firmar el DMG con Developer ID. No recompilar la aplicación.
4. Someter el DMG firmado a notarización, esperar aceptación, grapar y validar
   su ticket. Validar también el `.app` contenido y la evaluación de Gatekeeper.
5. Regenerar el `.app.tar.gz` del updater desde el `.app` final con ticket y
   crear su firma minisign. El archivo anterior no representa esos bytes.

`publish.yml` contiene la receta existente de Developer ID y notarización,
pero ejecutarlo recompila. El DMG y el `.app` tienen tickets independientes.
Una firma Developer ID válida sin aceptación de Apple no acredita notarización.

## Linux y firma del updater

Linux no usa Authenticode ni Developer ID. Firmar el AppImage existente con
la llave minisign de Desktop preserva sus bytes; produce un `.sig` separado.
La misma operación se aplica al setup final de Windows y al `.app.tar.gz`
final de macOS, después de todas las operaciones que cambian sus bytes.

El comando existente es `pnpm tauri signer sign` sobre el archivo final,
con `TAURI_SIGNING_PRIVATE_KEY` y su contraseña en el entorno del proceso.
La verificación independiente está en `npx/lib/minisign.mjs`: `verifyFile`
recibe el archivo, el contenido base64 del `.sig`, la pubkey instalada y su
nombre firmado. No basta con que el signer termine con código cero.

Actualizar el inventario canónico con hashes finales, firmas verificadas,
recibos de Apple y relación entre OID fuente y operaciones de empaquetado.
La publicación de la pre-release y sus assets requiere una acción posterior
autorizada; no cambiar el canal estable ni marcar esta candidata como latest.

## Evidencia y límites de esta preparación

Se inspeccionaron `publish.yml`, `tauri.conf.json` y el verificador minisign.
No se consultaron valores de secrets, ni se solicitaron firmas pagadas,
notarizaciones, builds o publicaciones. No está verificada la ubicación AWS
del minisign de Desktop, la disponibilidad local de la credencial Apple,
el estado Authenticode del motor rc1 ni la conservación de recursos NSIS.
Esos datos determinan cuál de las rutas anteriores puede ejecutarse.

## Contrato del job propuesto

Es un borrador sin ejecución de plataforma. Sólo acepta despacho manual en
`danil-labs/terminus`, con permiso `contents: read`; conserva outputs de revisión
durante siete días. No se sube este workflow sin decisión del coordinador.

Entradas: OID completo del código compilado, tag de una pre-release de inputs
revisados y SHA-256 de cada ZIP. Un hash vacío omite esa plataforma. Los ZIP
se llaman `windows-signing-input.zip`, `macos-signing-input.zip` y
`linux-signing-input.zip` y contienen
un `manifest.json` con `source_oid`, `version: "0.3.0-rc.1"`, `platform`,
`files` (mapa ruta relativa → SHA-256) y `links` (ruta → destino de symlink).
Se exige inventario exhaustivo; no se admiten enlaces que salgan del árbol.
El OID declarado requiere acreditar procedencia con el recibo original del
build: incluirlo en un JSON no prueba por sí solo cómo se compilaron los bytes.

Windows añade `main`, `engine`, `nsis_script`, `installer` y `makensis_sha256`.
Los tres primeros son rutas a archivos inventariados; `installer` es una ruta
de salida aún inexistente. El script NSIS y todos sus recursos deben estar
revisados y usar rutas relativas al ZIP. Se verifica el hash del `makensis`
instalado en el runner; una diferencia detiene el job. El empaquetador ejecuta
código del script revisado, sin credenciales de firma en su entorno.

macOS contiene `Terminus.app` y `template.dmg`, con roles `app` y `dmg` de esos
nombres exactos. El DMG debe tener capacidad para reemplazar su app y conservar
la disposición existente. Su conversión y el reemplazo no se han ensayado en
esta preparación. Si falta espacio, el job falla y requiere otro template;
no compila ni modifica herramientas como respaldo.

Linux añade `appimage`, ruta al AppImage inventariado. El job Ubuntu sólo
valida/copia esos bytes, crea su firma minisign y la verifica contra la pubkey
instalada; no ejecuta el AppImage, no lo reempaqueta ni instala Rust.

Los scripts de firma son `scripts/sign-existing-windows.ps1` y
`scripts/sign-existing-macos.sh`. El validador y la verificación con la pubkey
instalada viven en `scripts/candidate-signing.mjs`. La firma minisign se aplica
al final, usando Tauri CLI `2.11.4` fijado en el lock actual.

El job entrega instaladores, firmas, recibos de notarización y un recibo que
mantiene `installed_qa: pending`. La instalación y el arranque desde esos bytes
finales siguen siendo requisito antes de publicar. No confundir un job verde
de firma con QA de una candidata distribuible.

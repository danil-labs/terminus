# Firma de una candidata existente

Este procedimiento prepara `0.3.0-rc.1` sin recompilar Rust ni el frontend.
La revisión del código corresponde a `dev` en `9f2805d8`. El mecanismo sigue
en revisión y no está autorizado para ejecutarse. No acredita una
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
original proviene de `529c49c5`; cambios posteriores de `dev` no forman parte
de sus bytes. Otra candidata requiere su OID y recibo propios. Trabajar sobre
copias y registrar todos los hashes resultantes.

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
   pendiente, y volver a empaquetar localmente con esos mismos recursos. No volver a
   invocar `tauri build`. Si faltan los recursos de empaquetado, esta ruta
   queda pendiente; el instalador existente no acredita una release completa.
4. Usar el bloque de eSigner existente en `publish.yml`, conservando el pin
   SHA-256 de CodeSignTool 1.3.2, el certificado raíz SSL.com y la separación
   de ventanas TOTP. Firmar el setup final después de empaquetar. No firmar
   dependencias de `work-tools`.
5. Repetir instalación en laboratorio. Exigir firma válida de Danil y sello
   de tiempo en los ejecutables requeridos y el setup, y conservar el listado
   de archivos instalados. Sólo entonces crear la firma minisign del setup.

Si sólo GitHub conserva los cuatro secrets de SSL.com, la alternativa son dos
despachos manuales con hashes fijados. El primero (`windows_mode: internals`)
devuelve main y motor firmados. Se descargan y se reempaquetan localmente sin
secrets de GitHub. Tras QA y revisión del nuevo paquete, un segundo despacho
(`windows_mode: installer`) recibe otro ZIP y firma el setup y su minisign
en un runner nuevo. NSIS nunca entra ni se ejecuta en los runners de firma.
Sin compilación, tags, releases,
actualización de `latest.json` ni permisos de publicación. El borrador está en
`.github/workflows/sign-existing-candidate.yml`; falta resolver la autorización
de Actions y acreditar los recursos locales de NSIS. La candidata rc1 examinada por el
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
del minisign de Desktop, el estado Authenticode del motor rc1 ni la conservación
de recursos NSIS locales. La credencial API Apple sólo se encontró en GitHub.
Esos datos determinan cuál de las rutas anteriores puede ejecutarse.

## Contrato del job propuesto

Es un borrador sin ejecución de plataforma. Sólo acepta despacho manual en
`danil-labs/terminus`, con permiso `contents: read`; conserva outputs de revisión
durante siete días. No se sube este workflow sin decisión del coordinador.

Entradas: OID completo del código compilado, tag de una pre-release de inputs
revisados y SHA-256 externo de cada ZIP y cada recibo de build/QA. Un hash
de ZIP vacío omite esa plataforma. Los ZIP
se llaman `windows-signing-input.zip`, `macos-signing-input.zip` y
`linux-signing-input.zip` y contienen
un `manifest.json` con `source_oid`, `version: "0.3.0-rc.1"`, `platform`,
`files` (mapa ruta relativa → SHA-256) y `links` (ruta → destino de symlink).
Antes de extraer, `scripts/candidate-archive.py` inspecciona todas las entradas:
rechaza rutas absolutas, traversal, duplicados y alias de mayúsculas/Unicode,
entradas especiales, límites excesivos y escapes/ciclos de enlaces. No crea
el directorio de extracción hasta completar esa inspección. Sólo macOS admite
symlinks internos, creados al final y nunca seguidos para escribir.

Se exige inventario exhaustivo con `files`/`links` disjuntos. Los roles de
firma son archivos regulares con realpath directo y hash acreditado. El `.app`
es un directorio real, con plist y ejecutable regulares.

Los recibos externos se llaman `windows-build-receipt.json`,
`macos-build-receipt.json` y `linux-build-receipt.json`. Su SHA-256 se introduce
por separado al despachar; no se confía en un recibo declarado por el ZIP.
Tienen `source_oid`, `version`, `identifier: "ai.danil.terminus"`,
`product_name: "Terminus"`, `platform`, `qa_evidence` y `artifacts` con hashes
por rol. El coordinador revisa la atribución al build/QA antes de autorizar
ese hash. Ni un OID escrito en JSON ni un hash autoafirmado prueban por sí
solos cómo se compilaron los bytes.

Windows declara `windows_mode`. Para `internals` sólo acepta los roles `main`
y `engine`, los dos archivos inventariados; para `installer`, sólo `installer`.
No admite otros archivos, enlaces ni scripts. El segundo modo añade
`signed_payloads: {main: {member, sha256}, engine: {member, sha256}}` con rutas
exactas de los binarios dentro de NSIS y hashes del primer despacho. El recibo
externo fija esos mismos hashes en `signed_payloads: {main: hash, engine: hash}`.
7-Zip lee sólo esos miembros, sin ejecutar el setup; sus hashes, firmas y
metadatos se comprueban antes de entregar secrets al paso de firma.

La candidata original tiene AMD64 para main/motor, I386 para el launcher
NSIS, `ProductName: Terminus` y `ProductVersion: 0.3.0-rc.1` para main/setup.
El motor no tiene VERSIONINFO; PE no tiene bundle ID nativo. No se inventan
esos campos; la identidad se ata también al recibo externo.

macOS contiene `Terminus.app` y `template.dmg`, con roles `app` y `dmg` de esos
nombres exactos, y `architectures` (`["arm64"]` para la candidata original).
Antes de usar secrets se verifican plist, lipo, Developer ID y hardened runtime
y se monta el DMG sólo para lectura. `dmg_layout: {files, links, directories}`
inventaría todos sus archivos, enlaces y directorios, incluido el `.app`, que debe coincidir con el
del ZIP. Sólo el enlace `Applications → /Applications` admite destino externo.
Se exigen `.DS_Store`, `.VolumeIcon.icns` y `.background.tiff`. Se rechaza
contenido adicional y se compara también el layout del DMG final con el `.app`
final grapado. El recibo externo liga `artifacts.dmg` y `artifacts.main` a sus
hashes originales.

El DMG debe tener capacidad para reemplazar su app y conservar
la disposición existente. Su conversión y el reemplazo no se han ensayado en
esta preparación. Si falta espacio, el job falla y requiere otro template;
no compila ni modifica herramientas como respaldo.

Linux añade `appimage`, ruta al AppImage inventariado, y `squashfs_offset`
revisado. Se comprueba ELF AMD64, AppImage tipo 2, Name/Exec del `.desktop` e
identificador embebido; `unsquashfs -cat` lee el payload sin ejecutarlo ni
extraer su árbol. ELF no tiene versión de aplicación estructurada. La versión
se atribuye exclusivamente al recibo externo de build/QA ligado por hash al
AppImage; el recibo final conserva esa limitación. Ubuntu firma y verifica
los bytes existentes; no ejecuta el AppImage ni instala Rust.

Los scripts de firma son `scripts/sign-existing-windows.ps1` y
`scripts/sign-existing-macos.sh`. El validador y la verificación con la pubkey
instalada viven en `scripts/candidate-signing.mjs`. La firma minisign se aplica
al final, usando Tauri CLI `2.11.4` fijado en el lock actual.

El job entrega instaladores, firmas, recibos de notarización y un recibo que
mantiene `installed_qa: pending`. La instalación y el arranque desde esos bytes
finales siguen siendo requisito antes de publicar. No confundir un job verde
de firma con QA de una candidata distribuible.

El recibo final fija `updater_pubkey_sha256` a
`dd20ff2f22272128f403eb4ab852c00890bdc8aae0e70f3fb4c62ec2d031022a`,
hash del valor base64 instalado; si cambia, falla. Incluye hashes de outputs,
OID del workflow, OID del build, hash del ZIP y hash del recibo externo.

## Despacho sin promover código a main

GitHub exige que el workflow manual esté registrado en la rama predeterminada;
permite seleccionar otra rama con `--ref`. El nuevo archivo
`sign-existing-candidate.yml` no acredita ese registro. Véanse
[GitHub: ejecución manual](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
y [CLI: workflow run](https://cli.github.com/manual/gh_workflow_run).

La consulta de sólo lectura confirmó que `publish.yml` ya está registrado con
ID `369790415`, estado `active`. La alternativa preparada es una rama aislada,
`build/sign-existing-dispatch`, donde ese archivo se reemplaza enteramente por
el dispatcher de firma aquí descrito y se elimina el workflow nuevo duplicado.
Esa rama no se integra a `dev` ni a `main`. El workflow original de publicación
permanece intacto en ambas ramas compartidas. No despachar `publish.yml` desde
`dev`, `main` o un ref distinto: allí todavía puede compilar/publicar.

Antes de un despacho autorizado, fijar el OID completo aprobado de la rama de
firma y comprobar por lectura que la rama remota aún apunta a él. El input
`workflow_oid` debe ser ese OID; `source_oid` es el OID del código de los binarios
existentes y puede ser distinto. Cada job comprueba `GITHUB_SHA` y el SHA de la
definición contra `workflow_oid` antes de checkout/secrets; checkout usa ese SHA
del evento explícitamente. Si la rama se mueve antes de despachar, falla antes
de usar secrets. El recibo conserva ambos OIDs.

El mecanismo propuesto usa el ID existente y `--ref build/sign-existing-dispatch`,
con inputs JSON revisados. No se ejecutó ese comando ni se subió la rama. Su
aceptación por GitHub queda por comprobar después de la autorización específica;
el registro existente y la documentación no sustituyen esa comprobación real.

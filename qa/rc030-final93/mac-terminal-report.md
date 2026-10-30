# Mac QA93: cierre sin aprobación

OID exacto: `93eeb9ef51b71f3cece7fa04942fa76e3b15adc2`. Fuente limpia, versión `0.3.0-rc.1`, pin `4e10efc24a9be6f8dbf15559f767a50fb109a0a7`. Un build normal Tauri; sin rebuild ni cambios de fuente.

Build, inventario canónico y smoke de runtimes sin PATH global: PASS. Firma Developer ID app y DMG: PASS. Procedencia del motor igual al pin tras quitar firma en copias y normalizar exclusivamente __LINKEDIT vmsize. Inventario de la app original sin cambios al cierre. Gatekeeper exit 3; stapler exit 65; sin notarización ni updater: NO apta para clientes.

QA nativo INCOMPLETO. Arranque y onboarding hasta principal comprobados, título Danil. Personalize muestra contenido central en blanco y botones Back / I’ll do it later / Start; Start permite llegar a principal. No se atribuye PASS a personalización ni se establece causa. Captura: `isolated-personalize.png`.

Aparecieron tareas/historial no originados por este operador, incluso después de usar bundle ID, HOME y raíz propios. Se detuvo el turno no reconocido en UI y se comprobó Interrupted. No se acreditan dos turnos propios, archivo/visor/persistencia, carpeta adjunta ni aislamiento completo. No se investigó la causa ni se modificó producción. Procesos de laboratorio 99869 y 99921 detenidos; no quedaron descendientes proveedor en el árbol al cierre. No se alteró instalación o motor global ni se apagó la Mac.

Rust: cargo check --locked PASS; cargo test --locked PASS, 35 tests. cargo fmt --all -- --check FAIL exit 1: crates/engine-protocol/src/lib.rs:97 requiere salto de línea. Clippy -D warnings FAIL exit 101: src/extracted/typst_live.rs:369:39 y 385:40 explicit_auto_deref; 559:13 while_let_loop; src/extracted/update.rs:118:10 unnecessary_fold. Baseline no comparado: no se califican como heredados. Rust 1.96.0 ac68faa20; Cargo 1.96.0; Clippy 0.1.96. Cache .rustc_info.json y lectura actual coinciden; versión inicial no capturada por separado en build.log, no hubo cambio de toolchain por este operador.

Logs: rust-checks.log, rust-remaining.log, rust-results.json, build.log, runtime-smoke.log. Metadatos, hashes, bytes, firma, inventario y límites completos en ../mac-status.json. No hay secretos ni contenido de DB en este informe.

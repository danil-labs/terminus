Terminus estrena motor. La ventana y el motor que hace el trabajo pasan a ser dos programas: el motor sigue con tus tareas aunque cierres la ventana, y la ventana lo vuelve a arrancar si se cae.

- **Tus datos se quedan donde están.** Al abrirla por primera vez, Terminus pasa tus workspaces, tareas, cuentas y bóveda de 0.2.74 al motor nuevo sin copiarlos.
- **Cierra Terminus 0.2.74 antes.** Si sigue abierta, Terminus espera a que termine sus tareas: no cierra nada a la fuerza.
- **Para volver a 0.2.74**, cierra esta ventana y espera a que el motor se apague (5 minutos sin ventanas). Después instala 0.2.74 desde su página de release: abre la misma carpeta de datos. Si el motor no arranca, Terminus te dice por qué y dónde está su registro.
- **Instalar y desinstalar** esperan a que el motor termine: si hay una tarea en curso, el instalador avisa y no instala.

**Limitación conocida.** La vista en vivo de Typst no funciona en esta versión: el PDF no se muestra al lado del documento. Los sitios locales (las páginas de `localhost` que abre una tarea) sí funcionan.

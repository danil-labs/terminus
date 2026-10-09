Terminus estrena motor. La ventana y el motor que hace el trabajo pasan a ser dos programas: el motor sigue con tus tareas aunque cierres la ventana, y la ventana lo vuelve a arrancar si se cae.

- **Tus datos se quedan donde están.** La primera vez, Terminus pasa tus workspaces, tareas, cuentas y bóveda al motor nuevo sin copiarlos. Te pide cerrar Terminus 0.2.74 y espera a que termine sus tareas: no se cierra nada a la fuerza.
- **Si el motor no arranca**, Terminus te dice por qué, dónde está su registro y cómo volver a 0.2.74, que abre la misma carpeta de datos.
- **Instalar y desinstalar** esperan a que el motor termine: si hay una tarea en curso, el instalador avisa y no instala.

**Limitación conocida.** La vista en vivo de Typst no funciona en esta versión: el PDF no se muestra al lado del documento. Los sitios locales (las páginas de `localhost` que abre una tarea) sí funcionan.

Terminus 0.2.88 vuelve a mostrar las figuras de tareas en otras máquinas y mejora las vistas temporales y los avisos.

- **Figuras de otras máquinas.** Las visualizaciones del chat de tareas que corren en una VM vuelven a mostrarse en la app de escritorio.
- **Vistas temporales.** Conserva las vistas que necesitas; al sustituir una vista o cerrar un documento, la app protege el trabajo sin guardar y la distribución elegida.
- **Contexto en la web.** Los archivos de contexto se leen y se guardan en la máquina que los contiene.
- **Avisos de mantenimiento.** Las comprobaciones habituales quedan en Registros. Sólo las fallas e interrupciones muestran avisos, y los eventos repetidos no vuelven a abrir un aviso descartado.
- **Consumo empresarial.** Las organizaciones que habilitan el reporte pueden recuperar el consumo histórico del workspace vinculado a su cuenta, con envío automático y sin volver a sumar registros ya recibidos.
- **Almacenamiento por máquina.** Consulta el uso de disco de cada máquina y dirige la limpieza a la máquina y al workspace seleccionados. La capacidad y el espacio libre corresponden al volumen donde reside el motor. En la web móvil, abre Almacenamiento dentro de Consumos para ver el disco por máquina y medir el workspace.
- **Actualizar en Linux.** Si tu carpeta de Terminus venía de una versión anterior con permisos de grupo (umask 002, lo normal en Ubuntu), el motor nuevo ya no se niega a arrancar con «authority_incompatible»: quita ese permiso a sus propias carpetas y sigue, sin tocar tus datos. Con ese umask, una instalación nueva también arranca.
- **Tareas en otra máquina.** El árbol de archivos de una tarea que corre en otra máquina se lee en esa máquina, y una imagen que adjuntas desde la Mac llega a la máquina de la tarea.
- **Teléfono.** Lo que te escribe un agente u otra tarea sale a la izquierda, con su nombre, y el mensaje que mandas a una VM apagada se queda visible mientras enciende.
- **Typst.** La vista en vivo se abre sin tener que elegir antes el archivo principal.

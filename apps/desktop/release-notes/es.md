Terminus 0.2.87 arregla la actualización en Linux y trae varios arreglos entre máquinas.

- **Almacenamiento por máquina.** Consulta el uso de disco de cada máquina y dirige la limpieza a la máquina y al workspace seleccionados. La capacidad y el espacio libre corresponden al volumen donde reside el motor.
- **Actualizar en Linux.** Si tu carpeta de Terminus venía de una versión anterior con permisos de grupo (umask 002, lo normal en Ubuntu), el motor nuevo ya no se niega a arrancar con «authority_incompatible»: quita ese permiso a sus propias carpetas y sigue, sin tocar tus datos. Con ese umask, una instalación nueva también arranca.
- **Tareas en otra máquina.** El árbol de archivos de una tarea que corre en otra máquina se lee en esa máquina, y una imagen que adjuntas desde la Mac llega a la máquina de la tarea.
- **Teléfono.** Lo que te escribe un agente u otra tarea sale a la izquierda, con su nombre, y el mensaje que mandas a una VM apagada se queda visible mientras enciende.
- **Typst.** La vista en vivo se abre sin tener que elegir antes el archivo principal.

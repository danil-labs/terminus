Terminus 0.2.89 es una pre-release del instalador con herramientas de trabajo incluidas. También carga el trabajo disponible sin esperar a una VM que no responde y dirige el composer a la máquina elegida.

- **Herramientas incluidas.** Git portable, Python privado con uv y bibliotecas para hojas de cálculo, documentos, presentaciones, PDF e imágenes; ripgrep, agent-browser nativo, visor draw.io y Cua Driver.
- **Navegación explícita.** Chrome for Testing se descarga al activar la navegación, con progreso, cancelación y reintento. No forma parte de los recursos base.
- **Preparación ligera.** Node/npm y los gestores del proyecto se instalan por decisión de la persona. Bun deja de recomendarse en la preparación; una instalación existente se conserva.
- **Activaciones.** Cua comienza desactivado. Se conservan las activaciones existentes y las decisiones de desactivar draw.io.
- **Actualización recuperable.** El motor importa las herramientas en versiones separadas y conserva la anterior para recuperación.
- **Carga por máquina.** La web muestra las tareas disponibles y las copias guardadas mientras consulta las demás máquinas. Las respuestas tardías actualizan la lista sin duplicarla, y abrir una tarea conserva las filas que ya estaban visibles.
- **Crear y adjuntar donde elegiste.** El composer consulta los proyectos y las ramas de la máquina seleccionada, y crea o adjunta el trabajo allí. Llevar trabajo desde otra máquina conserva su flujo explícito.
- **VM apagada desde el teléfono.** Enviar un mensaje usa el encendido de la VM aunque la copia guardada tenga un turno que parecía seguir activo. Consumos muestra la copia y su fecha sin encender la máquina.
- **Permisos entre ventanas.** Una decisión retira el aviso de permiso en las demás ventanas. Vincular un workspace desde el escritorio actualiza el contexto de la web sin recargar la página.

El motor y los recursos se fijan por versión y SHA-256. En Linux, si AppArmor impide iniciar Chrome con sandbox, la navegación permite autorizar una regla limitada a ese navegador mediante el diálogo del sistema. La creación de archivos Office no incluye recálculo ni renderizado de Office sin LibreOffice, que permanece opcional.

Terminus 0.2.88 es una candidata local del instalador con herramientas de trabajo incluidas. Todavía no está publicada.

- **Herramientas incluidas.** Git portable, Python privado con uv y bibliotecas para hojas de cálculo, documentos, presentaciones, PDF e imágenes; ripgrep, agent-browser nativo, visor draw.io y Cua Driver.
- **Navegación explícita.** Chrome for Testing se descarga al activar la navegación, con progreso, cancelación y reintento. No forma parte de los recursos base.
- **Preparación ligera.** Node/npm y los gestores del proyecto se instalan por decisión de la persona. Bun deja de recomendarse en la preparación; una instalación existente se conserva.
- **Activaciones.** Cua comienza desactivado. Se conservan las activaciones existentes y las decisiones de desactivar draw.io.
- **Actualización recuperable.** El motor importa las herramientas en versiones separadas y conserva la anterior para recuperación.

La candidata usa un motor local y recursos fijados por SHA-256; el lock del motor publicado sigue separado. La verificación nativa de macOS y Windows y el tamaño del instalador universal de macOS siguen pendientes. La creación de archivos Office no incluye recálculo ni renderizado de Office sin LibreOffice, que permanece opcional.

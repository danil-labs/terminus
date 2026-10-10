Terminus 0.2.77 devuelve la línea de comandos a `terminus` y corrige el arranque del motor en Linux.

- **`terminus <comando>` vuelve a funcionar en la terminal.** Desde la 0.2.75, en Windows, macOS y Linux, el ejecutable de Terminus solo abría la ventana y los comandos respondían «cli.error.invalid_request». Ahora los reenvía al motor y devuelve su salida y su código de salida, también en una consola de Windows.
- **Linux: git por HTTPS vuelve a funcionar en las tareas.** El motor ya no hereda las bibliotecas ni el directorio del AppImage, y el montaje se libera al cerrar la ventana.
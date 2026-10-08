# Maya yucateco (`yua`)

Paquete de lengua Maayatʼaan, versión `0.1.0`. Contiene catálogos JSON y un
perfil de salida para el agente. Las claves sin traducción usan el respaldo
embebido de la app.

| Archivo | Contenido |
|---|---|
| `manifiesto.json` | Contrato 2, código yua, formato es-MX y canales |
| Catálogos JSON | Frases y placeholders |
| `salida.json` | Instrucciones, glosario y referencias del agente |
| [GLOSSARY](GLOSSARY.md) | Términos del producto y fuentes |

`salida.json` se declara en `salida.perfil` y queda fuera del conteo de claves.
`formato` usa `es-MX`; `Intl` no incorpora `yua` como formato regional.
El saltillo se escribe como `U+02BC` (`ʼ`).

## Instalar y verificar

Configuración permite instalar el paquete incluido en el bundle o elegir una
carpeta local. La app copia los JSON a `<app data>/lenguas/yua/`; los Markdown
permanecen en el repositorio. El paquete no se incorpora a `src/locales/`, que
contiene los catálogos embebidos.

```bash
node scripts/plugins.mjs
```

El comando valida manifiesto, claves, placeholders y saltillos, y calcula la
cobertura contra el catálogo actual. La cobertura parcial se admite.

## Estado de revisión

El manifiesto identifica este contenido como borrador sin revisión de hablante.
Los términos de software del glosario son propuestas de este paquete; las
fuentes citadas aportan ortografía y usos de la lengua. La validación lingüística
requiere revisión por una persona hablante de maya yucateco.

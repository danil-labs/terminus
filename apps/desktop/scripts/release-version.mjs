const number = "(?:0|[1-9]\\d*)";
const identifier = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const version = new RegExp(`^${number}\\.${number}\\.${number}(?:-${identifier}(?:\\.${identifier})*)?$`);

// El instalador identifica releases estables o de prueba, sin metadatos de compilación.
export const isReleaseVersion = (value) => typeof value === "string" && version.test(value);

// La clave selecciona la arquitectura en latest.json. Sin entrada publicada,
// el instalador informa que todavía no hay build para esa plataforma.

const LABELS = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
};

const ARCH_LABELS = {
  x64: 'x64',
  arm64: 'ARM64 (Apple Silicon)',
  ia32: 'x86 32-bit',
};

// process.platform x process.arch -> clave de plataforma de Tauri updater.
function tauriPlatformKey(platform, arch) {
  const archKey = arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : null;
  if (!archKey) return null;
  switch (platform) {
    case 'win32':
      return `windows-${archKey}`;
    case 'darwin':
      return `darwin-${archKey}`;
    case 'linux':
      return `linux-${archKey}`;
    default:
      return null;
  }
}

export function detectPlatform() {
  const platform = process.platform;
  const arch = process.arch;
  const label = `${LABELS[platform] || platform} ${ARCH_LABELS[arch] || arch}`;
  return {
    platform,
    arch,
    label,
    key: tauriPlatformKey(platform, arch),
    // Qué hay que hacer con lo que se baja, que no es lo mismo en las dos:
    // Windows recibe un instalador que se ejecuta, y macOS el `.app`
    // comprimido, que se descomprime y se copia. Linux existe para dar el
    // mensaje correcto mientras no haya build.
    installerKind:
      platform === 'win32' ? 'windows-nsis' : platform === 'darwin' ? 'macos' : platform === 'linux' ? 'linux' : 'unknown',
  };
}

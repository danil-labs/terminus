// The key selects the architecture in latest.json. With no published entry,
// the installer reports that there is no build for that platform yet.

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

// process.platform x process.arch -> Tauri updater platform key.
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
    // What to do with the download, which differs between the two: Windows
    // gets an installer to run, and macOS gets the compressed `.app`, which is
    // unpacked and copied. Linux exists to give the right message while there
    // is no build.
    installerKind:
      platform === 'win32' ? 'windows-nsis' : platform === 'darwin' ? 'macos' : platform === 'linux' ? 'linux' : 'unknown',
  };
}

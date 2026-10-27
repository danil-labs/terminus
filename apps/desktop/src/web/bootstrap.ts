async function bootstrap() {
  const parameters = new URLSearchParams(window.location.search);
  if (import.meta.env.TERMINUS_ALPHA && parameters.get('demo') === '1') {
    const { beginDemoIsolation } = await import('./attention/demo');
    beginDemoIsolation();
  }
  await import('./main');
}

void bootstrap().catch(error => {
  console.error(error);
  const root = document.getElementById('root');
  if (root) {
    root.setAttribute('role', 'alert');
    root.textContent = error instanceof Error ? error.message : String(error);
  }
});

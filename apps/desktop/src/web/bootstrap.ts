import "../styles/global.css";

async function bootstrap() {
  const parameters = new URLSearchParams(window.location.search);
  if (import.meta.env.TERMINUS_ALPHA && parameters.get('demo') === '1') {
    const { beginDemoIsolation } = await import('./attention/demo');
    beginDemoIsolation();
  }
  await import('./main');
}

void bootstrap().catch(async error => {
  console.error(error);
  const root = document.getElementById('root');
  if (root) {
    root.setAttribute('role', 'alert');
    const { prosaDe } = await import("../ui/Failure");
    root.textContent = prosaDe(error);
  }
});

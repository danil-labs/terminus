const parameters = new URLSearchParams(window.location.search);
if (import.meta.env.TERMINUS_ALPHA && parameters.get('demo') === '1') {
  const { beginDemoIsolation } = await import('./attention/demo');
  beginDemoIsolation();
}
await import('./main');

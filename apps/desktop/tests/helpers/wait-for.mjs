export async function waitFor(read, message, timeout = 5000) {
  const deadline = performance.now() + timeout;
  do {
    const value = read();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  } while (performance.now() < deadline);
  throw new Error(message);
}

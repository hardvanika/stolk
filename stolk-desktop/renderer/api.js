// Thin client for the local server. Calls go through Electron main (window.stolk.call), which adds the token.
window.Api = (() => {
  async function call(method, route, body) {
    if (!window.stolk?.call) throw new Error('Sin conexión con el servidor local');
    const res = await window.stolk.call(method, route, body);
    if (res.status >= 400) throw new Error(res.body?.error?.message || `Error ${res.status}`);
    return res.body;
  }
  return {
    get: (r) => call('GET', r),
    post: (r, b) => call('POST', r, b ?? {}),
    patch: (r, b) => call('PATCH', r, b),
    put: (r, b) => call('PUT', r, b),
    del: (r) => call('DELETE', r),
    ready: () => (window.stolk?.apiReady ? window.stolk.apiReady() : Promise.resolve(false)),
  };
})();

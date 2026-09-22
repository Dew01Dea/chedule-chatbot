const path = require("path");

/**
 * Mounts the real Express app with the store and Typhoon client replaced.
 *
 * Both are swapped through require.cache before server.js is loaded, so the
 * routes, middleware, validation and error handling under test are the real
 * ones — only the database and the network calls are stubbed.
 */
const BACKEND_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Drops every cached module belonging to this project, leaving dependencies
 * alone. Without this the route modules stay cached between mounts and keep
 * the *first* test's stubs, so later tests silently exercise an earlier
 * test's store.
 */
function purgeProjectModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(BACKEND_ROOT) && !key.includes(`${path.sep}node_modules${path.sep}`)) {
      delete require.cache[key];
    }
  }
}

function loadAppWith({ store, typhoon }) {
  const storePath = require.resolve("../../store");
  const typhoonPath = require.resolve("../../services/typhoonService");
  const serverPath = require.resolve("../../server");

  const realTyphoon = require(typhoonPath);

  purgeProjectModules();

  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    path: path.dirname(storePath),
    loaded: true,
    exports: store,
  };

  require.cache[typhoonPath] = {
    id: typhoonPath,
    filename: typhoonPath,
    path: path.dirname(typhoonPath),
    loaded: true,
    // Keep the real helpers; stub only what would hit the network.
    exports: { ...realTyphoon, ...typhoon },
  };

  const app = require(serverPath);

  return {
    app,
    cleanup() {
      purgeProjectModules();
    },
  };
}

/** Starts the app on an ephemeral port and returns a fetch bound to it. */
async function startServer(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();

  return {
    async request(pathname, options = {}) {
      const response = await fetch(`http://127.0.0.1:${port}${pathname}`, options);
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      return { status: response.status, body };
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { loadAppWith, startServer };

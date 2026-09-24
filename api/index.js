/**
 * The Express app, as a single Vercel serverless function.
 *
 * server.js already exports the app without listening (it only calls listen
 * when run directly), so the same app serves both a container and this.
 * vercel.json rewrites every /api/* request here, because one function keeps
 * Express's routing intact rather than splitting the routes across files.
 *
 * Uploads work here too. poppler cannot be installed into a function, so PDFs
 * are rasterized with pdf.js instead (services/pdfToImages.js); what remains
 * are the platform's own limits on a request, which the README's Deployment
 * section lists.
 */

const app = require("../backend/server.js");

module.exports = (req, res) => {
  // Depending on how the request matched, the rewrite may hand this function
  // the original path or the destination one. The app mounts its routers under
  // /api, so anything arriving without that prefix is restored to the shape
  // the routers expect; a path that already carries it is left alone.
  if (!req.url.startsWith("/api")) {
    req.url = req.url === "/" ? "/api" : `/api${req.url}`;
  }

  return app(req, res);
};

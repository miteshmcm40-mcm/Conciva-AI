// Vercel serverless entry point. Vercel treats any request under /api/* as
// a call to this function (see the rewrite in vercel.json that funnels every
// /api/* path here) and hands it a plain (req, res) — which is exactly the
// signature an Express app already has, so no adapter is needed.
import app from '../server/index.js';

export default app;

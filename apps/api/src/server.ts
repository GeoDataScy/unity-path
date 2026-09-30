import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (i) => {
  console.log(`API v2 em http://localhost:${i.port}/api/v1`);
});

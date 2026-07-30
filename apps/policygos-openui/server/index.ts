import { serve } from "@hono/node-server";
import { createPolicyApi } from "./app.js";
import { readServerConfig } from "./config.js";

const config = readServerConfig();
const app = createPolicyApi(config);

serve({
  fetch: app.fetch,
  hostname: config.host,
  port: config.port
});

console.log(`PolicyGOS API listening on http://${config.host}:${config.port}`);

import { getStore } from "@netlify/blobs";
import { makeHandler } from "../../lib/core.mjs";
import { makeWix } from "../../lib/wix.mjs";

const getEnv = (k) => (globalThis.Netlify && globalThis.Netlify.env.get(k)) ?? process.env[k];

export default async (req) => {
  const env = {
    APP_PASSWORD: getEnv("APP_PASSWORD"),
    TOKEN_SECRET: getEnv("TOKEN_SECRET"),
    URL: getEnv("URL"),
  };
  const store = getStore({ name: "tack", consistency: "strong" });
  const wix = makeWix({ apiKey: getEnv("WIX_API_KEY"), siteId: getEnv("WIX_SITE_ID") });
  return makeHandler({ store, wix, env })(req);
};

export const config = { path: "/api/*" };

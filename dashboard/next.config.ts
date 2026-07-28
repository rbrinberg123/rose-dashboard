import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Admin → Docs page reads the markdown docs, vercel.json, and .env.example
  // from disk at request time. On Vercel, serverless functions only include files
  // Next.js traced as imports — fs reads aren't traced — so force these into the
  // /admin/docs function bundle. Without this the page's file reads fail in prod
  // (they fail soft to "unavailable", but we want them to actually work).
  outputFileTracingIncludes: {
    "/admin/docs": ["./content/docs/**/*.md", "./vercel.json", "./.env.example"],
  },
};

export default nextConfig;

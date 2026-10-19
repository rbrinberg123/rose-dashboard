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
  // Let proxy.ts see the `next-router-prefetch` header (Next strips it from the
  // proxy's request otherwise) so link prefetches can skip the session refresh —
  // see "How the session is checked on each request" in
  // content/docs/01-access-and-users.md. Side effect: the proxy's URL keeps the
  // internal `_rsc` query param (proxy.ts drops it from the /login `next=`).
  skipProxyUrlNormalize: true,
  // Marketing Memo document upload (app/tasks/memo-upload-actions.ts): files are
  // capped at 4 MB (MEMO_FILE_MAX_BYTES); the default 1 MB server-action limit
  // would refuse them. 4.5 MB leaves room for the multipart overhead and matches
  // Vercel's own request-body cap, so it can't be raised further usefully.
  experimental: {
    serverActions: { bodySizeLimit: "4.5mb" },
  },
};

export default nextConfig;

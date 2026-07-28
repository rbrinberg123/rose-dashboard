"use client"

import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import Link from "next/link"

/**
 * Renders a documentation markdown string with GitHub-flavored-markdown support
 * (tables, etc.), styled on-brand. Kept as a client component so react-markdown
 * renders reliably regardless of the server/RSC boundary; it takes a plain
 * string prop, so nothing heavy crosses the wire.
 *
 * Internal doc links (e.g. "04-views.md" or "./04-views.md") are rewritten to
 * the in-app route (`/admin/docs?doc=04-views`) so navigation stays inside the
 * reader. External links open in a new tab.
 */
export function DocContent({ markdown }: { markdown: string }) {
  return (
    <div className="text-[14px] leading-relaxed text-[#1A2233]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-4 mt-2 text-2xl font-semibold text-[#1E2858]">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-3 mt-8 border-b border-[#EDEFF3] pb-1.5 text-lg font-semibold text-[#1E2858]">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-6 text-[15px] font-semibold text-[#1A2233]">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="mb-1.5 mt-4 text-[14px] font-semibold text-[#5B6472]">{children}</h4>
          ),
          p: ({ children }) => <p className="my-3 text-[#26303F]">{children}</p>,
          ul: ({ children }) => <ul className="my-3 ml-5 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-3 ml-5 list-decimal space-y-1">{children}</ol>,
          li: ({ children }) => <li className="text-[#26303F]">{children}</li>,
          a: ({ href, children }) => {
            const raw = href ?? ""
            const internal = /^\.?\/?[0-9A-Za-z_-]+\.md(#.*)?$/.test(raw)
            if (internal) {
              const slug = raw.replace(/^\.?\//, "").replace(/\.md.*$/, "")
              return (
                <Link href={`/admin/docs?doc=${slug}`} className="text-[#0355A7] underline-offset-2 hover:underline">
                  {children}
                </Link>
              )
            }
            const isExternal = /^https?:\/\//.test(raw)
            return (
              <a
                href={raw}
                {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="text-[#0355A7] underline-offset-2 hover:underline"
              >
                {children}
              </a>
            )
          },
          code: ({ className, children }) => {
            const isBlock = (className ?? "").includes("language-")
            if (isBlock) {
              return <code className={className}>{children}</code>
            }
            return (
              <code className="rounded bg-[#F1F3F7] px-1.5 py-0.5 font-mono text-[12.5px] text-[#B42318]">
                {children}
              </code>
            )
          },
          pre: ({ children }) => (
            <pre className="my-4 overflow-x-auto rounded-lg border border-[#EAF0F7] bg-[#0B1220] p-4 font-mono text-[12.5px] leading-relaxed text-[#E6E9EF]">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-4 rounded-r border-l-[3px] border-[#0355A7] bg-[#F6F9FD] py-1 pl-4 pr-3 text-[#3A4658]">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded-lg border border-[#EAF0F7]">
              <table className="w-full border-collapse text-[13px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-[#F4F6F9]">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-[#EAF0F7] px-3 py-2 text-left font-semibold text-[#1E2858]">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-[#F1F3F7] px-3 py-2 align-top text-[#26303F]">{children}</td>
          ),
          hr: () => <hr className="my-6 border-[#EDEFF3]" />,
          strong: ({ children }) => <strong className="font-semibold text-[#1A2233]">{children}</strong>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  experimental: {
    // Next.js's App Router caches client-side navigations for a short
    // window by default, so clicking a sidebar link to revisit a page you
    // already viewed can show stale data instead of re-fetching (confirmed
    // Aug 2026: Gold News showed yesterday's articles after navigating via
    // the sidebar, not a hard refresh). Setting this to 0 disables that
    // cache for dynamic routes, so every navigation always fetches fresh.
    staleTimes: {
      dynamic: 0,
    },
  },
};
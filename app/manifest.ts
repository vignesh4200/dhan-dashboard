import type { MetadataRoute } from "next";

// Web app manifest, served by Next.js at /manifest.webmanifest.
// It makes the dashboard installable: on Android, Chrome's "Install app"
// turns it into a real installed app (a WebAPK) with its own icon,
// full-screen window and entry in the app drawer.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/dashboard",
    name: "Dhan Vault — Portfolio Dashboard",
    short_name: "Dhan Vault",
    description: "Personal portfolio dashboard: stocks, mutual funds, gold, dividends, Smart Signals and the Analyst Desk.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b1220",
    theme_color: "#0b1220",
    categories: ["finance"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Holdings", url: "/dashboard/holdings", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Smart Signals", url: "/dashboard/signals", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Analyst Desk", url: "/dashboard/analyst-desk", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}

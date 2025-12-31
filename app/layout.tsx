import type { Metadata } from "next";
import "@mantine/core/styles.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "OpenAPI I/O Explorer Demo",
  description: "Accordion + Schema Tree demo",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

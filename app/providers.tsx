"use client";

import { createTheme, MantineProvider } from "@mantine/core";

const theme = createTheme({
  fontFamily: "var(--font-body)",
  headings: {
    fontFamily: "var(--font-display)",
    fontWeight: "600",
  },
  primaryColor: "teal",
  defaultRadius: "md",
});

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      {children}
    </MantineProvider>
  );
}

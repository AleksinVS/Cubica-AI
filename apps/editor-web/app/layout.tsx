import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@copilotkit/react-core/v2/styles.css";
import "@xyflow/react/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cubica Editor Web",
  description: "ADR-034 authoring manifest editor prototype"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

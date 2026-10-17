import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aegis-999 | Emergency Response Coordination",
  description:
    "A healthcare emergency dispatch control tower for ambulance response coordination in Kuala Lumpur.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

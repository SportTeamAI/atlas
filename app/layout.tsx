import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atlas",
  description:
    "Atlas — Plataforma de gestión de herramientas de uso interno de Talento Humano",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      {/* suppressHydrationWarning: extensiones del navegador (p. ej. Grammarly)
          inyectan atributos en <body> antes de que React hidrate, lo que
          provoca un falso error de hidratación. */}
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}

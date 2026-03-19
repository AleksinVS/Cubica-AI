import StyledComponentsRegistry from '../lib/registry'
import { Montserrat } from "next/font/google";
import "./globals.css";
import { SearchProvider } from "@/context/SearchContext";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin", "cyrillic"],
});



export const metadata = {
  title: "Магазин игр",
  description: "Портал",
};

export default function RootLayout({ children }) {
  return (
    <SearchProvider>
      <html lang="ru">
        <body className={`${montserrat.variable}`}>
          <StyledComponentsRegistry>{children}</StyledComponentsRegistry>
        </body>
      </html>
    </SearchProvider>
  );
}

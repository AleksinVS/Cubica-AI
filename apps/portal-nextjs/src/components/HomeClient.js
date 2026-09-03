"use client";

import { useState } from "react";
import Header from "@/components/Header";
import Aside from "@/components/Aside";
import GameGallery from "@/components/GameGallery";
import MobileFooter from "@/components/MobileFooter";
import MobileAside from "@/components/MobileAside";

export default function HomeClient({ games }) {
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  return (
    <main className="main">
      <Header />
      <div className="flexWrapper">
        <Aside type="main" />
        <GameGallery games={games} />
      </div>

      <MobileFooter openFilter={() => setIsFilterOpen(true)} />
      <MobileAside
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
      />
    </main>
  );
}

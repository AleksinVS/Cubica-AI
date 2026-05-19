'use client'
import Header from "@/components/Header";
import Aside from "@/components/Aside";
import GameGallery from "@/components/GameGallery";
import MobileFooter from "@/components/MobileFooter";
import MobileAside from "@/components/MobileAside";
import { useState } from "react";
import { useSearch } from "@/context/SearchContext";
import { games } from "@/data/games";


export default function Home() {

  const { searchQuery } = useSearch();
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  return (

    <main className="main">
      <Header />
      <div className="flexWrapper">
        <Aside type="main" />
        <GameGallery games={games} searchQuery={searchQuery} /> {/* now uses constext */}
      </div>

      {/* Mobile Components */}
      <MobileFooter openFilter={() => setIsFilterOpen(true)} />
      <MobileAside isOpen={isFilterOpen} onClose={() => setIsFilterOpen(false)} />
    </main>

  );
}

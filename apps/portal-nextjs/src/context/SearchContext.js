"use client";
import { createContext, useContext, useState } from "react";

// Create Context
const SearchContext = createContext();

// Custom Hook to use search context
export const useSearch = () => useContext(SearchContext);

// Provider Component
export const SearchProvider = ({ children }) => {
    const [searchQuery, setSearchQuery] = useState("");

    return (
        <SearchContext.Provider value={{ searchQuery, setSearchQuery }}>
            {children}
        </SearchContext.Provider>
    );
};

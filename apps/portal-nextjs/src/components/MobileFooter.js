"use client";
import { useState } from "react";
import styled from "styled-components";
import { FiSearch, FiFilter, FiX } from "react-icons/fi";

const FooterContainer = styled.div`
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  background: rgb(var(--background));
  display: flex;
  justify-content: space-around;
  padding: 10px 0;
  box-shadow: 0px -2px 5px rgba(0, 0, 0, 0.1);
  z-index: 1000;
  
  @media (min-width: 876px) {
    display: none; /* Hide on desktop */
  }
`;

const FooterButton = styled.button`
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: rgb(var(--theme-yellow));
`;

const SearchContainer = styled.div`
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  background: rgb(var(--background));
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  box-shadow: 0px -2px 5px rgba(0, 0, 0, 0.1);
  z-index: 1100;
  color: #fff;
`;

const SearchInput = styled.input`
 width: 100%;
padding: 10px 10px;
  margin-bottom: 1rem;
  border: 1px solid rgba(var(--theme-yellow), 0.5);
  border-radius: 90px;
  font-size: 16px;
  outline: none;
  background: inherit;
  color: #fff;

  &:focus {
    border-color: rgb(var(--theme-yellow));
  }
`;

const SearchIcon = styled(FiSearch)`
  color: rgb(var(--theme-grey));

  &:hover {
    color: rgb(var(--theme-yellow));
  }
`;

const FilterIcon = styled(FiFilter)`
  color: rgb(var(--theme-grey));

  &:hover {
    color: rgb(var(--theme-yellow));
  }
`;


const MobileFooter = ({ openFilter }) => {
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

    return (
        <>
            {searchOpen ? (
                <SearchContainer>
                    <SearchInput
                        type="text"
                        placeholder="Введите название игры..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <FooterButton onClick={() => setSearchOpen(false)}>
                        <FiX />
                    </FooterButton>
                </SearchContainer>
            ) : (
                <FooterContainer>
                    <FooterButton onClick={() => setSearchOpen(true)}>
                        <SearchIcon />
                    </FooterButton>
                    <FooterButton onClick={openFilter}>
                        <FilterIcon />
                    </FooterButton>
                </FooterContainer>
            )}
        </>
    );
};

export default MobileFooter;

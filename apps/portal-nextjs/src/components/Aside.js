'use client'
import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { FiChevronDown, FiChevronUp, FiFilter, FiSearch } from "react-icons/fi";
import { useSearch } from "@/context/SearchContext";

const AsideContainer = styled.aside`
  width: 300px;
  flex-shrink: 0;
  background-color: inherit;
  color: inherit;
  padding: 0.5rem 1rem;

  /* Is needed if menu is sticky */
  @media(max-width: 875px ){
  padding: 110px 5px;
  }
`;
const SearchContainer = styled.div`
  position: relative;
  width: 100%;
  margin-bottom: 1rem;
`;

const SearchInput = styled.input`
  width: 100%;
padding: 0.75rem 2.5rem 0.75rem 2.5rem; /* Left padding for icon */
  margin-bottom: 1rem;
  border: 1px solid rgba(var(--theme-yellow), 0.5);
  border-radius: 90px;
  font-size: 16px;
  outline: none;
  background: inherit;
  color: inherit;

  &:focus {
    border-color: rgb(var(--theme-yellow));
  }
`;

const SearchIcon = styled(FiSearch)`
  position: absolute;
  left: 10px; 
  top: 37%;
  transform: translateY(-50%);
  font-size: 20px;
  color: rgba(var(--theme-grey), 0.7);
`;


const SectionTitle = styled.h2`
  font-size: 16px;
  font-weight: bold;
  margin-bottom: 10px;
  color: rgb(var(--theme-yellow));
  border-bottom: 1px solid rgba(var(--theme-yellow), 0.4);
  padding: 1.20rem ;
`;

const FilterGroup = styled.div`

`;

const DropdownContainer = styled.div`
  border-radius: 8px;
  position: relative;
  background-color: inherit;
margin-bottom: 5px;

`;

const DropdownHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  cursor: pointer;
  border: ${({ $isOpen }) => ($isOpen ? "1px solid rgb(var(--theme-yellow))" : "1px solid rgb(var(--background))")}; 
  border-radius: 5px;
  padding: 1em .5em;
  font-weight: bold;
  color: ${({ $isOpen }) => ($isOpen ? "rgb(var(--foreground))" : "rgb(var(--theme-grey))")};
  

  &:hover {
   border: 1px solid rgb(var(--theme-yellow));
  }
`;

const DropdownList = styled.div`
  margin-top: 10px;
  display: ${({ $isOpen }) => ($isOpen ? "block" : "none")};
  padding: .25em .5em;
`;

const DropdownListItem = styled.div`
  display: flex;
  align-items: center;
  padding: 5px 0;
  cursor: pointer;

  input {
    margin-right: 10px;
    accent-color: rgb(var(--theme-yellow));
  }
`;



const stopPropagation = (event) => {
    event.stopPropagation();
};





// Reusable Dropdown Component
const Dropdown = ({ title, icon, items, type, stateKey, dropdownState, setDropdownState }) => {
    const isOpen = dropdownState[stateKey];


    return (
        <DropdownContainer>
            <DropdownHeader onClick={() => setDropdownState(prev => ({ ...prev, [stateKey]: !prev[stateKey] }))} $isOpen={isOpen}>
                {icon}
                <span>{title}</span>
                {isOpen ? <FiChevronUp /> : <FiChevronDown />}
            </DropdownHeader>
            <DropdownList $isOpen={isOpen}>
                {items.map((item, index) => (
                    <DropdownListItem key={index}>
                        <input type={type} name={stateKey} value={item.value} onClick={stopPropagation} />
                        {item.label}
                    </DropdownListItem>
                ))}
            </DropdownList>
        </DropdownContainer>
    );
};

const Aside = ({ type }) => {
    const [dropdownState, setDropdownState] = useState({
        sort: false,
        filter: false,
        gameGenre: false,
    });

    const [isMobile, setIsMobile] = useState(false);
    const { setSearchQuery } = useSearch(); // Get function to update search

    useEffect(() => {
        const checkScreenSize = () => {
            setIsMobile(window.innerWidth <= 875);
        };

        checkScreenSize(); // Initial check
        window.addEventListener("resize", checkScreenSize);

        return () => window.removeEventListener("resize", checkScreenSize);
    }, []);

    if (isMobile) return null;

    if (type === 'main') {
        return (
            <AsideContainer>
                <SectionTitle>Поиск</SectionTitle>
                <SearchContainer>
                    <SearchIcon />
                    <SearchInput
                        type="text"
                        placeholder="Введите название игры..."
                        onChange={(e) => setSearchQuery(e.target.value.toLowerCase())}
                    />
                </SearchContainer>
                <FilterGroup>
                    <SectionTitle>Сортировка</SectionTitle>
                    <Dropdown
                        title="Тип сортировки"
                        icon={<FiFilter />}
                        type="radio"
                        stateKey="sort"
                        dropdownState={dropdownState}
                        setDropdownState={setDropdownState}
                        items={[
                            { label: "По алфавиту", value: "alphabet" },
                            { label: "По популярности", value: "popularity" },
                            { label: "По рейтингу", value: "rating" },
                            { label: "По длительности", value: "duration" },
                            { label: "По стоимости", value: "price" },
                            { label: "По дате публикации", value: "date" }
                        ]}
                    />
                </FilterGroup>
                <SectionTitle>Фильтры</SectionTitle>
                <FilterGroup>
                    <Dropdown
                        title="Компетенции"
                        icon={<FiFilter />}
                        type="checkbox"
                        stateKey="filter"
                        dropdownState={dropdownState}
                        setDropdownState={setDropdownState}
                        items={[
                            { label: "Стратегическое мышление", value: "strategic-thinking" },
                            { label: "Лидерство", value: "leadership" },
                            { label: "Работа в команде", value: "teamwork" },
                            { label: "Коммуникация", value: "communication" }
                        ]}
                    />
                </FilterGroup>
                <FilterGroup>
                    <Dropdown
                        title="Жанр игры"
                        icon={<FiFilter />}
                        type="checkbox"
                        stateKey="gameGenre"
                        dropdownState={dropdownState}
                        setDropdownState={setDropdownState}
                        items={[
                            { label: "Настольная игра", value: "board-game" },
                            { label: "Квест", value: "quest" },
                            { label: "Чат бот", value: "chat-bot" }
                        ]}
                    />
                </FilterGroup>

            </AsideContainer>
        );
    }
    if (type === 'game-page') {
        return (
            <AsideContainer>


                ПОИСК
            </AsideContainer>
        );
    }

    if (type === "my-purchases") {
        return (
            <AsideContainer>
                <SectionTitle>Поиск</SectionTitle>
                <SearchContainer>
                    <SearchIcon />
                    <SearchInput
                        type="text"
                        placeholder="Введите название игры..."
                        onChange={(e) => setSearchQuery(e.target.value.toLowerCase())}
                    />
                </SearchContainer>
                <FilterGroup>
                    <SectionTitle>Фильтр ссылок</SectionTitle>
                    <Dropdown
                        title="Отображать ссылки"
                        icon={<FiFilter />}
                        type="radio"
                        stateKey="filter"
                        dropdownState={dropdownState}
                        setDropdownState={setDropdownState}
                        items={[
                            { label: "Все", value: "all-links" },
                            { label: "Активные", value: "active-links" },
                            { label: "Архивные", value: "archive-links" },
                        ]}
                    />
                </FilterGroup>
            </AsideContainer>
        );
    }

    return null;

};

export default Aside;

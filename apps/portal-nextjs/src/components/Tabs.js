"use client";
import { useState } from "react";
import styled from "styled-components";

const TabContainer = styled.div`
  display: flex;
  flex-direction: column;
  background-color: inherit;
  border-radius: 8px;
  width: 100%;
  margin: 0 auto;
  box-shadow: 0px 4px 8px rgba(0, 0, 0, 0.2);
  overflow: hidden;

  @media (min-width: 875px) {
    flex-direction: row;
    box-shadow: none;
  }

`;

const TabHeaders = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;

  @media (min-width: 875px) {
    flex-direction: row;
    border-bottom: 1px solid #333;
  }
`;

const TabHeader = styled.button`
  width: 100%;
  padding: 14px 20px;
  text-transform: uppercase;
  background-color: ${(props) => (props.$active ? "#262626" : "transparent")};
  color: ${(props) => (props.$active ? "rgb(var(--theme-yellow))" : "#aaa")};
  border: none;
  border-bottom: ${(props) => (props.$active ? "2px solid rgb(var(--theme-yellow))" : "2px solid rgb(var(--background));")};
  text-align: left;
  font-size: 16px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.3s ease;

  &:hover {
    color: rgb(var(--theme-yellow));
    background-color: #1c1c1c;
  }

  @media (min-width: 875px) {
    text-align: center;
    flex: 1;
  }
`;

const TabContent = styled.div`
  display: ${(props) => (props.$visible ? "block" : "none")};
  padding: 20px;
  color: #fff;
  font-size: 16px;
  border-top: ${(props) => (props.$visible ? "1px solid #333" : "none")};
  background-color: #1c1c1c;

  @media (min-width: 875px) {
    display: ${(props) => (props.$visible ? "block" : "none")};
  }
`;

const Tabs = () => {
  const [activeTab, setActiveTab] = useState(0); // 1st tab opened initially

  const tabs = [
    { label: "Для чего и кого", content: "Контент для Для чего и кого" },
    { label: "Сюжет игры", content: "Контент для Сюжет игры" },
    { label: "Отзывы", content: "Контент для Отзывы" },
    { label: "Об авторе", content: "Контент для Об авторе" },
    { label: "Поддержка", content: "Контент для Поддержка" },
  ];

  const toggleTab = (index) => {
    setActiveTab(activeTab === index ? null : index);
  };

  return (
    <TabContainer>
      {tabs.map((tab, index) => (
        <div key={index}>
          <TabHeader
            $active={activeTab === index}
            onClick={() => toggleTab(index)}
          >
            {tab.label}
          </TabHeader>
          <TabContent $visible={activeTab === index}>
            {tab.content}
          </TabContent>
        </div>
      ))}
    </TabContainer>
  );
};

export default Tabs;


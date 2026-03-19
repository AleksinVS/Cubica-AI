"use client"
import styled from "styled-components";
import { CiShare2 } from "react-icons/ci"

const Table = styled.table`
 width: 100%;
  border-collapse: separate; /* Changed from collapse */
  border-spacing: 0 10px; 

    @media (max-width: 768px) {
    display: flex;  
    flex-direction: column;
    text-align: center;  
    justify-content: center; 
    align-items: center; 
    padding: 10px;
    position: relative;
  }
`;

const Th = styled.th`
  background-color:rgb(var(--background));
  color: rgb(var(--foreground));
  padding: 10px;
  border-bottom: 1px solid rgba(var(--theme-yellow), 0.8);
  text-align: left;
  font-weight: 400;

    &:nth-child(4) {
    text-align: right;
  }

    @media (max-width: 768px) {
    display: none; 
  }
`;

const Td = styled.td`
  padding: 10px;
  vertical-align: middle;

      /* Right-align only "Все даты" column */
  &:nth-child(4) {
    text-align: right;
  }

    @media (max-width: 768px) {
    display: flex;  
    flex-direction: column;
    text-align: left;
    padding: 10px;
    position: relative;
  }
`;

const DateContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end; 
  gap: 10px;

  @media (max-width: 768px) {
  justify-content: flex-start;
}

`;

const HoverRow = styled.tr`
  transition: all 0.3s ease-in-out;
   border: 1px solid rgba(var(--background), 1);
   border-radius: 5px;

   &:hover,
  &:focus-within {
    box-shadow: 0 0 0 1px rgba(var(--theme-yellow), 1); 
    border-radius: 5px;
    outline: none;
     & > td > button > svg {
      color: rgb(var(--theme-yellow)); 
    }
  }

   @media (max-width: 768px) {
    display: block;
    margin-bottom: 10px; 
    border: 1px solid rgba(var(--theme-yellow), 0.8);
    padding: 15px;
  }
`;

const StyledLink = styled.a`
  text-decoration: none;
  color: rgb(var(--foreground));
  &:hover {
    color: rgb(var(--theme-yellow));
  }
`;

const ShareButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  padding: 5px;
  margin-left: 10px;
  display: flex;
  align-items: center;
  &:hover {
    opacity: 0.7;
  }
`;

const ShareIcon = styled(CiShare2)`
color: rgb(var(--theme-grey));
&:hover {
color: rgb(var(--theme-yellow));
`

const GameLinksTable = ({ games }) => {
  if (!games || games.length === 0) {
    return <p>У вас пока что нет купленных игр</p>;
  }


  const handleShare = (url) => {
    navigator.clipboard.writeText(url);
    alert("Link copied to clipboard!");
  };

  return (
    <Table>
      <thead>

        <tr>
          <Th>Все игры</Th>
          <Th>Ссылки</Th>
          <Th>Все типы</Th>
          <Th>Все даты</Th>
          <Th></Th>
        </tr>
      </thead>
      <tbody>
        {games.map((game) =>
          game.links.map((link) => (
            <HoverRow key={link.id} tabIndex="0">
              <Td>{game.gameName}</Td>
              <Td>
                <StyledLink href={link.url} target="_blank">
                  {link.url}
                </StyledLink>
              </Td>
              <Td>{link.type}</Td>
              <Td>
                <DateContainer>
                  {link.startDate && link.endDate ? (
                    <span>{link.startDate} - {link.endDate}</span>
                  ) : (
                    <span>{link.date}</span>
                  )}
                  <ShareIcon size={20} onClick={() => handleShare(link.url)} />
                </DateContainer>
              </Td>
            </HoverRow>
          ))
        )}
      </tbody>
    </Table>
  );
};



export default GameLinksTable;
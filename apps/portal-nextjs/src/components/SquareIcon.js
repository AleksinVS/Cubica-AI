import React from 'react';
import styled from 'styled-components';

const IconWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid rgb(var(--theme-grey));
  border-radius: 5px;
  background-color: inherit;
  box-shadow: 0px 4px 6px rgba(0, 0, 0, 0.1);
  cursor: pointer;
  transition: all 0.2s ease;

  svg {
    ${({ $variant }) =>
    $variant === 'fill'
      ? `
        fill: rgb(var(--theme-grey));
        stroke: none; /* No stroke for fill-based icons */
      `
      : `
        fill: none; /* No fill for stroke-based icons */
        stroke: rgb(var(--theme-grey));
        stroke-width: 1.5;
      `}
  }

  &:hover {
  border: 1px solid rgba(var(--theme-yellow), 0.7);
    svg {
      ${({ $variant }) =>
    $variant === 'fill'
      ? `
          fill: #ffffff;
        `
      : `
          stroke: #ffffff;
        `}
    }
  }
`;

const SquareIcon = ({ icon, $variant = 'stroke' }) => {
  return <IconWrapper $variant={$variant}>{icon}</IconWrapper>;
};

export default SquareIcon;



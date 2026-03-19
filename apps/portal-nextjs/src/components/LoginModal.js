"use client"
import React, { useState } from "react";
import styled from "styled-components";

const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 999;
`;

const ModalContent = styled.div`
  background: rgb(var(--background));
  padding: 2rem;
  border-radius: 10px;
  width: 400px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(var(--theme-yellow), 0.3);
  position: relative;
  text-align: center;

  h2 {
    padding: 1rem 0;
  }
`;

const CloseButton = styled.button`
  background: transparent;
  border: none;
  font-size: 24px;
  cursor: pointer;
  position: absolute;
  top: 10px;
  right: 10px;
  color: rgb(var(--theme-yellow));

  &:hover {
    color: rgb(var(--foreground));
  }
`;

const StyledInput = styled.input`
  width: 100%;
  padding: 12px;
  margin-bottom: 12px;
  border: 1px solid rgba(var(--theme-grey), 0.5);
  border-radius: 5px;
  font-size: 16px;
  color: rgb(var(--foreground));
  background: rgb(var(--background));

  &:focus {
    outline: none;
    border-color: rgb(var(--theme-yellow));
    box-shadow: 0px 0px 8px rgba(var(--theme-yellow), 0.5);
  }

  &::placeholder {
    color: rgba(var(--foreground), 0.6);
  }
`;

const StyledButton = styled.button`
  width: 100%;
  background: rgb(var(--theme-yellow));
  padding: 10px;
  border: 1px solid rgb(var(--theme-yellow));
  border-radius: 5px;
  color: black;
  text-transform: uppercase;
  font-weight: bold;
  cursor: pointer;
  transition: background 0.3s ease-in-out;

  &:hover {
    background: rgb(var(--theme-grey));
    color: white;
  }
`;

const ToggleText = styled.p`
  margin-top: 10px;
  font-size: 14px;
  color: rgb(var(--theme-grey));
  cursor: pointer;

  &:hover {
    text-decoration: underline;
    color: rgb(var(--theme-yellow));
  }
`;

const LoginModal = ({ isOpen, onClose }) => {
    const [isRegisterMode, setIsRegisterMode] = useState(false);

    if (!isOpen) return null;

    return (
        <ModalOverlay>
            <ModalContent>
                <CloseButton onClick={onClose}>&times;</CloseButton>
                <h2>{isRegisterMode ? "Регистрация" : "Вход"}</h2>

                {/* Sign Up Mode: Add Name Input */}
                {isRegisterMode && (
                    <StyledInput type="text" placeholder="Имя" />
                )}

                <StyledInput type="text" placeholder="Email" />
                <StyledInput type="password" placeholder="Пароль" />

                <StyledButton>{isRegisterMode ? "Зарегистрироваться" : "Войти"}</StyledButton>

                {/* Toggle between Login and Register */}
                <ToggleText onClick={() => setIsRegisterMode(!isRegisterMode)}>
                    {isRegisterMode ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Зарегистрироваться"}
                </ToggleText>
            </ModalContent>
        </ModalOverlay>
    );
};

export default LoginModal;

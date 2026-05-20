"use client"
import React, { useState } from "react";
import styled from "styled-components";
import { loginPortalUser, registerPortalUser } from "@/lib/portalApi";

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

  &:disabled {
    cursor: wait;
    opacity: 0.7;
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

const StatusMessage = styled.p`
  margin: 10px 0 0;
  min-height: 20px;
  color: ${({ $type }) =>
    $type === "error" ? "rgb(220, 80, 80)" : "rgb(var(--theme-yellow))"};
  font-size: 14px;
`;

const LoginModal = ({ isOpen, onClose, onAuthenticated }) => {
    const [isRegisterMode, setIsRegisterMode] = useState(false);
    const [username, setUsername] = useState("");
    const [identifier, setIdentifier] = useState("");
    const [password, setPassword] = useState("");
    const [status, setStatus] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const resetStatus = () => setStatus(null);

    const handleSubmit = async (event) => {
        event.preventDefault();
        resetStatus();

        if (!identifier.trim() || !password) {
            setStatus({ type: "error", text: "Введите логин и пароль." });
            return;
        }

        if (isRegisterMode && !username.trim()) {
            setStatus({ type: "error", text: "Введите имя пользователя." });
            return;
        }

        setIsSubmitting(true);

        try {
            let payload;

            if (isRegisterMode) {
                payload = await registerPortalUser({
                    username: username.trim(),
                    email: identifier.trim(),
                    password,
                });
            } else {
                payload = await loginPortalUser({
                    identifier: identifier.trim(),
                    password,
                });
            }

            setStatus({ type: "success", text: "Вход выполнен." });
            window.setTimeout(() => {
                onAuthenticated?.(payload?.user);
                onClose();
            }, 500);
        } catch (error) {
            setStatus({
                type: "error",
                text: error.message || "Не удалось войти. Проверьте логин и пароль.",
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const switchMode = () => {
        setIsRegisterMode(!isRegisterMode);
        resetStatus();
    };

    if (!isOpen) return null;

    return (
        <ModalOverlay>
            <ModalContent>
                <CloseButton onClick={onClose}>&times;</CloseButton>
                <h2>{isRegisterMode ? "Регистрация" : "Вход"}</h2>

                <form onSubmit={handleSubmit}>
                    {isRegisterMode && (
                        <StyledInput
                            type="text"
                            placeholder="Имя"
                            value={username}
                            onChange={(event) => setUsername(event.target.value)}
                        />
                    )}

                    <StyledInput
                        type="text"
                        placeholder={isRegisterMode ? "Email" : "Email или логин"}
                        value={identifier}
                        onChange={(event) => setIdentifier(event.target.value)}
                    />
                    <StyledInput
                        type="password"
                        placeholder="Пароль"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                    />

                    <StyledButton type="submit" disabled={isSubmitting}>
                        {isSubmitting
                            ? "Подождите..."
                            : isRegisterMode
                                ? "Зарегистрироваться"
                                : "Войти"}
                    </StyledButton>
                </form>

                <StatusMessage $type={status?.type} role={status ? "status" : undefined}>
                    {status?.text || ""}
                </StatusMessage>

                <ToggleText onClick={switchMode}>
                    {isRegisterMode ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Зарегистрироваться"}
                </ToggleText>
            </ModalContent>
        </ModalOverlay>
    );
};

export default LoginModal;

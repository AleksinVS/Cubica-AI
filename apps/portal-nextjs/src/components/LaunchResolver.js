"use client";

/**
 * Portal launch-link resolver.
 *
 * The portal owns link validation. Once Strapi confirms that a launch link is
 * active, this component sends the player to player-web with the launch token
 * and counter. Player-web then asks the portal backend for the correct runtime
 * binding, so browser-local sessions cannot leak across different links.
 */

import { useEffect, useState } from "react";
import styled from "styled-components";
import { parseLaunchKey } from "@/lib/launchRoute";
import { resolveLaunchSession } from "@/lib/portalApi";

const Page = styled.main`
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(var(--background));
  color: rgb(var(--foreground));
`;

const Panel = styled.section`
  width: min(520px, 100%);
  border: 1px solid rgba(var(--theme-yellow), 0.45);
  border-radius: 8px;
  padding: 24px;
`;

const Title = styled.h1`
  margin: 0 0 12px;
  font-size: 1.4rem;
`;

const Message = styled.p`
  margin: 0;
  line-height: 1.5;
`;

const ActionLink = styled.a`
  display: inline-block;
  margin-top: 16px;
  color: rgb(var(--theme-yellow));
`;

function statusMessage(status, reason) {
  if (status === "expired") {
    return "Срок действия ссылки истек.";
  }

  if (status === "missing") {
    return "Ссылка не найдена.";
  }

  return reason || "Не удалось открыть игровую сессию.";
}

function invalidLaunchMessage() {
  const currentPath = typeof window !== "undefined" ? window.location.pathname : "";
  return currentPath
    ? `Некорректная ссылка запуска: ${currentPath}. Ожидаемый формат: /launch/token::counter.`
    : "Некорректная ссылка запуска. Ожидаемый формат: /launch/token::counter.";
}

function resolveLaunchParams({ token, counter }) {
  if (token && counter) {
    return { token, counter };
  }

  if (typeof window === "undefined") {
    return { token, counter };
  }

  const [, launchKey] = window.location.pathname.match(/^\/launch\/([^/]+)/) || [];
  const parsed = parseLaunchKey(decodeURIComponent(launchKey || ""));

  return {
    token: token && counter ? token : parsed.token,
    counter: counter || parsed.counter,
  };
}

export default function LaunchResolver({ token, counter }) {
  const [state, setState] = useState({
    status: "loading",
    message: "Открываем игровую сессию...",
    playerUrl: "",
  });

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      try {
        const resolved = resolveLaunchParams({ token, counter });

        if (!resolved.token || !resolved.counter) {
          throw new Error(invalidLaunchMessage());
        }

        const result = await resolveLaunchSession(resolved);

        if (!result?.ok || !result.playerUrl) {
          throw new Error(statusMessage(result?.status, result?.reason));
        }

        if (isMounted) {
          setState({
            status: "redirecting",
            message: "Сессия найдена. Переходим к игре...",
            playerUrl: result.playerUrl,
          });
        }

        window.location.replace(result.playerUrl);
      } catch (error) {
        if (isMounted) {
          setState({
            status: "error",
            message: error.message || "Не удалось открыть игровую сессию.",
            playerUrl: "",
          });
        }
      }
    };

    run();

    return () => {
      isMounted = false;
    };
  }, [counter, token]);

  return (
    <Page>
      <Panel>
        <Title>
          {state.status === "error" ? "Ссылка не открылась" : "Запуск игры"}
        </Title>
        <Message>{state.message}</Message>
        {state.playerUrl ? (
          <ActionLink href={state.playerUrl}>Открыть игру вручную</ActionLink>
        ) : null}
      </Panel>
    </Page>
  );
}

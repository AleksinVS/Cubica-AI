"use client";

import { useEffect, useState } from "react";
import styled from "styled-components";
import { parseLaunchKey } from "@/lib/launchRoute";
import { fetchCurrentPortalUser, getStoredJwt } from "@/lib/portalApi";

const Page = styled.main`
  min-height: 100vh;
  padding: 32px;
  background: rgb(var(--background));
  color: rgb(var(--foreground));
`;

const Panel = styled.section`
  max-width: 720px;
  border: 1px solid rgba(var(--theme-yellow), 0.45);
  border-radius: 8px;
  padding: 24px;
`;

const Title = styled.h1`
  margin: 0 0 16px;
  font-size: 1.4rem;
`;

const Meta = styled.dl`
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 8px 16px;
`;

export default function LaunchAdminPanel({ token, counter }) {
  const resolved = (() => {
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
  })();

  const [state, setState] = useState({
    status: "loading",
    message: "Проверяем доступ...",
    user: null,
  });

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      if (!getStoredJwt()) {
        setState({
          status: "error",
          message: "Для доступа к админскому окну войдите в портал.",
          user: null,
        });
        return;
      }

      try {
        const user = await fetchCurrentPortalUser();
        if (isMounted) {
          setState({ status: "ready", message: "", user });
        }
      } catch (error) {
        if (isMounted) {
          setState({
            status: "error",
            message: error.message || "Не удалось проверить доступ.",
            user: null,
          });
        }
      }
    };

    load();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <Page>
      <Panel>
        <Title>Админское окно сессии</Title>
        {state.status === "ready" ? (
          <Meta>
            <dt>Пользователь</dt>
            <dd>{state.user?.username || state.user?.email || "portal user"}</dd>
            <dt>Токен</dt>
            <dd>{resolved.token || "не задан"}</dd>
            <dt>Счетчик</dt>
            <dd>{resolved.counter || "не задан"}</dd>
          </Meta>
        ) : (
          <p>{state.message}</p>
        )}
      </Panel>
    </Page>
  );
}

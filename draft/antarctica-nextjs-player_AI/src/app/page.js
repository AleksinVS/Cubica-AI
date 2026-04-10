import React from 'react';
import styles from "./page.module.css";
import GameScreenRenderer from "./components/GameScreenRenderer";
import { routerConfig } from "./config/runtime";

const LOCAL_DATA_DEFAULT = String(process.env.NEXT_PUBLIC_USE_LOCAL_DATA).toLowerCase();

const truthy = new Set(['1', 'true', 'yes']);
const falsy = new Set(['0', 'false', 'no']);

const resolveFlag = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (truthy.has(normalized) || normalized === '') return true;
  if (falsy.has(normalized)) return false;
  return null;
};

const getLocalDataSetting = (searchParams) => {
  const queryValue = searchParams?.local ?? searchParams?.localData;
  const runtimeFlag = resolveFlag(queryValue);
  if (runtimeFlag != null) {
    return runtimeFlag;
  }
  const envFlag = resolveFlag(LOCAL_DATA_DEFAULT);
  return envFlag != null ? envFlag : true;
};

const getRequestedFixture = (searchParams) => {
  const fixtureParam = searchParams?.screen ?? searchParams?.fixture ?? searchParams?.view;
  if (typeof fixtureParam !== 'string') {
    return null;
  }
  const normalized = fixtureParam.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

export default function Home({ searchParams }) {
  const useLocalFixtures = getLocalDataSetting(searchParams);
  const requestedFixture = getRequestedFixture(searchParams);

  return (
    <main className={styles.main}>
      <GameScreenRenderer
        localDevelopment={useLocalFixtures}
        localFixtureKey={requestedFixture}
        routerConfig={routerConfig}
      />
    </main>
  );
}

import React from 'react';
import styles from "./page.module.css";
import JournalPageClient from "./components/JournalPageClient";

export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <main className={styles.main}>
      <JournalPageClient />
    </main>
  );
}

import { AntarcticaPlayer } from "@/components/antarctica-player";
import {
  getActionEntries,
  getRuntimeApiUrl,
  loadAntarcticaPlayerContent
} from "@/lib/antarctica";

export const dynamic = "force-dynamic";

export default async function Page() {
  const content = await loadAntarcticaPlayerContent();

  return (
    <AntarcticaPlayer
      runtimeApiUrl={getRuntimeApiUrl()}
      content={content}
      actions={getActionEntries(content)}
      mockups={content.mockups}
    />
  );
}

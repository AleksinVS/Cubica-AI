import { AntarcticaPlayer } from "@/components/antarctica-player";
import {
  getActionEntries,
  getRuntimeApiUrl,
  loadAntarcticaManifest,
  loadAntarcticaMockups
} from "@/lib/antarctica";

export default async function Page() {
  const [manifest, mockups] = await Promise.all([loadAntarcticaManifest(), loadAntarcticaMockups()]);

  return (
    <AntarcticaPlayer
      runtimeApiUrl={getRuntimeApiUrl()}
      manifest={manifest}
      actions={getActionEntries(manifest)}
      mockups={mockups}
    />
  );
}

"use client";

import { useParams } from "next/navigation";
import LaunchResolver from "@/components/LaunchResolver";
import { parseLaunchKey } from "@/lib/launchRoute";

export default function CanonicalLaunchPage() {
  const params = useParams();
  const launchKey = Array.isArray(params.token) ? params.token[0] : params.token;
  const { token, counter } = parseLaunchKey(launchKey);

  return <LaunchResolver token={token} counter={counter} />;
}

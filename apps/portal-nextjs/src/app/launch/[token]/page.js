"use client";

import { useParams } from "next/navigation";
import LaunchResolver from "@/components/LaunchResolver";

export default function CanonicalLaunchPage() {
  const params = useParams();
  const launchKey = Array.isArray(params.token) ? params.token[0] : params.token;
  const [token, counter] = String(launchKey || "").split("::");

  return <LaunchResolver token={token} counter={counter} />;
}

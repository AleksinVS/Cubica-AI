"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import LaunchAdminPanel from "@/components/LaunchAdminPanel";
import { parseLaunchKey } from "@/lib/launchRoute";

export default function CanonicalLaunchAdminPage() {
  const params = useParams();
  const launchKey = Array.isArray(params.token) ? params.token[0] : params.token;
  const { token, counter } = useMemo(() => parseLaunchKey(launchKey), [launchKey]);

  return <LaunchAdminPanel token={token} counter={counter} />;
}

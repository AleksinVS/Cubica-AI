"use client";

import { useParams } from "next/navigation";
import LaunchAdminPanel from "@/components/LaunchAdminPanel";

export default function LegacyLaunchAdminPage() {
  const params = useParams();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const counter = Array.isArray(params.counter) ? params.counter[0] : params.counter;

  return <LaunchAdminPanel token={token} counter={counter} />;
}

/**
 * Thin browser API client for portal launch operations.
 *
 * The client intentionally keeps only transport concerns here: base URL,
 * optional JWT (JSON Web Token, a signed authorization token) from
 * localStorage, request headers, and response normalization. Launch rules stay
 * behind the backend boundary.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_PORTAL_API_URL || "";

const TOKEN_STORAGE_KEYS = [
  "jwt",
  "portalJwt",
  "cubica.portal.jwt",
  "strapi_jwt",
];

const PRIMARY_TOKEN_STORAGE_KEY = "cubica.portal.jwt";
const TEST_USER = {
  username: "portal-test",
  email: "portal-test@example.com",
  password: "portal-test-password",
};

function getStoredJwt() {
  if (typeof window === "undefined") {
    return null;
  }

  for (const key of TOKEN_STORAGE_KEYS) {
    const token = window.localStorage.getItem(key);
    if (token) {
      return token;
    }
  }

  return null;
}

function buildUrl(path) {
  if (!API_BASE_URL) {
    throw new Error("Portal API URL is not configured");
  }

  return `${API_BASE_URL.replace(/\/$/, "")}${path}`;
}

async function request(path, options = {}) {
  const token = getStoredJwt();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(buildUrl(path), {
    ...options,
    headers,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.message ||
      `Portal API request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function publicRequest(path, options = {}) {
  const response = await fetch(buildUrl(path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.message ||
      `Portal API request failed with status ${response.status}`;
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }

  return payload;
}

function storeJwt(token) {
  if (typeof window !== "undefined" && token) {
    window.localStorage.setItem(PRIMARY_TOKEN_STORAGE_KEY, token);
  }
}

function normalizeSessionList(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.sessions)) {
    return payload.sessions;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  return [];
}

export async function copyLaunchLink({ purchaseId, linkId }) {
  const requestBody = linkId ? { linkId } : { purchaseId };

  const payload = await request("/api/launch-sessions/copy-link", {
    method: "POST",
    body: JSON.stringify(requestBody),
  });

  return {
    url: payload?.url || payload?.data?.url,
    linkId: payload?.linkId || payload?.data?.linkId || linkId,
    launchSession: payload?.launchSession || payload?.data?.launchSession,
    raw: payload,
  };
}

export async function loginTestUser() {
  const payload = await publicRequest("/api/auth/local", {
    method: "POST",
    body: JSON.stringify({
      identifier: TEST_USER.email,
      password: TEST_USER.password,
    }),
  });

  storeJwt(payload?.jwt);
  return payload;
}

export async function ensureTestUserSession() {
  const existingToken = getStoredJwt();

  if (existingToken) {
    return { jwt: existingToken };
  }

  try {
    const payload = await publicRequest("/api/auth/local/register", {
      method: "POST",
      body: JSON.stringify(TEST_USER),
    });

    storeJwt(payload?.jwt);
    return payload;
  } catch (error) {
    return loginTestUser();
  }
}

export async function createTestPurchase({
  gameSlug,
  packageType = "one-time",
  price,
  startDate,
  endDate,
}) {
  await ensureTestUserSession();

  return request("/api/orders/payment-stub", {
    method: "POST",
    body: JSON.stringify({
      gameSlug,
      packageType,
      price,
      startDate,
      endDate,
    }),
  });
}

export async function listActiveSessions({ purchaseId, linkId }) {
  const params = new URLSearchParams();

  if (purchaseId) {
    params.set("purchaseId", purchaseId);
  }

  if (linkId) {
    params.set("linkId", linkId);
  }

  const query = params.toString();
  const payload = await request(
    `/api/launch-sessions/active${query ? `?${query}` : ""}`
  );

  return normalizeSessionList(payload);
}

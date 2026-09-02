const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

/** Echoes the request's Origin — the API still requires the bearer token, so this doesn't loosen access. */
export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  return origin ? { ...CORS_HEADERS, "Access-Control-Allow-Origin": origin } : {};
}

export function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request))) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

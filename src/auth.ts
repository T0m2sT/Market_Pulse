export function checkAuth(request: Request, token: string): boolean {
  const header = request.headers.get("Authorization") ?? "";
  const [scheme, value] = header.split(" ");
  return scheme === "Bearer" && value === token;
}

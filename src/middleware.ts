import { NextResponse, type NextRequest } from "next/server";

export const config = {
  matcher: ["/admin/db/:path*"],
};

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (!pathname.startsWith("/admin/db")) {
    return NextResponse.next();
  }

  const user = process.env.ADMIN_BASIC_AUTH_USER;
  const pass = process.env.ADMIN_BASIC_AUTH_PASSWORD;

  if (!user || !pass) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Admin interface not configured" }, { status: 503 });
    }
    return NextResponse.next();
  }

  const auth = request.headers.get("authorization");
  if (!auth || !auth.startsWith("Basic ")) {
    return new NextResponse("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="News Watch Admin"',
      },
    });
  }

  const credentials = auth.slice(6);
  const decoded = Buffer.from(credentials, "base64").toString("utf-8");
  const [username, password] = decoded.split(":");

  if (username === user && password === pass) {
    return NextResponse.next();
  }

  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="News Watch Admin"',
    },
  });
}

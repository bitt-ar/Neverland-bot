import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser({
    get: (name: string) => {
      const cookie = request.cookies.get(name);
      return cookie ? { value: cookie.value } : undefined;
    },
  });

  const authEnabled = isAuthEnabled();

  return NextResponse.json({
    user,
    isAdmin: Boolean(user?.isOwner),
    authEnabled,
  });
}

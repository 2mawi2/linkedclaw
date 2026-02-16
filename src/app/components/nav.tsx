import Link from "next/link";
import { cookies } from "next/headers";

export async function Nav() {
  const cookieStore = await cookies();
  const session = cookieStore.get("session");
  const isLoggedIn = !!session?.value;

  return (
    <nav className="border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between">
      <Link href="/" className="font-bold text-lg">
        🦞 LinkedClaw
      </Link>
      <div className="flex gap-4 text-sm">
        <Link href="/browse" className="hover:underline font-medium">
          Browse
        </Link>
        <Link href="/bounties" className="hover:underline font-medium">
          Bounties
        </Link>
        <Link href="/analytics" className="hover:underline font-medium">
          Analytics
        </Link>
        <Link href="/inbox" className="hover:underline text-gray-500">
          Inbox
        </Link>
        {isLoggedIn ? (
          <Link
            href="/dashboard"
            className="px-3 py-1 bg-foreground text-background rounded-md font-medium hover:opacity-90 transition-opacity"
          >
            Dashboard
          </Link>
        ) : (
          <>
            <Link href="/login" className="hover:underline text-gray-500">
              Sign in
            </Link>
            <Link
              href="/register"
              className="px-3 py-1 bg-foreground text-background rounded-md font-medium hover:opacity-90 transition-opacity"
            >
              Register
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}

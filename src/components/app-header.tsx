import Link from "next/link";
import { ClockCounterClockwise, GearSix, SignIn, UserCircle } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/auth";

export function AppHeader({ user }: { user: { username: string } | null }) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="wordmark" aria-label="詞織首页">
          <span className="wordmark-line">
            <span className="wordmark-main">詞織</span>
            <span className="wordmark-tagline">words, woven clearly.</span>
          </span>
          <span className="wordmark-sub">SHIORI</span>
        </Link>
        <nav className="top-nav" aria-label="主要导航">
          {user ? (
            <>
              <Link href="/history"><ClockCounterClockwise aria-hidden="true" /> <span>历史</span></Link>
              <Link href="/settings"><GearSix aria-hidden="true" /> <span>设置</span></Link>
              <details className="user-menu">
                <summary aria-label={`用户 ${user.username}，栞（しおり）`}>
                  <span className="user-avatar" aria-hidden="true">栞</span>
                </summary>
                <div className="user-menu-popover">
                  <span className="user-menu-name"><UserCircle aria-hidden="true" />{user.username}</span>
                  <Link href="/settings">账号设置</Link>
                </div>
              </details>
            </>
          ) : (
            <Link href="/login" aria-label="登录或使用体验码"><SignIn aria-hidden="true" /> <span>登录 / 体验</span></Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export async function AuthenticatedAppHeader() {
  const user = await getCurrentUser();
  return <AppHeader user={user ? { username: user.username } : null} />;
}

export function AppHeaderFallback() {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="wordmark" aria-label="詞織首页">
          <span className="wordmark-line">
            <span className="wordmark-main">詞織</span>
            <span className="wordmark-tagline">words, woven clearly.</span>
          </span>
          <span className="wordmark-sub">SHIORI</span>
        </Link>
        <div className="header-auth-placeholder" aria-hidden="true" />
      </div>
    </header>
  );
}

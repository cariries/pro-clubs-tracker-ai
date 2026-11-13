// The header shown on every page. Home, search results and club pages are public; only the last two links need a login.
export default function SiteHeader() {
  return (
    <header className="site-header">
      <nav aria-label="Main / 主要導覽">
        <a className="brand" href="/">
          FC 2X Pro Club Tracker
        </a>
        <a href="/">Search / 搜尋</a>
        <a href="/analysis">Ask AI / 問 AI</a>
        <a href="/profile">Account / 帳戶</a>
      </nav>
    </header>
  );
}

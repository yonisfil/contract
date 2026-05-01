import { useEffect, useState } from "react";
import HomePage from "./pages/HomePage";
import WalletPage from "./pages/WalletPage";

function navigate(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export default function App() {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const handleLocationChange = () => {
      setPathname(window.location.pathname);
    };

    window.addEventListener("popstate", handleLocationChange);
    return () => window.removeEventListener("popstate", handleLocationChange);
  }, []);

  if (pathname === "/wallet") {
    return <WalletPage onNavigate={navigate} />;
  }

  return <HomePage onNavigate={navigate} />;
}

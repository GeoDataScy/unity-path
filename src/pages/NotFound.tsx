import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <div className="text-center">
        <h1 className="mb-4 font-mono text-[48px] font-normal leading-[52px] tracking-[-0.035em] text-ink">404</h1>
        <p className="mb-4 text-xl tracking-[-0.015em] text-ink-secondary">Oops! Page not found</p>
        <a href="/" className="text-ink underline underline-offset-4 hover:text-ink-secondary">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;

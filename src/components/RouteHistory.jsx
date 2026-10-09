"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function RouteHistory() {
  const pathname = usePathname();

  useEffect(() => {
    const currentPath = sessionStorage.getItem("comexa-current-path");

    if (currentPath && currentPath !== pathname) {
      sessionStorage.setItem("comexa-previous-path", currentPath);
    }

    sessionStorage.setItem("comexa-current-path", pathname);
  }, [pathname]);

  return null;
}

"use client";

import { useEffect } from "react";

interface LocaleDocumentSyncProps {
  locale: string;
  dir: "ltr" | "rtl";
}

export function LocaleDocumentSync({ locale, dir }: LocaleDocumentSyncProps) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [dir, locale]);

  return null;
}

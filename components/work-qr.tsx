"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";

export function WorkQr({ size = 128 }: { size?: number }) {
  const [url, setUrl] = useState("");
  useEffect(() => setUrl(`${window.location.origin}/work`), []);
  if (!url) return <div style={{ width: size, height: size }} aria-hidden />;
  return (
    <div className="space-y-2">
      <QRCodeSVG value={url} size={size} bgColor="#f6f5f0" fgColor="#1c1e24" />
      <p className="font-mono text-xs text-ink-2">{url.replace(/^https?:\/\//, "")}</p>
    </div>
  );
}

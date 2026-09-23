"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** Camera input with client-side resize to 1280px JPEG (~≤400 KB). */
export function PhotoInput({
  onSelect,
  disabled,
}: {
  onSelect: (photo: Blob, previewUrl: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const blob = await resize(file);
      const url = URL.createObjectURL(blob);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return url;
      });
      onSelect(blob, url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="Your photo, ready to submit"
          className="w-full rounded-lg border border-line"
        />
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      <Button
        variant="outline"
        className="h-12 w-full"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "Preparing photo…" : preview ? "Retake photo" : "Take photo"}
      </Button>
    </div>
  );
}

async function resize(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("could not encode the photo"))),
      "image/jpeg",
      0.8,
    ),
  );
}

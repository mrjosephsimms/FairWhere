// Shrink a picked photo to a small square-ish JPEG before upload (profile pictures).

export async function resizeToJpeg(file: File, max = 320, quality = 0.85): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error("Couldn't read that photo."));
      i.src = url;
    });
    // Centre-crop to a square, then scale down.
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const out = Math.min(max, side);
    const c = document.createElement("canvas");
    c.width = c.height = out;
    c.getContext("2d")!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
    return await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't process that photo."))), "image/jpeg", quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

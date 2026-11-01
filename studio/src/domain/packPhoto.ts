// Фото пачки для каталога: уменьшить до 90 px по ширине, JPEG. Хранится в SKU как data URL
export async function packPhoto(file: Blob, width = 90): Promise<string> {
  const bmp = await createImageBitmap(file);
  try {
    const H = Math.round((bmp.height / bmp.width) * width);
    const c = document.createElement('canvas');
    c.width = width; c.height = H;
    c.getContext('2d')!.drawImage(bmp, 0, 0, width, H);
    return c.toDataURL('image/jpeg', 0.84);
  } finally { bmp.close(); }
}

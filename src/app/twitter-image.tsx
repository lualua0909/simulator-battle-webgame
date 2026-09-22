// Ảnh preview cho Twitter/X (1200x630, cùng khung với Open Graph).
import { ImageResponse } from 'next/og';
import OgCard from './og-card';

export const alt = 'Mini Battle Simulator — low-poly epic battle sandbox';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function TwitterImage() {
  return new ImageResponse(<OgCard />, { ...size });
}

// Ảnh preview khi share link (Discord/Zalo/FB...): 1200x630, phong cách hero Unite.
import { ImageResponse } from 'next/og';
import OgCard from './og-card';

export const alt = 'Mini Battle Simulator — low-poly epic battle sandbox';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(<OgCard />, { ...size });
}

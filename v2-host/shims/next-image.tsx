// next/image 대체 — 같은 <img>(최적화 없이). fill이면 부모를 꽉 채운다(next/image fill과 같은 배치).
import type { CSSProperties, ImgHTMLAttributes } from 'react';

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & { src: string | { src: string }; fill?: boolean; priority?: boolean; quality?: number; placeholder?: string; blurDataURL?: string; unoptimized?: boolean };
export default function Image({ src, fill, priority: _p, quality: _q, placeholder: _ph, blurDataURL: _b, unoptimized: _u, style, ...rest }: Props) {
  const s: CSSProperties = fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%', ...style } : style ?? {};
  return <img src={typeof src === 'string' ? src : src.src} style={s} {...rest} />;
}

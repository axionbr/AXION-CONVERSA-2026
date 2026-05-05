import { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { cn } from '../lib/utils';

interface Props {
  /** 'sm' = sidebar  |  'md' = login */
  size?: 'sm' | 'md';
  className?: string;
}

export default function DeveloperSignature({ size = 'sm', className }: Props) {
  const { theme } = useTheme();
  const [imgError, setImgError] = useState(false);

  const imgSrc = theme === 'dark'
    ? '/brand/axion-logo-white.png'
    : '/brand/axion-logo-black.png';

  // Resetar erro sempre que o src trocar (troca de tema)
  // Evita que um erro da logo branca bloqueie a logo preta (e vice-versa)
  useEffect(() => { setImgError(false); }, [imgSrc]);

  // Alturas conforme requisito:
  //   sidebar → 14px (dentro de 14–16px)
  //   login   → 20px (dentro de 18–22px)
  //
  // width: auto mantém a proporção natural do canvas (1254×1254 → quadrado).
  // A logo "A AXION" preenche a maior parte do canvas, então o resultado
  // é o logotipo completo em miniatura — legível e proporcional.
  const imgH = size === 'sm' ? 14 : 20;

  const labelSize = size === 'sm' ? 'text-[8px]'  : 'text-[9px]';
  const fallback  = size === 'sm' ? 'text-[10px]' : 'text-[11px]';

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-1.5 select-none pointer-events-none',
        className,
      )}
    >
      <span className={cn(
        'text-muted-foreground/40 tracking-widest uppercase font-medium leading-none',
        labelSize,
      )}>
        Powered by
      </span>

      {imgError ? (
        /* Fallback puro em texto quando a imagem não carrega */
        <span className={cn(
          'font-black tracking-widest text-muted-foreground/40 uppercase leading-none',
          fallback,
        )}>
          AXION
        </span>
      ) : (
        <img
          src={imgSrc}
          alt="Axion"
          draggable={false}
          onError={() => setImgError(true)}
          style={{
            height:     `${imgH}px`,
            width:      'auto',       // mantém proporção natural 1:1 do canvas
            maxWidth:   size === 'sm' ? '72px' : '96px',
            objectFit:  'contain',
            opacity:    0.45,
            display:    'block',
            flexShrink: 0,
          }}
        />
      )}
    </div>
  );
}

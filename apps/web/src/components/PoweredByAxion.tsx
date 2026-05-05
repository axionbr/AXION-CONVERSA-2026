import { useTheme } from '../context/ThemeContext';
import { cn } from '../lib/utils';

interface Props {
  className?: string;
}

export default function PoweredByAxion({ className }: Props) {
  const { theme } = useTheme();

  return (
    <div className={cn('flex items-center justify-center gap-1.5 select-none', className)}>
      <span className="text-[9px] text-muted-foreground/60 tracking-widest uppercase">
        Powered by
      </span>
      <img
        src={theme === 'dark' ? '/brand/axion-logo-white.png' : '/brand/axion-logo-black.png'}
        alt="Axion"
        className="h-3 w-auto object-contain opacity-40"
        draggable={false}
      />
    </div>
  );
}

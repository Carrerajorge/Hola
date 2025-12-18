import siraLogoSrc from "@/assets/sira-logo.png";

interface SiraLogoProps {
  size?: number;
  className?: string;
}

export function SiraLogo({ size = 32, className = "" }: SiraLogoProps) {
  return (
    <img 
      src={siraLogoSrc} 
      alt="Sira Logo" 
      width={size} 
      height={size}
      className={`${className} mix-blend-multiply dark:mix-blend-screen dark:invert`}
      style={{ objectFit: "contain" }}
    />
  );
}

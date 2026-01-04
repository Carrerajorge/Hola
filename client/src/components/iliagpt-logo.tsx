import siraLogoSrc from "@/assets/sira-logo.png";

interface IliaGPTLogoProps {
  size?: number;
  className?: string;
}

export function IliaGPTLogo({ size = 32, className = "" }: IliaGPTLogoProps) {
  return (
    <img 
      src={siraLogoSrc} 
      alt="IliaGPT Logo" 
      width={size} 
      height={size}
      className={`${className} mix-blend-multiply dark:mix-blend-screen dark:invert`}
      style={{ objectFit: "contain" }}
    />
  );
}

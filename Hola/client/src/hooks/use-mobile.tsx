import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const getIsMobile = React.useCallback(() => window.innerWidth < MOBILE_BREAKPOINT, [])
  const [isMobile, setIsMobile] = React.useState<boolean>(() => getIsMobile())

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      const next = mql.matches
      setIsMobile((prev) => (prev === next ? prev : next))
    }
    setIsMobile((prev) => (prev === mql.matches ? prev : mql.matches))

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    }

    mql.addListener(onChange)
    return () => mql.removeListener(onChange)
  }, [getIsMobile])

  return isMobile
}

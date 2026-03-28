import { useEffect, useState } from 'react'

export interface MobileOptimizedState {
  isMobile: boolean
  isTablet: boolean
  isDesktop: boolean
  screenWidth: number
  screenHeight: number
  touchSupported: boolean
}

export function useMobileOptimized() {
  const [state, setState] = useState<MobileOptimizedState>({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    screenWidth: 1024,
    screenHeight: 768,
    touchSupported: false,
  })

  useEffect(() => {
    const updateState = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      
      setState({
        isMobile: width < 768,
        isTablet: width >= 768 && width < 1024,
        isDesktop: width >= 1024,
        screenWidth: width,
        screenHeight: height,
        touchSupported: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
      })
    }

    updateState()
    
    // Debounced resize handler
    let resizeTimer: NodeJS.Timeout
    const handleResize = () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(updateState, 150)
    }

    window.addEventListener('resize', handleResize)
    window.addEventListener('orientationchange', updateState)
    
    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', updateState)
      clearTimeout(resizeTimer)
    }
  }, [])

  return state
}

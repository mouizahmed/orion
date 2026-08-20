import { useEffect, useState } from 'react'

export function useWindowState() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    const handleResize = () => {
      const isMaximizedState =
        window.innerHeight >= screen.height - 100 &&
        window.innerWidth >= screen.width - 100
      setIsMaximized(isMaximizedState)
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return { isMaximized }
}

import { useEffect, useState } from 'react'

type Bounds = {
  innerWidth: number
  innerHeight: number
  dpr: number
}

function readBounds(): Bounds {
  return {
    innerWidth: typeof window !== 'undefined' ? window.innerWidth : 0,
    innerHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
    dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
  }
}

export default function DebugBounds() {
  const [bounds, setBounds] = useState<Bounds>(() => readBounds())

  useEffect(() => {
    const onResize = () => setBounds(readBounds())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <div className="pointer-events-none fixed bottom-2 left-2 z-[9999] select-none rounded-md border border-white/15 bg-black/70 px-2 py-1 text-[11px] font-medium text-white/80 backdrop-blur">
      {bounds.innerWidth} × {bounds.innerHeight} @ {bounds.dpr.toFixed(2)}x
    </div>
  )
}


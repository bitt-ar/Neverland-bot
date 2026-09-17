"use client"

import * as React from "react"

export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full min-w-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out-soft motion-reduce:animate-none">
      {children}
    </div>
  )
}

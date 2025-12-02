"use client"

import { useEffect, useRef, useCallback, useState } from "react"

const TEXT_CONTENT = `
/notaku Join the future of AI-powered learning with exclusive early access to revolutionary study tools and personalized education.
/notaku Be the first to experience personalized learning paths powered by advanced artificial intelligence and machine learning.
/notaku Get exclusive access to beta features before they're released to the public community of students and educators.
/notaku Connect with a select group of students and educators shaping the future of education and digital learning.
/notaku Lock in special pricing and exclusive perks that carry forward when we launch publicly to the masses.
/notaku Experience cutting-edge AI tutoring that adapts to your unique learning style and pace of understanding.
/notaku Access premium study materials and interactive content designed by education experts and AI specialists.
/notaku Join our exclusive community and get direct access to our development team for feedback and suggestions.
/notaku Shape the future of digital learning by being part of our early access program today and tomorrow.
/notaku Transform your study experience with AI-powered insights and personalized recommendations for success.
`
const FULL_TITLE = ""

interface Cell {
  element: HTMLDivElement
  char: string
}

interface PrecalculatedCell extends Cell {
  dist: number
  initialAngle: number
}

export function CRTSwirlBackground() {
  const containerRef = useRef<HTMLDivElement>(null)
  const precalculatedCellMapRef = useRef<PrecalculatedCell[][]>([])
  const animationRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | undefined>(undefined)
  const gridRef = useRef({ rows: 0, cols: 0 })
  const lastPositionsRef = useRef<Map<string, string>>(new Map())
  const titleMeasureRef = useRef<HTMLHeadingElement>(null)
  const titleBoxRef = useRef<{
    startCol: number
    endCol: number
    startRow: number
    endRow: number
  } | null>(null)
  const [revealedTitle, setRevealedTitle] = useState("")
  const frameCountRef = useRef(0)

  const sentences = TEXT_CONTENT.split(/[\n\r]/)
    .filter((s) => s.length > 0)
    .map((s) => s + " ")

  const getCharAt = useCallback(
    (x: number, y: number): string => {
      const si = y % sentences.length
      const ci = Math.min(x, sentences[si].length - 1)
      return sentences[si][ci] || " "
    },
    [sentences],
  )

  const drawText = useCallback((currentTime: number) => {
    const precalculatedCellMap = precalculatedCellMapRef.current
    const { rows, cols } = gridRef.current
    if (!rows || !cols) return

    // Skip frames for better performance
    frameCountRef.current++
    if (frameCountRef.current % 2 !== 0) return

    const centerX = 0.5
    const centerY = 0.5
    const timeFactor = currentTime * 0.08
    const titleBox = titleBoxRef.current

    const newPositions = new Map<string, string>()
    const batchUpdates: Array<{ element: HTMLDivElement; char: string }> = []

    // Calculate new positions
    for (let y = 0; y < rows; y += 2) {
      // Skip every other row for performance
      for (let x = 0; x < cols; x += 2) {
        // Skip every other column for performance
        const cell = precalculatedCellMap[y]?.[x]
        if (!cell) continue

        const newAngle = cell.initialAngle - Math.pow(cell.dist, 0.4) * timeFactor
        const nx = centerX + Math.cos(newAngle) * cell.dist
        const ny = centerY + Math.sin(newAngle) * cell.dist
        const newX = Math.floor(nx * cols)
        const newY = Math.floor(ny * rows)

        if (newX >= 0 && newY >= 0 && newY < rows && newX < cols) {
          if (
            titleBox &&
            newX >= titleBox.startCol &&
            newX < titleBox.endCol &&
            newY >= titleBox.startRow &&
            newY < titleBox.endRow
          ) {
            continue
          }
          const key = `${newY}-${newX}`
          if (!newPositions.has(key)) {
            newPositions.set(key, cell.char)
          }
        }
      }
    }

    const lastPositions = lastPositionsRef.current

    // Batch clear operations
    for (const [key] of lastPositions) {
      if (!newPositions.has(key)) {
        const [y, x] = key.split("-").map(Number)
        const cell = precalculatedCellMap[y]?.[x]
        if (cell?.element) {
          batchUpdates.push({ element: cell.element, char: " " })
        }
      }
    }

    // Batch update operations
    for (const [key, char] of newPositions) {
      if (char !== lastPositions.get(key)) {
        const [y, x] = key.split("-").map(Number)
        const cell = precalculatedCellMap[y]?.[x]
        if (cell?.element) {
          batchUpdates.push({ element: cell.element, char })
        }
      }
    }

    // Apply all updates in a single batch
    requestAnimationFrame(() => {
      for (const update of batchUpdates) {
        update.element.textContent = update.char
      }
    })

    lastPositionsRef.current = newPositions
  }, [])

  const animate = useCallback(
    (timestamp: number) => {
      if (startTimeRef.current === undefined) {
        startTimeRef.current = timestamp
      }
      const currentTime = (timestamp - startTimeRef.current) / 1000
      drawText(currentTime)
      animationRef.current = requestAnimationFrame(animate)
    },
    [drawText],
  )

  useEffect(() => {
    const initGrid = () => {
      const container = containerRef.current
      if (!container) return

      const cellWidth = 12
      const cellHeight = 18

      if (titleMeasureRef.current) {
        const titleRect = titleMeasureRef.current.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()
        titleBoxRef.current = {
          startCol: Math.floor((titleRect.left - containerRect.left) / cellWidth),
          endCol: Math.ceil((titleRect.right - containerRect.left) / cellWidth),
          startRow: Math.floor((titleRect.top - containerRect.top) / cellHeight),
          endRow: Math.ceil((titleRect.bottom - containerRect.top) / cellHeight),
        }
      }

      // Reduce grid size for better performance
      const newCols = Math.ceil(window.innerWidth / cellWidth)
      const newRows = Math.ceil(window.innerHeight / cellHeight)
      gridRef.current = { rows: newRows, cols: newCols }

      lastPositionsRef.current = new Map()
      precalculatedCellMapRef.current = []
      container.innerHTML = ""
      const centerX = 0.5
      const centerY = 0.5
      const titleBox = titleBoxRef.current

      // Create document fragment for better performance
      const fragment = document.createDocumentFragment()

      for (let y = 0; y < newRows; y++) {
        const row = document.createElement("div")
        row.className = "flex"
        precalculatedCellMapRef.current[y] = []

        for (let x = 0; x < newCols; x++) {
          const cellElement = document.createElement("div")
          cellElement.className = "cell"

          let char = " "
          if (
            !titleBox ||
            x < titleBox.startCol ||
            x >= titleBox.endCol ||
            y < titleBox.startRow ||
            y >= titleBox.endRow
          ) {
            char = getCharAt(x, y)
          }

          cellElement.textContent = char
          row.appendChild(cellElement)

          const dx = x / newCols - centerX
          const dy = y / newRows - centerY
          precalculatedCellMapRef.current[y][x] = {
            element: cellElement,
            char,
            dist: Math.sqrt(dx * dx + dy * dy),
            initialAngle: Math.atan2(dy, dx),
          }
        }
        fragment.appendChild(row)
      }

      container.appendChild(fragment)

      startTimeRef.current = undefined
      frameCountRef.current = 0
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
      animationRef.current = requestAnimationFrame(animate)
    }

    const revealTimer = setTimeout(() => {
      const interval = setInterval(() => {
        setRevealedTitle((prev) => {
          if (prev.length < FULL_TITLE.length) {
            return FULL_TITLE.substring(0, prev.length + 1)
          }
          clearInterval(interval)
          return prev
        })
      }, 120)
    }, 500)

    initGrid()
    window.addEventListener("resize", initGrid)

    return () => {
      window.removeEventListener("resize", initGrid)
      clearTimeout(revealTimer)
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [animate, getCharAt])

  return (
    <div className="crt-effect-container">
      <div className="absolute inset-0 bg-black/20 z-[1]" />
      <h1
        ref={titleMeasureRef}
        style={{ visibility: "hidden", pointerEvents: "none" }}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-6xl font-bold tracking-widest"
      >
        {FULL_TITLE}
      </h1>
      <h1 className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-6xl font-bold tracking-widest text-white/90">
        {revealedTitle}
      </h1>
      <svg className="hidden">
        <defs>
          <filter id="barrel-distort">
            <feImage
              href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIj48cmFkaWFsR3JhZGllbnQgaWQ9ImciIGN4PSI1MCUiIGN5PSI1MCUiIHI9IjUwJSI+PHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0id2hpdGUiIC8+PHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSJibGFjayIgLz48L3JhZGlhbEdyYWRpZW50PjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZykiIC8+PC9zdmc+"
              x="0"
              y="0"
              width="100%"
              height="100%"
              result="radial-gradient"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="radial-gradient"
              scale="60"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>
      <div ref={containerRef} className="text-grid" />
    </div>
  )
}

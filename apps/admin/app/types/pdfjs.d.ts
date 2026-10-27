declare module 'pdfjs-dist/build/pdf.mjs' {
  interface Viewport { width: number, height: number }
  interface Page {
    getViewport: (options: { scale: number }) => Viewport
    render: (options: { canvasContext: CanvasRenderingContext2D, viewport: Viewport }) => { promise: Promise<void> }
  }
  interface Document {
    numPages: number
    getPage: (pageNumber: number) => Promise<Page>
    cleanup?: () => Promise<void> | void
    destroy?: () => Promise<void> | void
  }
  interface LoadingTask {
    promise: Promise<Document>
    destroy?: () => Promise<void> | void
  }
  export const GlobalWorkerOptions: { workerSrc: string }
  export function getDocument(options: { data: ArrayBuffer }): LoadingTask
}

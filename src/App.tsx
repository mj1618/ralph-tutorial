import { useRef } from 'react'
import './App.css'
import CanvasGrid, { type CanvasGridHandle } from './components/CanvasGrid'

function App() {
  const gridRef = useRef<CanvasGridHandle | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar__left">
          <span className="app-title">Ralph</span>
          <span className="app-subtitle">Spreadsheet prototype</span>
        </div>
        <div className="toolbar__actions">
          <button
            className="toolbar__button"
            type="button"
            onClick={() => gridRef.current?.toggleBold()}
            aria-label="Toggle bold"
            title="Bold"
          >
            Bold
          </button>
          <button
            className="toolbar__button"
            type="button"
            onClick={() => gridRef.current?.toggleItalic()}
            aria-label="Toggle italic"
            title="Italic"
          >
            Italic
          </button>
          <button
            className="toolbar__button"
            type="button"
            onClick={() => gridRef.current?.setAlignment('left')}
            aria-label="Align left"
            title="Align left"
          >
            Left
          </button>
          <button
            className="toolbar__button"
            type="button"
            onClick={() => gridRef.current?.setAlignment('center')}
            aria-label="Align center"
            title="Align center"
          >
            Center
          </button>
          <button
            className="toolbar__button"
            type="button"
            onClick={() => gridRef.current?.setAlignment('right')}
            aria-label="Align right"
            title="Align right"
          >
            Right
          </button>
          <button
            className="toolbar__button"
            type="button"
            onClick={() => gridRef.current?.resetWorkbook()}
          >
            New
          </button>
          <button
            className="toolbar__button"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            Open
          </button>
          <button
            className="toolbar__button toolbar__button--primary"
            type="button"
            onClick={() => gridRef.current?.exportCsv()}
          >
            Save
          </button>
        </div>
      </header>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) {
            gridRef.current?.importCsvFile(file)
          }
          event.target.value = ''
        }}
        hidden
      />
      <main className="workspace">
        <section className="grid-viewport" role="grid" aria-label="Spreadsheet grid">
          <CanvasGrid ref={gridRef} />
        </section>
      </main>
    </div>
  )
}

export default App

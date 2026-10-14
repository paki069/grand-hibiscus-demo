'use client'

import { useRef, useState } from 'react'

const ACCEPTED_RECEIPT_TYPES = '.jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf'

export function ReceiptFilePicker({
  label,
  file,
  disabled = false,
  required = false,
  error,
  onFileChange,
}: {
  label: string
  file: File | null
  disabled?: boolean
  required?: boolean
  error?: string | null
  onFileChange: (file: File | null) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragOver, setDragOver] = useState(false)

  function selectFile(selectedFile: File | null) {
    if (disabled || !selectedFile) return
    onFileChange(selectedFile)
    if (inputRef.current) inputRef.current.value = ''
  }

  function removeFile() {
    onFileChange(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="stack">
      <label className="field receipt-field">
        <span>{label}{required && <> <span className="receipt-required-mark" aria-hidden="true">*</span></>}</span>
        <span
          className={`receipt-dropzone${dragOver ? ' is-dragging' : ''}${disabled ? ' is-disabled' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            if (!disabled) setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragOver(false)
            selectFile(event.dataTransfer.files[0] ?? null)
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
          </svg>
          <span>
            <strong>Choose a file</strong> or drop it here
            <span className="help">JPG, PNG, WebP, or PDF, up to 5 MB</span>
          </span>
          <input
            ref={inputRef}
            className="receipt-file-input"
            type="file"
            accept={ACCEPTED_RECEIPT_TYPES}
            required={required}
            aria-required={required}
            disabled={disabled}
            onChange={(event) => selectFile(event.currentTarget.files?.[0] ?? null)}
          />
        </span>
      </label>
      {file && (
        <div className="receipt-file-row">
          <span className="receipt-file-name" title={file.name}>{file.name}</span>
          <span className="small muted">{file.size >= 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`}</span>
          <button type="button" className="receipt-file-remove" disabled={disabled} onClick={removeFile}>Remove</button>
        </div>
      )}
      {error && <div className="notice bad small" role="alert">{error}</div>}
    </div>
  )
}
